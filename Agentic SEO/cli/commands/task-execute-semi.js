#!/usr/bin/env node
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { writeJson, slugify } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const git = require("../lib/git");
const { loadBrain, assertAllowedByBrain, logBrainEvent } = require("../lib/obsidian_brain");
const { routeTask } = require("../lib/task_routing");
const { assertTaskStatus } = require("../lib/statuses");
const { assertTaskExecutionAllowed } = require("../lib/guardrails");
const { previewUrlForBranch } = require("../lib/preview_urls");

/**
 * Lane 2 â€“ Semi-Safe Pipeline Orchestrator (Â§10)
 *
 * Runs the full semi-safe flow for a single task:
 *   1. Load & verify task (risk_level = semi_safe OR approved)
 *   2. Acquire locks via lock-acquire
 *   3. Create agent branch
 *   4. Execute edits via task-execute-safe.js --allow-semi-safe
 *   5. Local validation via crawl.js
 *   6. Push branch (if --push)
 *   7. Record preview deployment via deploy-record.js
 *   8. Validate live deployment (if --validate)
 *   9. Record preview_ready in SQLite (event + outbox)
 *  10. Output: preview_ready, awaiting human approval
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

  // â”€â”€ Step 1: Load task, verify risk_level â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const brain = loadBrain({ vaultRoot: args["brain-vault"] || args.vault, mode: "execution", autoCompile: args.compile !== false }).brain;
  const brainDecision = assertAllowedByBrain(task, brain);
  if (!brainDecision.allowed) {
    logBrainEvent(db, task, brainDecision, "semi_safe_pipeline");
    throw new Error(`Task ${taskId} blocked by Obsidian Brain rule ${brainDecision.rule_id}: ${brainDecision.reason}`);
  }

  const isApproved = task.status === "approved";
  if (task.risk_level !== "semi_safe" && !isApproved) {
    throw new Error(
      `Task ${taskId} has risk_level='${task.risk_level}' and status='${task.status}'. ` +
      `Semi-safe pipeline requires risk_level='semi_safe' or status='approved'.`,
    );
  }
  if (!args.apply) {
    throw new Error("Semi-safe pipeline passes --apply --commit to task-execute-safe after planning. Pass --apply to confirm.");
  }
  assertTaskExecutionAllowed(db, task);

  const route = routeTask(task, { has_approved_approval: true });
  if (route.execution_lane === "blog_content") {
    throw new Error(
      `Task ${taskId} is blog content (${route.workflow_bucket}); use the dedicated blog publisher/editor workflow ` +
      `and record preview_ready with tools/record_blog_preview_ready.js.`,
    );
  }
  if (route.execution_lane !== "general_operational" || route.workflow_bucket !== "general_candidate_triage") {
    throw new Error(
      `Task ${taskId} is not eligible for the generic semi-safe pipeline ` +
      `(lane=${route.execution_lane}, bucket=${route.workflow_bucket}).`,
    );
  }

  const branch = `agent/${task.task_id}-${slugify(task.title).slice(0, 45)}`;
  const lockSpecs = buildLockSpecs(task);
  let acquiredLocks = [];

  try {
    // â”€â”€ Step 2: Acquire locks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (lockSpecs.length > 0) {
      acquiredLocks = acquireLocks(lockSpecs, dbPath, taskId, "semi_safe_pipeline");
    }

    // â”€â”€ Step 3: Plan first; monitoring/investigation-only tasks do not need branches.
    const planOutput = runNode("task-execute-safe.js", [
      "--task", taskId,
      "--db", dbPath,
      "--site-root", siteRoot,
      "--skip-locks",
      "--json",
      ...(args["brain-vault"] ? ["--brain-vault", args["brain-vault"]] : []),
    ]);
    const planResult = JSON.parse(planOutput);
    if (!hasContentChanges(planResult)) {
      return recordNoPreviewRequired(db, task, taskId, planResult, args);
    }

    // â”€â”€ Step 4: Create agent branch only for proposed content/page edits â”€
    git.checkoutNewBranch(siteRoot, branch);

    // â”€â”€ Step 5: Execute edits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const execArgs = [
      "--task", taskId,
      "--db", dbPath,
      "--site-root", siteRoot,
      "--allow-semi-safe",
      "--skip-locks",
      "--apply",
      "--commit",
      ...(args["brain-vault"] ? ["--brain-vault", args["brain-vault"]] : []),
    ];
    const execOutput = runNode("task-execute-safe.js", execArgs);

    // â”€â”€ Step 6: Local validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const crawlArgs = ["--site-root", siteRoot];
    if (domain) crawlArgs.push("--domain", domain);
    crawlArgs.push("--db", dbPath);
    const crawlOutput = runNode("crawl.js", crawlArgs);

    // â”€â”€ Step 6: Push branch (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let pushOutput = null;
    if (args.push) {
      pushOutput = git.push(siteRoot, "origin", branch, true);
    }

    // â”€â”€ Step 7: Record preview deployment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const commitSha = git.shortHead(siteRoot);
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

    const githubLinks = buildGithubLinks(siteRoot, branch, args);
    let previewUrl = previewUrlForBranch(branch, domain);
    let cloudflarePreviewUrl = null;
    let cloudflareBlogUrl = null;
    let cloudflareWaitOutput = null;
    let cloudflareWaitError = null;

    // â”€â”€ Step 8: Discover and validate live Cloudflare preview (optional) â”€
    let validationOutput = null;
    let validationSkippedReason = null;
    if (args.validate && args.push) {
      try {
        cloudflareWaitOutput = JSON.parse(runNode("deploy-wait.js", [
          "--branch", branch,
          "--db", dbPath,
          "--state-deployment-id", deployResult.deployment_id,
          "--timeout-seconds", String(args["cloudflare-timeout-seconds"] || 180),
          "--interval-seconds", String(args["cloudflare-interval-seconds"] || 10),
          "--json",
        ]));
        if (cloudflareWaitOutput.ok && cloudflareWaitOutput.matched) {
          cloudflarePreviewUrl = firstNonEmpty(
            cloudflareWaitOutput.matched.url,
            Array.isArray(cloudflareWaitOutput.matched.aliases) ? cloudflareWaitOutput.matched.aliases[0] : null,
          );
          if (cloudflarePreviewUrl) previewUrl = cloudflarePreviewUrl;
        } else {
          validationSkippedReason = `Cloudflare deployment not ready: ${cloudflareWaitOutput.status || "unknown"}`;
        }
      } catch (error) {
        cloudflareWaitError = error.message;
        validationSkippedReason = `Cloudflare preview lookup failed: ${error.message}`;
      }

      const previewPath = publicPathForTask(task);
      cloudflareBlogUrl = cloudflarePreviewUrl && previewPath ? joinUrl(cloudflarePreviewUrl, previewPath) : null;
      const validationUrl = cloudflareBlogUrl || cloudflarePreviewUrl || (domain ? previewUrl : null);
      if (validationUrl && !String(validationUrl).startsWith("branch:")) {
        const validateArgs = [
          "--preview",
          "--url", validationUrl,
          "--db", dbPath,
          "--deployment-id", deployResult.deployment_id,
          "--task", taskId,
        ];
        if (domain) validateArgs.push("--domain", domain);
        if (task.target_keyword) validateArgs.push("--keyword", task.target_keyword);
        validationOutput = runNode("deploy-validate.js", validateArgs);
      } else if (!validationSkippedReason) {
        validationSkippedReason = "No live Cloudflare preview URL was available; branch was pushed and recorded without live URL validation.";
      }
    }

    // â”€â”€ Step 9: Record pipeline result in SQLite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const now = nowIso();
    assertTaskStatus("preview_ready");
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      db.prepare("UPDATE tasks SET status = 'preview_ready', updated_at = ? WHERE task_id = ?").run(now, taskId);

      db.prepare(
        `INSERT INTO events (
          event_id, event_type, task_id, resource_type, resource_id,
          old_value, new_value, source, agent_name, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        makeId("EVT"), "semi_safe_pipeline_completed", taskId, "task", taskId,
        task.status, "preview_ready",
        "semi_safe_pipeline", "Semi-Safe Pipeline",
        now, JSON.stringify({
          branch,
          commit_sha: commitSha,
          preview_url: previewUrl,
          cloudflare_preview_url: cloudflarePreviewUrl,
          cloudflare_blog_url: cloudflareBlogUrl,
          github_branch_url: githubLinks.branch_url,
          github_compare_url: githubLinks.compare_url,
          cloudflare_wait_error: cloudflareWaitError,
        }),
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
          cloudflare_preview_url: cloudflarePreviewUrl,
          cloudflare_blog_url: cloudflareBlogUrl,
          github_branch_url: githubLinks.branch_url,
          github_compare_url: githubLinks.compare_url,
          target_url: task.target_url || null,
          target_file: task.target_file || null,
          risk_level: task.risk_level,
          status: "preview_ready",
        }),
        now,
      );

      db.prepare(
        `INSERT INTO outbox_jobs (
          outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        makeId("OUT"), "update_obsidian_task_note", "task", taskId,
        JSON.stringify({ task_id: taskId, status: "preview_ready", branch, source_of_truth: "SQLite" }),
        now,
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    // â”€â”€ Step 10: Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const output = {
      generated_at: nowIso(),
      tool: "run_semi_safe_pipeline",
      task_id: taskId,
      status: "preview_ready",
      branch,
      commit_sha: commitSha,
      preview_url: previewUrl,
      cloudflare_preview_url: cloudflarePreviewUrl,
      cloudflare_blog_url: cloudflareBlogUrl,
      github_branch_url: githubLinks.branch_url,
      github_compare_url: githubLinks.compare_url,
      deployment_id: deployResult.deployment_id || null,
      locks_acquired: acquiredLocks,
      push: !!args.push,
      validated: !!validationOutput,
      validation_skipped_reason: validationSkippedReason,
      cloudflare_wait: cloudflareWaitOutput,
      cloudflare_wait_error: cloudflareWaitError,
      message: "Preview ready â€” awaiting human approval before merge.",
    };

    const outPath = args.out || path.join(process.cwd(), "tools", "out", "pipelines", `semi-safe-${taskId}-${Date.now()}.json`);
    writeJson(outPath, output);

    if (args.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Semi-safe pipeline completed: ${outPath}`);
      console.log(`Status: preview_ready | Branch: ${branch} | Task: ${taskId}`);
      console.log("Awaiting human approval before merge.");
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
          makeId("EVT"), "semi_safe_pipeline_failed", taskId, "task", taskId,
          task.status, "failed",
          "semi_safe_pipeline", "Semi-Safe Pipeline",
          now, JSON.stringify({ error: error.message }),
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
    // â”€â”€ Release locks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    releaseLocks(acquiredLocks, dbPath);
    db.close();
  }
}

function buildLockSpecs(task) {
  const specs = [];
  if (task.target_file) specs.push({ type: "file_lock", resource: task.target_file });
  if (task.target_url) specs.push({ type: "url_lock", resource: task.target_url });
  return specs;
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

function hasContentChanges(planResult) {
  return Array.isArray(planResult.actions) && planResult.actions.some(
    (action) => action.type === "write_file" && action.file_path,
  );
}

function recordNoPreviewRequired(db, task, taskId, planResult, args) {
  const now = nowIso();
  assertTaskStatus("monitored");
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE tasks SET status = 'monitored', updated_at = ? WHERE task_id = ?").run(now, taskId);
    db.prepare(
      `INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("EVT"), "semi_safe_no_preview_required", taskId, "task", taskId,
      task.status, "monitored",
      "semi_safe_pipeline", "Semi-Safe Pipeline",
      now, JSON.stringify({
        reason: planResult.reason || "No content/page edit was proposed; no preview branch required.",
        planned_status: planResult.status,
        actions: planResult.actions || [],
      }),
    );
    db.prepare(
      `INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      makeId("OUT"), "update_obsidian_task_note", "task", taskId,
      JSON.stringify({
        task_id: taskId,
        status: "monitored",
        preview_required: false,
        source_of_truth: "SQLite",
        reason: planResult.reason || "No content/page edit was proposed; no preview branch required.",
      }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const output = {
    generated_at: nowIso(),
    tool: "run_semi_safe_pipeline",
    task_id: taskId,
    status: "no_preview_required",
    task_status: "monitored",
    branch: null,
    preview_url: null,
    actions: planResult.actions || [],
    reason: planResult.reason || "No content/page edit was proposed; no preview branch required.",
    message: "Monitoring/investigation-only task recorded without creating a preview branch.",
  };
  const outPath = args.out || path.join(process.cwd(), "tools", "out", "pipelines", `semi-safe-${taskId}-${Date.now()}.json`);
  writeJson(outPath, output);

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`Semi-safe pipeline completed without preview: ${outPath}`);
    console.log(`Status: no_preview_required | Branch: none | Task: ${taskId}`);
  }
  return output;
}

function buildGithubLinks(siteRoot, branch, args = {}) {
  try {
    const repo = git.githubRepo(siteRoot);
    const encodedBranch = encodeGithubRefPath(branch);
    const base = args.base || process.env.GITHUB_PR_BASE || process.env.CLOUDFLARE_PRODUCTION_BRANCH || "master";
    return {
      branch_url: `https://github.com/${repo.owner}/${repo.repo}/tree/${encodedBranch}`,
      compare_url: `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeGithubRefPath(base)}...${encodedBranch}`,
    };
  } catch {
    return { branch_url: null, compare_url: null };
  }
}

function publicPathForTask(task) {
  if (task.target_url) {
    try {
      const parsed = new URL(task.target_url);
      if (parsed.pathname && parsed.pathname !== "/") return normalizePublicPath(parsed.pathname);
    } catch {
      if (String(task.target_url).startsWith("/")) return normalizePublicPath(task.target_url);
    }
  }
  if (task.target_file) return filePathToPublicPath(task.target_file);
  try {
    const metadata = JSON.parse(task.metadata_json || "{}");
    const candidate = metadata.target_url || metadata.url || metadata.slug || metadata.evidence?.target_url || metadata.evidence?.url;
    if (candidate) {
      if (String(candidate).startsWith("http")) return normalizePublicPath(new URL(candidate).pathname);
      if (String(candidate).startsWith("/")) return normalizePublicPath(candidate);
      return normalizePublicPath(`/blog/${candidate}`);
    }
  } catch {
    // Ignore malformed metadata; the email will still include the branch and preview root.
  }
  return null;
}

function filePathToPublicPath(filePath) {
  let value = String(filePath || "").replace(/\\/g, "/");
  value = value.replace(/^.*?\bblog\//, "blog/");
  if (!value.startsWith("/")) value = `/${value}`;
  return normalizePublicPath(value);
}

function normalizePublicPath(value) {
  let pathname = String(value || "").trim();
  if (!pathname) return null;
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "");
  return pathname;
}

function joinUrl(base, pathname) {
  try {
    return new URL(pathname, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return null;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function encodeGithubRefPath(ref) {
  return String(ref || "").split("/").map((part) => encodeURIComponent(part)).join("/");
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
  node tools/run_semi_safe_pipeline.js --task CAND-2026-05-26-ABC12345 --apply
  node tools/run_semi_safe_pipeline.js --task CAND-2026-05-26-ABC12345 --apply --push --validate

Description:
  Lane 2 semi-safe pipeline orchestrator (Â§10). Runs the full semi-safe flow
  for a single task: load â†’ lock â†’ branch â†’ edit â†’ validate â†’ push â†’ deploy â†’ record.
  The task must have risk_level='semi_safe' or status='approved'.
  After completion the task is set to 'preview_ready' and awaits human approval.

Options:
  --task id            (Required) Task ID to process.
  --db path            SQLite DB path. Default: tools/out/state/seo-agent.db
  --site-root path     Website repo path. Default: D:\\Projects\\{{NICHE}} SEO Agency
  --domain name        Domain for preview URL construction.
  --apply              Required confirmation: run planned edits and commit them.
  --push               Push the agent branch to origin after commit.
  --validate           Run live deployment validation after push.
  --out path           Output JSON file path.
  --json               Print output as JSON to stdout.
  --help               Show this help message.

Pipeline steps:
  1. Load task from SQLite, verify risk_level is 'semi_safe' or approved
  2. Acquire locks (file_lock, url_lock) via lock-acquire
  3. Create agent branch: agent/{task_id}-{slug}
  4. Execute edits: task-execute-safe.js --allow-semi-safe --apply --commit
  5. Local validation: crawl.js
  6. Push branch to origin (if --push)
  7. Record preview deployment: deploy-record.js start
  8. Validate live deployment (if --validate and --push)
  9. Record preview_ready status in SQLite (event + outbox jobs)
 10. Output: preview_ready, awaiting human approval
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
