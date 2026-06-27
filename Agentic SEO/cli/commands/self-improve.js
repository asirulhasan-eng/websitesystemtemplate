#!/usr/bin/env node
/**
 * self-improve.js - Execute approved agent-substrate repair tasks.
 *
 * This command is deliberately narrow: it only accepts tasks routed to the
 * self_improvement lane, refuses forbidden targets, and requires the
 * SELF_IMPROVEMENT_ENABLED kill switch before any apply-mode mutation.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { parseArgs, requireArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb, makeId } = require("../lib/state_db");
const { routeTask } = require("../lib/task_routing");
const { nowIso } = require("../lib/dates");

const TOOL = "self-improve";
const CANONICAL_DB_PATH = "/opt/website-state/website-agent.db";
const DEFAULT_AGENT_ROOT = path.resolve(__dirname, "..", "..");
const MAX_FILES_PER_CHANGE = 8;

const ALLOWED_PREFIXES = [
  "cli/",
  "cron/",
  "processes/",
  "hermes/skills/client/",
  "processes/brain-seed/",
];

const FORBIDDEN_PATTERNS = [
  /^Website\//i,
  /^\.env$/i,
  /^config\/no_go_keywords\.json$/i,
  /^config\/guardrails\.json#?(require_explicit_approval|auto_approve_up_to_risk_level|self_improvement)?$/i,
  /(^|\/)(credentials|secrets)(\/|$)/i,
  /\b(dns|domain|ssl|robots|sitemap)\b/i,
];

const HELP = `
self-improve - Execute approved self_improvement repair tasks

USAGE
  v2 self-improve --task <id> --dry-run [options]
  v2 self-improve --task <id> --apply [options]
  v2 self-improve --sample --json

OPTIONS
  --task <id>     Approved self_improvement-lane task to inspect or apply.
  --dry-run       Build the Engineer prompt and scope plan only; no DB/file writes.
  --apply         Run the bounded repair loop. Requires SELF_IMPROVEMENT_ENABLED=true.
  --agent-root    Agent repo root (default: WEBSITE_AGENT_ROOT or repo root).
  --db <path>     SQLite DB path.
  --json          JSON output (default).
  --sample        Emit a valid sample envelope without DB interaction.
  --help          Show this help.
`.trim();

module.exports = function selfImprove() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      mode: "sample",
      task_id: "TSK-SELFIMPROVE-SAMPLE",
      execution_lane: "self_improvement",
      workflow_bucket: "meta_repair",
      dispatch: "self-improve",
      target_files: ["cron/run-outbox.sh", "processes/self-evaluation.md"],
      forbidden_matches: [],
      prompt: buildPrompt({
        task: sampleTask(),
        metadata: sampleMetadata(),
        targetFiles: ["cron/run-outbox.sh", "processes/self-evaluation.md"],
        agentRoot: DEFAULT_AGENT_ROOT,
      }),
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const taskId = requireArg(args, "task", "Missing --task <id>");
    const dryRun = Boolean(args["dry-run"]);
    const apply = Boolean(args.apply);
    if (dryRun === apply) {
      throw new Error("Choose exactly one of --dry-run or --apply.");
    }

    const agentRoot = path.resolve(args["agent-root"] || process.env.WEBSITE_AGENT_ROOT || DEFAULT_AGENT_ROOT);
    const db = openStateDb(resolveDbPath(args));

    try {
      const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      const route = routeTask(task, { now: nowIso() });
      assertSelfImprovementTask(task, route);

      const metadata = safeJson(task.metadata_json);
      const evidence = metadata.evidence && typeof metadata.evidence === "object" ? metadata.evidence : {};
      const targetFiles = normalizeTargetFiles(evidence.target_files || metadata.target_files || task.target_file, agentRoot);
      const scope = evaluateScope(targetFiles);
      const prompt = buildPrompt({ task, metadata, targetFiles, agentRoot });

      if (dryRun) {
        printOutput(envelope({
          mode: "dry-run",
          task_id: task.task_id,
          route,
          target_files: targetFiles,
          forbidden_matches: scope.forbidden,
          allowed: scope.allowed,
          prompt,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      if (process.env.SELF_IMPROVEMENT_ENABLED !== "true") {
        throw new Error("SELF_IMPROVEMENT_ENABLED must be true for --apply.");
      }

      if (!scope.allowed) {
        blockApprovedTask(db, task, "Forbidden or out-of-scope self-improvement target.", { target_files: targetFiles, forbidden: scope.forbidden });
        printOutput(envelope({
          mode: "apply",
          status: "blocked",
          task_id: task.task_id,
          reason: "forbidden_target",
          forbidden_matches: scope.forbidden,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      const result = applyRepair({ db, task, metadata, targetFiles, prompt, agentRoot });
      printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function assertSelfImprovementTask(task, route) {
  if (task.status !== "approved") {
    throw new Error(`Task ${task.task_id} must be status=approved, got ${task.status}.`);
  }
  if (route.execution_lane !== "self_improvement" || route.workflow_bucket !== "meta_repair") {
    throw new Error(`Task ${task.task_id} is not routed to self_improvement/meta_repair.`);
  }
}

function applyRepair({ db, task, metadata, targetFiles, prompt, agentRoot }) {
  assertGitRepo(agentRoot);
  const lock = acquireGitLock(db, task.task_id);
  let stashed = false;
  const originalBranch = git(agentRoot, ["branch", "--show-current"]) || "main";
  const branch = `agent/selfimprove-${task.task_id.toLowerCase()}`;

  try {
    if (git(agentRoot, ["status", "--porcelain"])) {
      git(agentRoot, ["stash", "push", "-u", "-m", `self-improve-preserve-${task.task_id}`]);
      stashed = true;
    }

    checkoutBaseBranch(agentRoot, branch);
    runEngineerSession(agentRoot, prompt);

    const changedFiles = changedFilesSince(agentRoot, "main");
    const changedScope = evaluateScope(changedFiles);
    if (changedFiles.length === 0) {
      const refreshedTask = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(task.task_id);
      if (refreshedTask?.status === "completed") {
        safeGit(agentRoot, ["checkout", originalBranch]);
        safeGit(agentRoot, ["branch", "-D", branch]);
        const stashRestore = stashed ? safeGit(agentRoot, ["stash", "pop"]) : "";
        if (stashed) stashed = false;
        return {
          mode: "apply",
          status: "completed",
          task_id: task.task_id,
          branch,
          commit_sha: null,
          changed_files: [],
          gate: [],
          skill_sync: { required: false, ran: false },
          stashed_unrelated_changes: Boolean(stashRestore),
          metadata_gap: metadata.evidence?.gap || null,
          note: "Task was completed by the Engineer session via CLI-only reconciliation; no git changes were required.",
        };
      }
      throw new Error("Engineer session completed without changing any files.");
    }
    if (changedFiles.length > MAX_FILES_PER_CHANGE) {
      throw new Error(`Self-improvement changed ${changedFiles.length} files; max is ${MAX_FILES_PER_CHANGE}.`);
    }
    if (!changedScope.allowed) {
      throw new Error(`Engineer session changed forbidden files: ${changedScope.forbidden.join(", ")}`);
    }

    const gate = runGate(agentRoot, changedFiles);
    git(agentRoot, ["add", ...changedFiles]);
    git(agentRoot, [
      "-c", "user.name=Website Operations Agent",
      "-c", "user.email=agent@example.com",
      "commit",
      "-m", `Self-improve ${task.task_id}`,
      "-m", `Co-Authored-By: Website Operations Agent <agent@example.com>`,
    ]);
    const commitSha = git(agentRoot, ["rev-parse", "HEAD"]);

    git(agentRoot, ["checkout", "main"]);
    git(agentRoot, ["merge", "--no-ff", branch, "-m", `Merge self-improvement ${task.task_id}`]);
    git(agentRoot, ["push", "origin", "main"]);

    const skillSync = maybeRunSkillSync(agentRoot, changedFiles);
    completeTask(db, task, commitSha, { changed_files: changedFiles, gate, skill_sync: skillSync });
    const stashRestore = stashed ? safeGit(agentRoot, ["stash", "pop"]) : "";
    if (stashed) stashed = false;

    return {
      mode: "apply",
      status: "completed",
      task_id: task.task_id,
      branch,
      commit_sha: commitSha,
      changed_files: changedFiles,
      gate,
      skill_sync: skillSync,
      stashed_unrelated_changes: Boolean(stashRestore),
      metadata_gap: metadata.evidence?.gap || null,
    };
  } catch (error) {
    safeGit(agentRoot, ["checkout", originalBranch]);
    safeGit(agentRoot, ["branch", "-D", branch]);
    if (stashed) safeGit(agentRoot, ["stash", "pop"]);
    blockApprovedTask(db, task, error.message, { target_files: targetFiles, branch });
    return {
      mode: "apply",
      status: "blocked",
      task_id: task.task_id,
      reason: error.message,
      branch,
      stashed_unrelated_changes: stashed,
    };
  } finally {
    releaseGitLock(db, lock);
    if (stashed) safeGit(agentRoot, ["stash", "pop"]);
  }
}

function checkoutBaseBranch(agentRoot, branch) {
  git(agentRoot, ["checkout", "main"]);
  try {
    git(agentRoot, ["pull", "--ff-only", "origin", "main"]);
  } catch {
    // Local-only test repos or deploy hosts without remote access can still run
    // the repair gate; the final push will surface any real deployment issue.
  }
  safeGit(agentRoot, ["branch", "-D", branch]);
  git(agentRoot, ["checkout", "-b", branch]);
}

function runEngineerSession(agentRoot, prompt) {
  const hermes = commandExists("hermes");
  if (!hermes) {
    throw new Error("hermes CLI not available; self-improvement task requires an Engineer Hermes session.");
  }
  const result = spawnSync("hermes", ["chat", "-q", prompt, "--quiet", "--yolo", "--accept-hooks"], {
    cwd: agentRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 1440 * 1000,
  });
  if (result.status !== 0) {
    throw new Error(`Engineer Hermes session failed: ${(result.stderr || result.stdout || "").slice(0, 1000)}`);
  }
}

function runGate(agentRoot, changedFiles) {
  const gate = [];
  for (const file of changedFiles.filter((name) => name.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", file], { cwd: agentRoot, stdio: "pipe" });
    gate.push({ check: "node_check", file, status: "passed" });
  }
  for (const file of changedFiles.filter((name) => name.endsWith(".sh"))) {
    execFileSync("bash", ["-n", file], { cwd: agentRoot, stdio: "pipe" });
    gate.push({ check: "bash_n", file, status: "passed" });
  }

  const touchesCli = changedFiles.some((file) => file.startsWith("cli/"));
  if (touchesCli) {
    execFileSync("npm", ["test"], { cwd: path.join(agentRoot, "cli"), stdio: "pipe" });
    gate.push({ check: "npm_test", cwd: "cli", status: "passed" });
  }
  return gate;
}

function maybeRunSkillSync(agentRoot, changedFiles) {
  if (!changedFiles.some((file) => file.startsWith("hermes/skills/"))) {
    return { required: false, ran: false };
  }
  const script = path.join(agentRoot, "hermes", "deploy-hermes.sh");
  if (!fs.existsSync(script)) {
    return { required: true, ran: false, reason: "sync_script_missing" };
  }
  execFileSync("bash", [script], { cwd: agentRoot, stdio: "pipe" });
  return { required: true, ran: true, script: "hermes/deploy-hermes.sh" };
}

function buildPrompt({ task, metadata, targetFiles, agentRoot }) {
  const evidence = metadata.evidence && typeof metadata.evidence === "object" ? metadata.evidence : {};
  return [
    "You are the Website Operations Engineer self-improvement worker.",
    "",
    `Task: ${task.task_id} - ${task.title}`,
    `Agent repo: ${agentRoot}`,
    `Canonical DB env: WEBSITE_AGENT_DB_PATH=${CANONICAL_DB_PATH}`,
    "",
    "Scope contract:",
    `Allowed prefixes: ${ALLOWED_PREFIXES.join(", ")}`,
    "Forbidden: guardrail cage keys, no-go config, secrets, Website/**, DNS/domain/SSL/robots/sitemap, executor deletion.",
    "",
    "Acceptance:",
    evidence.acceptance || "Make the minimal reversible repair, add/update tests when touching logic, and pass the static/test gate.",
    "",
    "Evidence:",
    JSON.stringify(evidence, null, 2),
    "",
    "Target files:",
    targetFiles.length ? targetFiles.map((file) => `- ${file}`).join("\n") : "- none supplied; discover the smallest allowed target set from evidence",
    "",
    "Required steps:",
    "1. Read the failing artifact and relevant tests.",
    "2. Edit only allowed files; do not touch secrets, safety-cage keys, or Website/.",
    "3. Add/update tests for logic changes.",
    "4. Run node --check/bash -n/npm test as applicable.",
    "5. Leave one revertable commit-worth of changes and summarize the acceptance criterion.",
  ].join("\n");
}

function normalizeTargetFiles(value, agentRoot = DEFAULT_AGENT_ROOT) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  const roots = [
    agentRoot,
    process.env.WEBSITE_AGENT_ROOT,
    "/opt/website-agent",
  ]
    .filter(Boolean)
    .map((root) => path.resolve(String(root).replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/$/, ""));

  return values
    .map((item) => {
      let file = String(item || "").replace(/\\/g, "/").trim();
      for (const root of roots) {
        if (file === root) return "";
        if (file.startsWith(`${root}/`)) {
          file = file.slice(root.length + 1);
          break;
        }
      }
      return file.replace(/^\.?\//, "");
    })
    .filter(Boolean);
}

function evaluateScope(files) {
  const forbidden = [];
  for (const file of files) {
    if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(file))) {
      forbidden.push(file);
      continue;
    }
    if (!ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      forbidden.push(file);
    }
  }
  return { allowed: forbidden.length === 0, forbidden };
}

function acquireGitLock(db, taskId) {
  const now = nowIso();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const conflict = db.prepare(`
    SELECT lock_id, owner_agent, expires_at FROM locks
    WHERE lock_type = 'general' AND resource_id = 'site-git' AND status = 'active'
      AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `).get(now);
  if (conflict) throw new Error(`site-git lock held by ${conflict.owner_agent || conflict.lock_id}`);

  const lockId = makeId("LCK");
  db.prepare(`
    INSERT INTO locks (lock_id, lock_type, resource_id, task_id, owner_agent, status, created_at, expires_at, heartbeat_at, reason, metadata_json)
    VALUES (?, 'general', 'site-git', ?, 'self-improve', 'active', ?, ?, ?, 'self-improvement apply', ?)
  `).run(lockId, taskId, now, expires, now, JSON.stringify({ acquired_via: TOOL }));
  return lockId;
}

function releaseGitLock(db, lockId) {
  if (!lockId) return;
  db.prepare("UPDATE locks SET status = 'released', released_at = ? WHERE lock_id = ?").run(nowIso(), lockId);
}

function completeTask(db, task, commitSha, metadata) {
  const now = nowIso();
  const current = safeJson(task.metadata_json);
  current.evidence = { ...(current.evidence || {}), commit_sha: commitSha };
  current.self_improvement = { ...(current.self_improvement || {}), ...metadata, completed_at: now };
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ?, metadata_json = ? WHERE task_id = ?")
      .run(now, now, JSON.stringify(current), task.task_id);
    db.prepare(`
      INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json)
      VALUES (?, 'self_improvement_applied', ?, 'task', ?, ?, 'completed', ?, 'Self Improvement Executor', ?, ?)
    `).run(makeId("EVT"), task.task_id, task.task_id, task.status, TOOL, now, JSON.stringify({ commit_sha: commitSha, ...metadata }));
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), task.task_id, JSON.stringify({ task_id: task.task_id, status: "completed", commit_sha: commitSha, source_of_truth: "SQLite" }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function blockApprovedTask(db, task, reason, metadata = {}) {
  const now = nowIso();
  const scheduledFor = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const current = safeJson(task.metadata_json);
  const previousSelfImprovement = current.self_improvement && typeof current.self_improvement === "object"
    ? current.self_improvement
    : {};
  const lastBlocker = {
    reason,
    ...metadata,
    blocked_at: now,
    retry_after: scheduledFor,
    source: TOOL,
  };
  current.self_improvement = {
    ...previousSelfImprovement,
    blocked_count: Number(previousSelfImprovement.blocked_count || 0) + 1,
    last_blocker: lastBlocker,
  };
  if (!Array.isArray(current.notes)) current.notes = [];
  current.notes.push({
    text: `Self-improvement blocked but left approved for worker visibility: ${reason}`,
    added_at: now,
    source: TOOL,
    actionable: true,
  });

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE tasks SET status = 'approved', scheduled_for = ?, updated_at = ?, metadata_json = ? WHERE task_id = ?")
      .run(scheduledFor, now, JSON.stringify(current), task.task_id);
    db.prepare(`
      INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json)
      VALUES (?, 'self_improvement_blocked', ?, 'task', ?, ?, 'approved', ?, 'Self Improvement Executor', ?, ?)
    `).run(makeId("EVT"), task.task_id, task.task_id, task.status, TOOL, now, JSON.stringify(lastBlocker));
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), task.task_id, JSON.stringify({
      task_id: task.task_id,
      status: "approved",
      scheduled_for: scheduledFor,
      reason,
      source_of_truth: "SQLite",
    }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function changedFilesSince(cwd, base) {
  // Detect changes the engineer left in ANY form: committed on the branch
  // (base...HEAD), staged/unstaged working-tree edits (diff HEAD), and new
  // untracked files. The engineer session usually leaves edits UNCOMMITTED, so
  // a base...HEAD-only check falsely reported no changes and the catch block
  // then discarded the work via branch delete.
  const committed = git(cwd, ["diff", "--name-only", `${base}...HEAD`]);
  const workingTree = git(cwd, ["diff", "--name-only", "HEAD"]);
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  return [committed, workingTree, untracked]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function assertGitRepo(cwd) {
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    throw new Error(`${cwd} is not a git repo.`);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "command";
  const checkerArgs = process.platform === "win32" ? [command] : ["-v", command];
  return spawnSync(checker, checkerArgs, { stdio: "ignore", shell: process.platform !== "win32" }).status === 0;
}

function safeJson(value) {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sampleTask() {
  return {
    task_id: "TSK-SELFIMPROVE-SAMPLE",
    title: "Repair authoritative DB path docs",
    status: "approved",
    metadata_json: JSON.stringify(sampleMetadata()),
  };
}

function sampleMetadata() {
  return {
    task_type: "cron_repair",
    evidence: {
      audit: "audit-20260615T050034Z",
      gap: "split_db_ledger",
      recurrence: 2,
      target_files: ["cron/run-outbox.sh", "processes/self-evaluation.md"],
      acceptance: "monitor authoritative_db_path == ok for 2 consecutive checks",
      meta_experiment: "metaexp-20260615T050034Z",
    },
  };
}

if (require.main === module) {
  module.exports();
}
