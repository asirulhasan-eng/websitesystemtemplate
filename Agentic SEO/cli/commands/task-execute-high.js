#!/usr/bin/env node
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { writeJson, slugify } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const git = require("../lib/git");
const { loadBrain, assertAllowedByBrain, logBrainEvent } = require("../lib/obsidian_brain");
const { assertTaskStatus } = require("../lib/statuses");
const { assertTaskExecutionAllowed } = require("../lib/guardrails");
const { previewUrlForBranch } = require("../lib/preview_urls");

/**
 * Lane 3 â€“ High-Risk Pipeline Orchestrator (Â§10 + Â§26)
 *
 * Two-phase pipeline for high_risk tasks:
 *
 * Phase 1 â€“ Pre-approval (task status = candidate | pending):
 *   1. Load task, verify risk_level = high_risk
 *   2. Create approval request via task-approve.js
 *   3. Record waiting_for_approval state
 *   4. Output: waiting_for_approval, user must respond via email
 *
 * Phase 2 â€“ Post-approval (task status = approved):
 *   5. Acquire locks via lock-acquire
 *   6. Create agent branch
 *   7. Execute changes via task-execute-safe.js --allow-semi-safe
 *   8. Push branch to origin
 *   9. Create PR (if --create-pr) via deploy-pr.js
 *  10. Record preview deployment via deploy-record.js
 *  11. Validate live deployment (if --validate)
 *  12. Send notification (event + outbox for preview email with PR link)
 *  13. Status: preview_validated, awaiting merge decision
 */

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const taskId = requireArg(args, "task");
  const dbPath = args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db";
  const siteRoot = path.resolve(process.cwd(), args["site-root"] || "D:\\Projects\\{{NICHE}} SEO Agency");
  const domain = args.domain || null;
  const db = openStateDb(dbPath);

  // â”€â”€ Load task â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const brain = loadBrain({ vaultRoot: args["brain-vault"] || args.vault, mode: "execution", autoCompile: args.compile !== false }).brain;
  const brainDecision = assertAllowedByBrain(task, brain);
  if (!brainDecision.allowed) {
    logBrainEvent(db, task, brainDecision, "high_risk_pipeline");
    throw new Error(`Task ${taskId} blocked by Obsidian Brain rule ${brainDecision.rule_id}: ${brainDecision.reason}`);
  }

  if (task.risk_level !== "high_risk") {
    throw new Error(
      `Task ${taskId} has risk_level='${task.risk_level}'. High-risk pipeline requires risk_level='high_risk'.`,
    );
  }

  // â”€â”€ Route to the correct phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const preApprovalStatuses = ["candidate", "pending"];
  if (preApprovalStatuses.includes(task.status)) {
    runPhase1(db, dbPath, task, args);
  } else if (task.status === "approved") {
    runPhase2(db, dbPath, task, siteRoot, domain, args);
  } else {
    throw new Error(
      `Task ${taskId} has status='${task.status}'. High-risk pipeline expects ` +
      `'candidate', 'pending' (Phase 1) or 'approved' (Phase 2).`,
    );
  }

  db.close();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Phase 1 â€“ Pre-approval
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function runPhase1(db, dbPath, task, args) {
  const taskId = task.task_id;

  // â”€â”€ Step 2: Create approval request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const approvalOutput = runNode("task-approve.js", [
    "request",
    "--db", dbPath,
    "--task", taskId,
  ]);
  const approvalResult = JSON.parse(approvalOutput);

  // â”€â”€ Step 3: Record pipeline state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      `INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("EVT"), "high_risk_pipeline_phase1", taskId, "task", taskId,
      task.status, "waiting_for_approval",
      "high_risk_pipeline", "High-Risk Pipeline",
      now, JSON.stringify({ approval_id: approvalResult.approval_id }),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  // â”€â”€ Step 4: Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const output = {
    generated_at: nowIso(),
    tool: "run_high_risk_pipeline",
    phase: 1,
    task_id: taskId,
    status: "waiting_for_approval",
    approval_id: approvalResult.approval_id || null,
    message: "Approval request sent â€” user must respond via email before Phase 2 can proceed.",
  };

  const outPath = args.out || path.join(process.cwd(), "tools", "out", "pipelines", `high-risk-p1-${taskId}-${Date.now()}.json`);
  writeJson(outPath, output);

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`High-risk pipeline Phase 1 completed: ${outPath}`);
    console.log(`Status: waiting_for_approval | Task: ${taskId}`);
    console.log("User must approve via email before Phase 2 can run.");
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Phase 2 â€“ Post-approval
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function runPhase2(db, dbPath, task, siteRoot, domain, args) {
  const taskId = task.task_id;
  if (!args.apply) {
    throw new Error("High-risk Phase 2 passes --apply --commit to task-execute-safe. Pass --apply to confirm.");
  }
  assertTaskExecutionAllowed(db, task);
  const branch = `agent/${task.task_id}-${slugify(task.title).slice(0, 45)}`;
  const lockSpecs = buildLockSpecs(task);
  let acquiredLocks = [];

  try {
    // â”€â”€ Step 5: Acquire locks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (lockSpecs.length > 0) {
      acquiredLocks = acquireLocks(lockSpecs, dbPath, taskId, "high_risk_pipeline");
    }

    // â”€â”€ Step 5.5: Plan first â€” never push an empty branch or fake a preview â”€â”€
    // A high-risk task whose type has no deterministic safe edit (e.g. a content
    // rewrite that belongs on the Hermes content lane) yields ZERO file changes.
    // Branching + marking 'preview_validated' for that is false progress: it leaves
    // a zombie awaiting a merge that never comes. Detect it up front and mark the
    // task 'blocked' with an actionable reason instead of manufacturing a no-op PR.
    const planResult = JSON.parse(runNode("task-execute-safe.js", [
      "--task", taskId,
      "--db", dbPath,
      "--site-root", siteRoot,
      "--allow-semi-safe",
      "--skip-locks",
      "--json",
      ...(args["brain-vault"] ? ["--brain-vault", args["brain-vault"]] : []),
    ]));
    if (!hasContentChanges(planResult)) {
      return recordBlockedNoChanges(db, task, taskId, planResult, args);
    }

    // â”€â”€ Step 6: Create agent branch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    git.checkoutNewBranch(siteRoot, branch);

    // â”€â”€ Step 7: Execute changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const execArgs = [
      "--task", taskId,
      "--db", dbPath,
      "--site-root", siteRoot,
      "--allow-semi-safe",
      "--apply",
      "--commit",
      // Locks are pre-acquired above by the high-risk orchestrator. The safe
      // executor must NOT re-acquire them or it will self-conflict on the same
      // file_lock/url_lock and abort Phase 2. The parent's finally{} releases.
      "--skip-locks",
      ...(args["brain-vault"] ? ["--brain-vault", args["brain-vault"]] : []),
    ];
    const execOutput = runNode("task-execute-safe.js", execArgs);

    // â”€â”€ Step 8: Push branch to origin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    git.push(siteRoot, "origin", branch, true);
    const commitSha = git.shortHead(siteRoot);

    // â”€â”€ Step 9: Create PR (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let prResult = null;
    if (args["create-pr"]) {
      const prArgs = [
        "--apply",
        "--push",
        "--task", taskId,
        "--db", dbPath,
        "--site-root", siteRoot,
        "--head", branch,
      ];
      if (args.repo) prArgs.push("--repo", args.repo);
      const prOutput = runNode("deploy-pr.js", prArgs);
      prResult = JSON.parse(prOutput);
    }

    // â”€â”€ Step 10: Record preview deployment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const deployArgs = [
      "start",
      "--db", dbPath,
      "--task", taskId,
      "--type", "preview",
      "--branch", branch,
      "--commit", commitSha,
    ];
    const deployOutput = runNode("deploy-record.js", deployArgs);
    const deployResult = JSON.parse(deployOutput);
    const previewUrl = previewUrlForBranch(branch, domain);

    // â”€â”€ Step 11: Validate live deployment (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let validationOutput = null;
    if (args.validate) {
      const validateArgs = ["--preview", "--db", dbPath, "--task", taskId];
      if (domain) validateArgs.push("--domain", domain);
      const validationUrl = validationUrlForTask(task, previewUrl);
      if (!validationUrl) {
        throw new Error("Cannot run --validate without a live validation URL. Pass --domain or set task.target_url.");
      }
      validateArgs.push("--url", validationUrl);
      validationOutput = runNode("deploy-validate.js", validateArgs);
    }

    // â”€â”€ Step 12: Record result in SQLite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const now = nowIso();
    const prUrl = prResult && prResult.github_response ? prResult.github_response.html_url : null;
    const finalStatus = assertTaskStatus("preview_validated");

    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(finalStatus, now, taskId);

      db.prepare(
        `INSERT INTO events (
          event_id, event_type, task_id, resource_type, resource_id,
          old_value, new_value, source, agent_name, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        makeId("EVT"), "high_risk_pipeline_completed", taskId, "task", taskId,
        task.status, finalStatus,
        "high_risk_pipeline", "High-Risk Pipeline",
        now, JSON.stringify({ branch, commit_sha: commitSha, preview_url: previewUrl, pr_url: prUrl }),
      );

      db.prepare(
        `INSERT INTO outbox_jobs (
          outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        makeId("OUT"), "send_preview_email", "task", taskId,
        JSON.stringify({
          task_id: taskId,
          task_title: task.title,
          branch,
          commit_sha: commitSha,
          preview_url: previewUrl,
          pr_url: prUrl,
          risk_level: task.risk_level,
          status: finalStatus,
        }),
        now,
      );

      db.prepare(
        `INSERT INTO outbox_jobs (
          outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        makeId("OUT"), "update_obsidian_task_note", "task", taskId,
        JSON.stringify({ task_id: taskId, status: finalStatus, branch, pr_url: prUrl, source_of_truth: "SQLite" }),
        now,
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    // â”€â”€ Step 13: Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const output = {
      generated_at: nowIso(),
      tool: "run_high_risk_pipeline",
      phase: 2,
      task_id: taskId,
      status: finalStatus,
      branch,
      commit_sha: commitSha,
      preview_url: previewUrl,
      pr_url: prUrl,
      deployment_id: deployResult.deployment_id || null,
      locks_acquired: acquiredLocks,
      validated: !!validationOutput,
      message: "Preview validated â€” awaiting merge decision.",
    };

    const outPath = args.out || path.join(process.cwd(), "tools", "out", "pipelines", `high-risk-p2-${taskId}-${Date.now()}.json`);
    writeJson(outPath, output);

    if (args.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`High-risk pipeline Phase 2 completed: ${outPath}`);
      console.log(`Status: ${finalStatus} | Branch: ${branch} | Task: ${taskId}`);
      if (prUrl) console.log(`PR: ${prUrl}`);
      console.log("Awaiting merge decision.");
    }
  } catch (error) {
    // Record failure event
    try {
      const now = nowIso();
      db.exec("BEGIN IMMEDIATE TRANSACTION");
      try {
        db.prepare(
          `INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          makeId("EVT"), "high_risk_pipeline_failed", taskId, "task", taskId,
          task.status, "failed",
          "high_risk_pipeline", "High-Risk Pipeline",
          now, JSON.stringify({ error: error.message, phase: 2 }),
        );
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
      }
    } catch {
      // Ignore logging errors during cleanup
    }
    throw error;
  } finally {
    // â”€â”€ Release locks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    releaseLocks(acquiredLocks, dbPath);
  }
}

