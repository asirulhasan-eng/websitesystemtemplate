#!/usr/bin/env node
/**
 * task-next.js â€” Pipeline picker (dual-pipeline consumer support)
 *
 * Returns the single highest-priority READY task in a given execution lane so a
 * stateless worker (run-ops-pipeline.sh / run-blog-pipeline.sh) can execute it
 * on each tick. Lane membership can't be computed in SQL â€” it requires
 * routeTask() â€” so we load the ready pool and route in JS.
 *
 * Ready-state contract (see processes/dual-pipeline-plan.md):
 *   - Only status='approved' is READY. Workers WILL execute it automatically;
 *     there is no second gate. `candidate` and `waiting_for_approval` are skipped.
 *   - The producer (twice-daily work plan) is the sole thing that sets 'approved'.
 *
 * Usage:
 *   v2 task next --lane general_operational --json
 *   v2 task next --lane blog_content --json
 *
 * Options:
 *   --lane <name>   Required. general_operational | blog_content
 *   --limit <N>     Number of ready tasks to return in `candidates` (default 1).
 *   --db <path>     SQLite database path (or CLIENT_DB_PATH env var).
 *   --json/--table  Output format.
 *   --sample        Return sample data without touching the DB.
 *   --help          Show help.
 */

const { parseArgs, requireArg, numberArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { routeTask } = require("../lib/task_routing");
const { nowIso } = require("../lib/dates");

const TOOL = "task-next";
const VALID_LANES = new Set(["general_operational", "blog_content"]);
const READY_STATUS = "approved";

// Risk level â†’ the execution-lane CLI a worker should dispatch to.
const DISPATCH_BY_RISK = {
  safe: "safe-fix",
  semi_safe: "semi-safe",
  high_risk: "high-risk",
};

const HELP = `
task-next â€” Pick the next READY task in an execution lane (dual-pipeline worker)

USAGE
  v2 task next --lane <general_operational|blog_content> [options]

OPTIONS
  --lane <name>   Required. Execution lane to pull from.
  --limit <N>     Ready tasks to include in candidates[] (default 1).
  --db <path>     SQLite database path (or CLIENT_DB_PATH env var).
  --json          JSON output (default).
  --table         Table output.
  --sample        Return sample data without DB interaction.
  --help          Show this help text.

BEHAVIOR
  Loads status='approved' tasks, routes each via routeTask(), and returns the
  highest-priority executable task whose execution_lane matches --lane. Tasks
  that are locked, no-go, malformed, or awaiting approval are excluded. Output
  field 'task' is null when the lane has no ready work.
`.trim();

module.exports = function taskNext() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      lane: "general_operational",
      ready_count: 1,
      task: {
        task_id: "TSK-SAMPLE",
        title: "Sample ready task",
        status: READY_STATUS,
        risk_level: "safe",
        priority_score: 900,
        execution_lane: "general_operational",
        workflow_bucket: "general_candidate_triage",
        dispatch: "safe-fix",
      },
      candidates: [],
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const lane = requireArg(args, "lane", "Missing --lane (general_operational | blog_content)");
    if (!VALID_LANES.has(lane)) {
      throw new Error(`Unknown lane '${lane}'. Use one of: ${[...VALID_LANES].join(", ")}.`);
    }
    const limit = Math.max(1, numberArg(args, "limit", 1));

    const db = openStateDb(resolveDbPath(args));
    try {
      const now = nowIso();
      // A deferred follow-up is created status='approved' with a future
      // scheduled_for; it must stay invisible to the consumer until due. ISO-8601
      // UTC timestamps sort lexicographically, so the string compare is correct.
      const rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status = ?
          AND (scheduled_for IS NULL OR scheduled_for <= ?)
        ORDER BY priority_score DESC, created_at ASC
      `).all(READY_STATUS, now);
      const locks = db.prepare("SELECT * FROM locks WHERE status = 'active'").all();
      // Defense in depth: an irreversible task (approval_required=1) is only
      // runnable with a real approved approval row â€” not just status='approved'.
      // If the producer ever mis-approves one, routeTask flags it and we skip it.
      const approvedTaskIds = new Set(
        db.prepare("SELECT DISTINCT task_id FROM approvals WHERE status = 'approved'").all().map((r) => r.task_id),
      );

      const ready = rows
        .map((task) => ({
          task,
          route: routeTask(task, {
            active_locks: locks,
            now,
            has_approved_approval: approvedTaskIds.has(task.task_id),
          }),
        }))
        .filter(({ route }) => route.execution_lane === lane && isExecutable(route))
        .map(({ task, route }) => summarize(task, route));

      const output = {
        lane,
        ready_count: ready.length,
        task: ready[0] || null,
        candidates: ready.slice(0, limit),
      };
      printOutput(envelope(output, { tool: TOOL }), getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

// Mirrors task-audit.js isExecutable: a task is worker-runnable only when it has
// no blocking data-quality flags and is not parked in a review/approval bucket.
function isExecutable(route) {
  const flags = new Set(route.data_quality_flags || []);
  return !flags.has("active_task_lock")
    && !flags.has("invalid_metadata_json")
    && !flags.has("no_go_switch_monster")
    && !["approval_needed", "needs_lane_review", "blocked_no_go"].includes(route.workflow_bucket);
}

function summarize(task, route) {
  return {
    task_id: task.task_id,
    title: task.title,
    status: task.status,
    risk_level: task.risk_level,
    priority_score: task.priority_score,
    source: task.source,
    target_url: task.target_url,
    target_file: task.target_file,
    target_keyword: task.target_keyword,
    execution_lane: route.execution_lane,
    workflow_bucket: route.workflow_bucket,
    canonical_task_type: route.canonical_task_type,
    dispatch: DISPATCH_BY_RISK[task.risk_level] || null,
    data_quality_flags: route.data_quality_flags || [],
  };
}

if (require.main === module) {
  module.exports();
}
