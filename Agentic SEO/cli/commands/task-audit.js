#!/usr/bin/env node
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { routeTask } = require("../lib/task_routing");

const TOOL = "task-audit";
const ACTIVE_STATUSES = ["candidate", "approved", "waiting_for_approval", "preview_ready", "preview_pushed", "monitored", "needs_review"];

const HELP = `
task-audit - Audit task lanes, workflow buckets, duplicates, and runnable queues

USAGE
  v2 task audit --db <path> [options]

OPTIONS
  --queue <name>        general, blog-draft, blog-editor, blog-review.
  --preselect-only     Return only executable/preselected rows for the queue.
  --limit <N>          Max preselected rows. Default: 10.
  --statuses <list>    Statuses to audit. Default active statuses.
  --sample             Return sample data without DB.
  --json               JSON output.
  --table              Table output.
  --help               Show help.
`.trim();

module.exports = function taskAudit() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput({
      ok: true,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      summary: { active_total: 2, no_go_task_count: 0, duplicate_group_count: 1 },
      preselected: [{ task_id: "TSK-SAMPLE", title: "Sample task", priority_score: 900 }],
    }, getOutputFormat(args));
    return;
  }

  try {
    const db = openStateDb(resolveDbPath(args));
    try {
      const statuses = String(args.statuses || ACTIVE_STATUSES.join(","))
        .split(",").map((item) => item.trim()).filter(Boolean);
      const rows = db.prepare(`
        SELECT * FROM tasks
        WHERE status IN (${statuses.map(() => "?").join(",")})
        ORDER BY priority_score DESC, created_at ASC
      `).all(...statuses);
      const locks = db.prepare("SELECT * FROM locks WHERE status = 'active'").all();
      const routed = rows.map((task) => ({
        task,
        route: routeTask(task, { active_locks: locks, now: new Date().toISOString() }),
      }));

      const audit = buildAudit(routed);
      const queue = args.queue || "general";
      const preselected = preselect(audit, queue)
        .slice(0, numberArg(args, "limit", 10))
        .map(summarizeTask);

      const output = {
        ok: true,
        generated_at: new Date().toISOString(),
        tool: TOOL,
        queue,
        summary: audit.summary,
        preselected,
        queues: boolArg(args, "preselect-only") ? undefined : audit.queues,
        duplicate_groups: boolArg(args, "preselect-only") ? undefined : audit.duplicate_groups,
        no_go: boolArg(args, "preselect-only") ? undefined : audit.no_go.map(summarizeTask),
      };
      printOutput(output, getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function buildAudit(routed) {
  const activeByLane = countBy(routed, ({ route }) => route.execution_lane || "unknown");
  const activeByBucket = countBy(routed, ({ route }) => route.workflow_bucket || "unknown");
  const noGo = routed.filter(({ route }) => Array.isArray(route.data_quality_flags) && route.data_quality_flags.includes("no_go_switch_monster"));
  const duplicateGroups = duplicateGroupsFor(routed.filter(({ route }) => route.execution_lane === "general_operational"));

  const queues = {
    general: routed.filter(({ route }) => route.execution_lane === "general_operational" && isExecutable(route)),
    blog_draft: routed.filter(({ route }) => route.workflow_bucket === "draft_needed" && isExecutable(route)),
    blog_editor: routed.filter(({ route }) => route.workflow_bucket === "edit_refresh_needed" && isExecutable(route)),
    blog_review: routed.filter(({ route, task }) => route.execution_lane === "blog_content" && ["preview_ready", "preview_pushed"].includes(task.status)),
    needs_lane_review: routed.filter(({ route }) => route.workflow_bucket === "needs_lane_review"),
    approval_needed: routed.filter(({ route }) => route.workflow_bucket === "approval_needed"),
  };

  return {
    summary: {
      active_total: routed.length,
      active_by_lane: activeByLane,
      active_by_bucket: activeByBucket,
      no_go_task_count: noGo.length,
      duplicate_group_count: duplicateGroups.length,
      duplicate_task_count: duplicateGroups.reduce((sum, group) => sum + group.tasks.length, 0),
      queue_counts: Object.fromEntries(Object.entries(queues).map(([key, rows]) => [key, rows.length])),
    },
    queues: Object.fromEntries(Object.entries(queues).map(([key, rows]) => [key, rows.map(summarizeTask)])),
    duplicate_groups: duplicateGroups.map((group) => ({
      dedupe_key: group.dedupe_key,
      keep: summarizeTask(group.keep),
      tasks: group.tasks.map(summarizeTask),
    })),
    no_go: noGo,
  };
}

function preselect(audit, queue) {
  if (queue === "general") return audit.queues.general.map(fromSummary);
  if (queue === "blog-draft" || queue === "blog") return audit.queues.blog_draft.map(fromSummary);
  if (queue === "blog-editor") return audit.queues.blog_editor.map(fromSummary);
  if (queue === "blog-review") return audit.queues.blog_review.map(fromSummary);
  throw new Error(`Unknown queue: ${queue}`);
}

function duplicateGroupsFor(routed) {
  const byKey = new Map();
  for (const row of routed) {
    if (!row.route.dedupe_key || !isExecutable(row.route)) continue;
    if (!byKey.has(row.route.dedupe_key)) byKey.set(row.route.dedupe_key, []);
    byKey.get(row.route.dedupe_key).push(row);
  }
  return [...byKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([dedupeKey, rows]) => {
      const sorted = [...rows].sort(sortByPriority);
      return { dedupe_key: dedupeKey, keep: sorted[0], tasks: sorted };
    });
}

function isExecutable(route) {
  const flags = new Set(route.data_quality_flags || []);
  return !flags.has("active_task_lock")
    && !flags.has("invalid_metadata_json")
    && !flags.has("no_go_switch_monster")
    && !["approval_needed", "needs_lane_review", "blocked_no_go"].includes(route.workflow_bucket);
}

function summarizeTask(row) {
  const task = row.task || row;
  const route = row.route || {};
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
    dedupe_key: route.dedupe_key,
    data_quality_flags: route.data_quality_flags || [],
  };
}

function fromSummary(summary) {
  return { task: summary, route: summary };
}

function sortByPriority(a, b) {
  const at = a.task || a;
  const bt = b.task || b;
  return Number(bt.priority_score || 0) - Number(at.priority_score || 0)
    || String(at.created_at || "").localeCompare(String(bt.created_at || ""));
}

function countBy(rows, fn) {
  const out = {};
  for (const row of rows) {
    const key = fn(row);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

if (require.main === module) {
  module.exports();
}
