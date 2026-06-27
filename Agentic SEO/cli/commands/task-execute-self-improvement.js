#!/usr/bin/env node
/**
 * task-execute-self-improvement.js - Execute approved agent-substrate repair tasks.
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

const TOOL = "task-execute-self-improvement";
const CANONICAL_DB_PATH = "/opt/website-state/website-agent.db";
const DEFAULT_AGENT_ROOT = path.resolve(__dirname, "..", "..");
const MAX_FILES_PER_CHANGE = 8;
const RUNTIME_ARTIFACT_PREFIXES = [
  "tools/out/email/",
  "tools/out/obsidian-sync/",
];

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
task execute-self-improvement - Execute approved self_improvement repair tasks

USAGE
  v2 task execute-self-improvement --task <id> --dry-run [options]
  v2 task execute-self-improvement --task <id> --apply [options]
  v2 task execute-self-improvement --sample --json

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
      const splitPlan = planTargetFileSplit(targetFiles);

      if (dryRun) {
        printOutput(envelope({
          mode: "dry-run",
          task_id: task.task_id,
          route,
          target_files: targetFiles,
          forbidden_matches: scope.forbidden,
          allowed: scope.allowed && !splitPlan.required,
          split_required: splitPlan.required,
          split_plan: splitPlan.required ? splitPlan.summary : null,
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

      if (splitPlan.required) {
        const split = splitOversizedTask(db, task, metadata, targetFiles, splitPlan);
        printOutput(envelope({
          mode: "apply",
          status: "parked",
          task_id: task.task_id,
          reason: "repair_split_required",
          split_task_ids: split.task_ids,
          human_action: split.human_action,
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
  let runtimeArtifacts = [];

  try {
    assertGitIndexReadyForStash(agentRoot);

    if (git(agentRoot, ["status", "--porcelain"])) {
      git(agentRoot, ["stash", "push", "-u", "-m", `self-improve-preserve-${task.task_id}`]);
      stashed = true;
    }

    checkoutBaseBranch(agentRoot, branch);
    runEngineerSession(agentRoot, prompt);

    runtimeArtifacts = cleanRuntimeArtifacts(agentRoot);
    const changedFiles = changedFilesSince(agentRoot, "main");
    const changedScope = evaluateChangedScope(changedFiles, targetFiles);
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
          non_production_side_effects: runtimeArtifacts,
          gate: [],
          skill_sync: { required: false, ran: false },
          stashed_unrelated_changes: Boolean(stashRestore),
          metadata_gap: metadata.evidence?.gap || null,
          note: "Task was completed by the Engineer session via CLI-only reconciliation; no git changes were required.",
        };
      }
      throw new Error(noOpDiagnostic(task, targetFiles));
    }
    const productionChangedCount = changedFiles.filter(isProductionFile).length;
    if (productionChangedCount > MAX_FILES_PER_CHANGE) {
      throw new Error(`Self-improvement changed ${productionChangedCount} non-test files; max is ${MAX_FILES_PER_CHANGE}. Split this repair into smaller approved self_improvement tasks with <=${MAX_FILES_PER_CHANGE} production target_files each before retrying.`);
    }
    if (!changedScope.allowed) {
      throw new Error(`Engineer session changed files outside declared target_files/test support: ${changedScope.forbidden.join(", ")}. Declare every production file in evidence.target_files, keep test-only support under test/, or split the task before retrying.`);
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
    completeTask(db, task, commitSha, {
      changed_files: changedFiles,
      gate,
      skill_sync: skillSync,
      non_production_side_effects: runtimeArtifacts,
    });
    const stashRestore = stashed ? safeGit(agentRoot, ["stash", "pop"]) : "";
    if (stashed) stashed = false;

    return {
      mode: "apply",
      status: "completed",
      task_id: task.task_id,
      branch,
      commit_sha: commitSha,
      changed_files: changedFiles,
      non_production_side_effects: runtimeArtifacts,
      gate,
      skill_sync: skillSync,
      stashed_unrelated_changes: Boolean(stashRestore),
      metadata_gap: metadata.evidence?.gap || null,
    };
  } catch (error) {
    safeGit(agentRoot, ["checkout", originalBranch]);
    safeGit(agentRoot, ["branch", "-D", branch]);
    if (stashed) safeGit(agentRoot, ["stash", "pop"]);
    const sideEffectMetadata = runtimeArtifacts.length
      ? { non_production_side_effects: runtimeArtifacts }
      : {};
    blockApprovedTask(db, task, error.message, {
      target_files: targetFiles,
      branch,
      ...sideEffectMetadata,
      ...(error.blockerMetadata || {}),
    });
    return {
      mode: "apply",
      status: "blocked",
      task_id: task.task_id,
      reason: error.message,
      branch,
      stashed_unrelated_changes: stashed,
      ...sideEffectMetadata,
      ...(error.blockerMetadata || {}),
    };
  } finally {
    releaseGitLock(db, lock);
    if (stashed) safeGit(agentRoot, ["stash", "pop"]);
  }
}

function assertGitIndexReadyForStash(agentRoot) {
  const preflight = inspectGitIndexForStash(agentRoot);
  if (preflight.ok) return;

  const reason = preflight.status === "unmerged"
    ? `self_improvement_git_index_preflight_failed: git index has unmerged entries (${preflight.unmerged_paths.join(", ")}). Resolve or abort the merge/rebase before the self-improvement worker can safely preserve unrelated changes.`
    : `self_improvement_git_index_preflight_failed: git index is not writable/refreshable (${preflight.refresh_error || "unknown git index error"}). Repair index permissions or remove stale index.lock before retrying.`;
  const error = new Error(reason);
  error.blockerMetadata = { git_index_preflight: preflight };
  throw error;
}

function inspectGitIndexForStash(agentRoot) {
  const unmerged = git(agentRoot, ["ls-files", "-u"]);
  const unmergedPaths = unique(unmerged
    .split(/\r?\n/)
    .map(parseUnmergedPath)
    .filter(Boolean));
  if (unmergedPaths.length) {
    return {
      ok: false,
      status: "unmerged",
      unmerged_paths: normalizeTargetFiles(unmergedPaths, agentRoot),
    };
  }

  const refresh = spawnSync("git", ["update-index", "-q", "--refresh"], {
    cwd: agentRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (refresh.status !== 0) {
    return {
      ok: false,
      status: "unwritable",
      refresh_error: summarizeGitFailure(refresh),
    };
  }

  return { ok: true, status: "clean" };
}

function parseUnmergedPath(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const tabParts = trimmed.split("\t");
  if (tabParts.length > 1) return tabParts.slice(1).join("\t").trim();
  return trimmed.split(/\s+/).slice(3).join(" ").trim();
}

function summarizeGitFailure(result) {
  return String(result.stderr || result.stdout || `git update-index exited ${result.status}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function unique(values) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
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

function cleanRuntimeArtifacts(agentRoot) {
  const cleaned = [];
  for (const file of runtimeArtifactCandidates(agentRoot)) {
    if (!isRuntimeArtifactFile(file)) continue;
    const absolute = path.resolve(agentRoot, file);
    const root = path.resolve(agentRoot);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    try {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile()) continue;
      fs.unlinkSync(absolute);
      cleaned.push({
        file,
        action: "deleted_untracked_runtime_artifact",
        classification: "non_production_side_effect",
      });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return cleaned;
}

function runtimeArtifactCandidates(agentRoot) {
  return normalizeTargetFiles(
    git(agentRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...RUNTIME_ARTIFACT_PREFIXES.map((prefix) => prefix.replace(/\/$/, "")),
    ])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    agentRoot,
  );
}

function isRuntimeArtifactFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  return normalized.endsWith(".json")
    && RUNTIME_ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
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
    "2. Declare target_files before work. Production/source edits MUST stay inside the exact Target files list; test-only support may be edited under test/.",
    "3. Do not touch secrets, safety-cage keys, no-go config, Website/, DNS/domain/SSL/robots/sitemap, or delete executors.",
    "4. If the repair needs more than 8 non-test files, stop and split it into smaller tasks before editing.",
    "5. Add/update tests for logic changes under test/ only when needed.",
    "6. Run node --check/bash -n/npm test as applicable.",
    "7. Leave one revertable commit-worth of changes and summarize the acceptance criterion.",
  ].join("\n");
}

function normalizeTargetFiles(value, agentRoot = DEFAULT_AGENT_ROOT) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  const roots = candidateAgentRoots(agentRoot);
  return values
    .map((item) => normalizeRepoPath(item, roots, agentRoot))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function candidateAgentRoots(agentRoot = DEFAULT_AGENT_ROOT) {
  const roots = [
    agentRoot,
    process.env.WEBSITE_AGENT_ROOT,
    "/opt/website-agent",
  ];
  for (const root of [...roots]) {
    try {
      if (root) roots.push(fs.realpathSync(root));
    } catch {
      // Ignore non-existent roots in temp test fixtures.
    }
  }
  return roots
    .filter(Boolean)
    .map((root) => path.resolve(String(root).replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/$/, ""))
    .filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeRepoPath(item, roots, agentRoot = DEFAULT_AGENT_ROOT) {
  let file = String(item || "").replace(/\\/g, "/").trim();
  file = file.replace(/^file:\/\//i, "").replace(/^['\"]|['\"]$/g, "");
  if (!file) return "";

  for (const root of roots) {
    if (file === root) return "";
    if (file.startsWith(`${root}/`)) {
      file = file.slice(root.length + 1);
      break;
    }
  }

  // Git commands run from /opt/website-agent, but the physical git
  // root is /opt/website-system and paths are emitted as
  // "Agentic SEO/<file>". Treat that prefix as the agent root, not as an
  // out-of-scope top-level directory.
  const basename = path.basename(path.resolve(agentRoot)).replace(/\\/g, "/");
  const stripPrefixes = [basename, "Agentic SEO", "website-agent"]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  for (const prefix of stripPrefixes) {
    if (file === prefix) return "";
    if (file.startsWith(`${prefix}/`)) {
      file = file.slice(prefix.length + 1);
      break;
    }
  }

  file = file.replace(/^\.?\//, "");
  while (file.startsWith("../")) file = file.slice(3);
  return file;
}

function evaluateScope(files) {
  const forbidden = [];
  if (!files.length) {
    forbidden.push("<missing target_files>");
  }
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

function evaluateChangedScope(changedFiles, targetFiles) {
  const targetSet = new Set(normalizeTargetFiles(targetFiles));
  const baseScope = evaluateScope(changedFiles.filter(isProductionFile));
  const forbidden = [...baseScope.forbidden];
  for (const file of changedFiles) {
    if (isTestSupportFile(file)) continue;
    if (!targetSet.has(file) && !forbidden.includes(file)) {
      forbidden.push(file);
    }
  }
  return { allowed: forbidden.length === 0, forbidden };
}

function isTestSupportFile(file) {
  return String(file || "").startsWith("test/");
}

function isProductionFile(file) {
  return !isTestSupportFile(file);
}

function planTargetFileSplit(targetFiles) {
  const productionTargets = targetFiles.filter(isProductionFile);
  if (productionTargets.length <= MAX_FILES_PER_CHANGE) {
    return { required: false, chunks: [], summary: null };
  }
  const chunks = [];
  for (let i = 0; i < productionTargets.length; i += MAX_FILES_PER_CHANGE) {
    chunks.push(productionTargets.slice(i, i + MAX_FILES_PER_CHANGE));
  }
  return {
    required: true,
    chunks,
    summary: {
      non_test_target_files: productionTargets.length,
      max_non_test_files: MAX_FILES_PER_CHANGE,
      chunks: chunks.map((chunk, index) => ({ part: index + 1, target_files: chunk })),
    },
  };
}

function noOpDiagnostic(task, targetFiles) {
  return `Engineer session completed without changing files or marking ${task.task_id} completed. Human action: inspect the Engineer transcript, verify the declared target_files (${targetFiles.join(", ") || "none"}), then either add a concrete file-level repair, mark the task obsolete, or narrow/recreate the task with actionable acceptance before retrying.`;
}

function splitOversizedTask(db, task, metadata, targetFiles, splitPlan) {
  const now = nowIso();
  const current = safeJson(task.metadata_json);
  const splitTaskIds = [];
  const evidence = current.evidence && typeof current.evidence === "object" ? current.evidence : {};
  const titleBase = task.title || `Self-improvement repair ${task.task_id}`;
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    splitPlan.chunks.forEach((chunk, index) => {
      const childId = makeId("TSK");
      splitTaskIds.push(childId);
      const childMetadata = {
        ...current,
        task_type: current.task_type || metadata.task_type || "self_improvement",
        parent_task_id: task.task_id,
        split_from: task.task_id,
        split_part: index + 1,
        split_total: splitPlan.chunks.length,
        evidence: {
          ...evidence,
          target_files: chunk,
          split_from: task.task_id,
          split_part: index + 1,
          split_total: splitPlan.chunks.length,
          acceptance: evidence.acceptance || "Apply this bounded split of the parent self-improvement repair.",
        },
      };
      db.prepare(`
        INSERT INTO tasks (task_id, title, description, status, risk_level, priority_score, source,
          target_file, approval_required, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        childId,
        `${titleBase} (split ${index + 1}/${splitPlan.chunks.length})`,
        `Auto-split from ${task.task_id} because the parent declared ${targetFiles.filter(isProductionFile).length} non-test target files; this child is capped at ${MAX_FILES_PER_CHANGE}.`,
        task.risk_level || "safe",
        task.priority_score || 900,
        task.source || "auditor",
        chunk[0] || null,
        now,
        now,
        JSON.stringify(childMetadata),
      );
      db.prepare(`
        INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json)
        VALUES (?, 'self_improvement_split_child_created', ?, 'task', ?, 'approved', 'approved', ?, 'Self Improvement Executor', ?, ?)
      `).run(makeId("EVT"), childId, childId, TOOL, now, JSON.stringify({ parent_task_id: task.task_id, target_files: chunk }));
    });

    current.self_improvement = {
      ...(current.self_improvement || {}),
      split_at: now,
      split_task_ids: splitTaskIds,
      last_blocker: {
        reason: "repair_split_required",
        target_files: targetFiles,
        split_task_ids: splitTaskIds,
        blocked_at: now,
        source: TOOL,
      },
    };
    if (!Array.isArray(current.notes)) current.notes = [];
    current.notes.push({
      text: `Self-improvement split into ${splitTaskIds.length} child tasks because parent declared ${targetFiles.filter(isProductionFile).length} non-test files (max ${MAX_FILES_PER_CHANGE}).`,
      added_at: now,
      source: TOOL,
      actionable: true,
    });
    db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ?, metadata_json = ? WHERE task_id = ?")
      .run(now, JSON.stringify(current), task.task_id);
    db.prepare(`
      INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json)
      VALUES (?, 'self_improvement_split_parent_cancelled', ?, 'task', ?, ?, 'cancelled', ?, 'Self Improvement Executor', ?, ?)
    `).run(makeId("EVT"), task.task_id, task.task_id, task.status, TOOL, now, JSON.stringify({ split_task_ids: splitTaskIds, target_files: targetFiles }));
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), task.task_id, JSON.stringify({ task_id: task.task_id, status: "cancelled", split_task_ids: splitTaskIds, source_of_truth: "SQLite" }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    task_ids: splitTaskIds,
    human_action: `Parent ${task.task_id} was cancelled and split into ${splitTaskIds.length} approved child tasks capped at ${MAX_FILES_PER_CHANGE} non-test target_files each; monitor those children instead of retrying the parent.`,
  };
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
  const current = safeJson(task.metadata_json);
  const previousSelfImprovement = current.self_improvement && typeof current.self_improvement === "object"
    ? current.self_improvement
    : {};
  const humanAction = actionableHumanAction(reason, metadata);
  const lastBlocker = {
    reason,
    ...metadata,
    human_action: humanAction,
    blocked_at: now,
    terminal: true,
    terminal_reason: "parked_blocked_after_self_improvement_scope_or_execution_blocker",
    source: TOOL,
  };
  current.self_improvement = {
    ...previousSelfImprovement,
    blocked_count: Number(previousSelfImprovement.blocked_count || 0) + 1,
    last_blocker: lastBlocker,
  };
  if (!Array.isArray(current.notes)) current.notes = [];
  current.notes.push({
    text: `Self-improvement parked as blocked: ${reason} Human action: ${humanAction}`,
    added_at: now,
    source: TOOL,
    actionable: true,
    terminal: true,
  });

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE tasks SET status = 'blocked', scheduled_for = NULL, updated_at = ?, metadata_json = ? WHERE task_id = ?")
      .run(now, JSON.stringify(current), task.task_id);
    db.prepare(`
      INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json)
      VALUES (?, 'self_improvement_blocked', ?, 'task', ?, ?, 'blocked', ?, 'Self Improvement Executor', ?, ?)
    `).run(makeId("EVT"), task.task_id, task.task_id, task.status, TOOL, now, JSON.stringify(lastBlocker));
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), task.task_id, JSON.stringify({
      task_id: task.task_id,
      status: "blocked",
      reason,
      human_action: humanAction,
      source_of_truth: "SQLite",
    }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function actionableHumanAction(reason, metadata = {}) {
  if (/self_improvement_git_index_preflight_failed|git index|unmerged|could not write index/i.test(reason)) {
    const preflight = metadata.git_index_preflight || {};
    if (preflight.status === "unmerged") {
      return `Resolve or abort the current merge/rebase and clear unmerged git index entries (${(preflight.unmerged_paths || []).join(", ") || "unknown paths"}); then rerun self-improvement. Do not retry blind while the index is conflicted.`;
    }
    return `Repair git index writability before retrying: remove stale .git/index.lock if present, fix repository/index permissions, and confirm 'git update-index -q --refresh' succeeds.`;
  }
  if (/without changing files|without changing any files/i.test(reason)) {
    return `Inspect the Engineer transcript and declared target_files (${(metadata.target_files || []).join(", ") || "none"}); add a concrete file-level repair, mark obsolete, or recreate with actionable acceptance.`;
  }
  if (/outside declared target_files|forbidden files/i.test(reason)) {
    return `Normalize repo-relative paths, ensure every production edit is listed in evidence.target_files, keep tests under test/, and retry only after narrowing scope.`;
  }
  if (/changed \d+ non-test files|max is/i.test(reason)) {
    return `Split the repair into approved child self_improvement tasks with at most ${MAX_FILES_PER_CHANGE} non-test target_files each.`;
  }
  if (/Forbidden or out-of-scope self-improvement target|forbidden_target/i.test(reason)) {
    return `Replace target_files with repo-relative paths under ${ALLOWED_PREFIXES.join(", ")} and avoid forbidden guardrails/no-go/secrets/Website/DNS/domain/SSL/robots/sitemap targets.`;
  }
  return `Inspect the blocker, narrow target_files, and retry only after the acceptance criteria are actionable.`;
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
  return normalizeTargetFiles(
    [committed, workingTree, untracked]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    cwd,
  );
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