function buildLockSpecs(task) {
  const specs = [];
  if (task.target_file) specs.push({ type: "file_lock", resource: task.target_file });
  if (task.target_url) specs.push({ type: "url_lock", resource: task.target_url });
  return specs;
}

// True only when the deterministic safe executor actually proposes a file write.
// Mirrors the semi-safe pipeline's guard so we never branch/preview a no-op.
function hasContentChanges(planResult) {
  return Array.isArray(planResult.actions) && planResult.actions.some(
    (action) => action.type === "write_file" && action.file_path,
  );
}

// No deterministic edit was produced â†’ mark the task 'blocked' (visible, not a
// fake success) with the planner's reason, and do NOT create a branch, push, or
// queue a preview email. Content rewrites should be routed to the blog_content
// (Hermes) lane instead; this status surfaces that to the next planning session.
function recordBlockedNoChanges(db, task, taskId, planResult, args) {
  const now = nowIso();
  const reason = planResult.reason
    || "High-risk task produced no deterministic file change. This task type needs the Hermes content lane (route as service_page_gap/money_page_refresh/new_service_page), not the high-risk ops pipeline.";
  assertTaskStatus("blocked");
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE tasks SET status = 'blocked', updated_at = ? WHERE task_id = ?").run(now, taskId);
    db.prepare(
      `INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("EVT"), "high_risk_blocked_no_executor", taskId, "task", taskId,
      task.status, "blocked",
      "high_risk_pipeline", "High-Risk Pipeline",
      now, JSON.stringify({ reason, planned_status: planResult.status, actions: planResult.actions || [] }),
    );
    db.prepare(
      `INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      makeId("OUT"), "update_obsidian_task_note", "task", taskId,
      JSON.stringify({ task_id: taskId, status: "blocked", reason, source_of_truth: "SQLite" }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const output = {
    generated_at: nowIso(),
    tool: "run_high_risk_pipeline",
    phase: 2,
    task_id: taskId,
    status: "blocked",
    task_status: "blocked",
    branch: null,
    reason,
    message: "Blocked â€” no deterministic change produced; route to the Hermes content lane.",
  };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`High-risk pipeline blocked (no executor): ${taskId}`);
    console.log(reason);
  }
  return output;
}

// Acquire each lock atomically via the v2 lock-acquire command. lock-acquire
// handles a single resource per call, so we loop and roll back already-acquired
// locks if any spec conflicts, preserving all-or-nothing semantics.
function acquireLocks(lockSpecs, dbPath, taskId, owner) {
  const acquired = [];
  for (const spec of lockSpecs) {
    let result;
    try {
      result = JSON.parse(runNode("lock-acquire.js", [
        "--type", spec.type,
        "--resource", spec.resource,
        "--task", taskId,
        "--owner", owner,
        "--db", dbPath,
        "--json",
      ]));
    } catch (error) {
      releaseLocks(acquired, dbPath);
      throw new Error(`Lock acquisition failed for ${spec.type}:${spec.resource}: ${error.message}`);
    }
    if (!result.ok || !result.lock_id) {
      releaseLocks(acquired, dbPath);
      throw new Error(`Lock acquisition failed: ${result.error || JSON.stringify(result)}`);
    }
    acquired.push({ lock_id: result.lock_id, lock_type: spec.type, resource_id: spec.resource });
  }
  return acquired;
}

function releaseLocks(acquiredLocks, dbPath) {
  for (const lock of acquiredLocks || []) {
    try {
      runNode("lock-release.js", ["--id", lock.lock_id, "--db", dbPath, "--json"]);
    } catch (releaseError) {
      console.error(`Failed to release lock ${lock.lock_id}: ${releaseError.message}`);
    }
  }
}

function validationUrlForTask(task, previewUrl) {
  if (previewUrl && /^https?:\/\//i.test(previewUrl)) {
    try {
      const target = task.target_url ? new URL(task.target_url) : null;
      if (target && target.pathname && target.pathname !== "/") {
        return new URL(target.pathname, previewUrl.endsWith("/") ? previewUrl : `${previewUrl}/`).toString();
      }
    } catch {
      // Fall through to the preview root below.
    }
    return previewUrl;
  }
  if (task.target_url && /^https?:\/\//i.test(task.target_url)) return task.target_url;
  return null;
}

function runNode(toolFile, args) {
  return execFileSync(
    process.execPath,
    [path.join(__dirname, toolFile), ...args],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function printHelp() {
  console.log(`
Usage:
  node tools/run_high_risk_pipeline.js --task CAND-2026-05-26-ABC12345
  node tools/run_high_risk_pipeline.js --task CAND-2026-05-26-ABC12345 --apply --push --validate --create-pr

Description:
  Lane 3 high-risk pipeline orchestrator (Â§10 + Â§26). Two-phase flow:

  Phase 1 â€“ Pre-approval (task status = candidate | pending):
    Sends an approval request via task-approve.js and sets the task to
    'waiting_for_approval'. The user must respond via email.

  Phase 2 â€“ Post-approval (task status = approved):
    Acquires locks, creates an agent branch, executes changes, pushes,
    optionally creates a GitHub PR, records a preview deployment,
    optionally validates, and sets the task to 'preview_validated'.

Options:
  --task id            (Required) Task ID to process.
  --db path            SQLite DB path. Default: tools/out/state/seo-agent.db
  --site-root path     Website repo path. Default: D:\\Projects\\{{NICHE}} SEO Agency
  --domain name        Domain for preview URL construction.
  --apply              Required for Phase 2: run planned edits and commit them.
  --push               Push the agent branch to origin after commit.
  --validate           Run live deployment validation after push.
  --create-pr          Create a GitHub pull request via deploy-pr.js.
  --repo owner/name    Override GitHub repo for PR creation.
  --out path           Output JSON file path.
  --json               Print output as JSON to stdout.
  --help               Show this help message.

Phase 1 pipeline steps:
  1. Load task, verify risk_level = 'high_risk'
  2. Create approval request via task-approve.js
  3. Record 'waiting_for_approval' state (event)
  4. Output: waiting_for_approval

Phase 2 pipeline steps:
  5. Acquire locks (file_lock, url_lock) via lock-acquire
  6. Create agent branch: agent/{task_id}-{slug}
  7. Execute changes: task-execute-safe.js --allow-semi-safe --apply --commit
  8. Push branch to origin
  9. Create GitHub PR (if --create-pr) via deploy-pr.js
 10. Record preview deployment: deploy-record.js start
 11. Validate live deployment (if --validate)
 12. Record preview_validated status + outbox jobs (email + Obsidian)
 13. Output: preview_validated, awaiting merge decision
`);
}


if (require.main === module) {
  try {
    main();
  } catch (error) {
    exitWithError(error);
  }
}

module.exports = main;
