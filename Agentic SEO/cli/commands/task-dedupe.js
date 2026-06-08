#!/usr/bin/env node
const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { openStateDb, makeId } = require("../lib/state_db");
const { routeTask } = require("../lib/task_routing");

const TOOL = "task-dedupe";
const DEFAULT_STATUSES = ["candidate", "approved", "preview_ready"];

const HELP = `
task-dedupe - Find and optionally cancel duplicate active tasks

USAGE
  v2 task dedupe --db <path> [options]

OPTIONS
  --statuses <list>    Statuses to dedupe. Default: candidate,approved,preview_ready.
  --apply              Cancel duplicates. Default is dry-run.
  --json               JSON output.
  --table              Table output.
  --sample             Return sample data without DB.
  --help               Show help.

BEHAVIOR
  Keeps the highest priority task per v2 routing dedupe key.
  Losers are marked cancelled with superseded_by metadata, an event, and an
  Obsidian task-note outbox update.
`.trim();

module.exports = function taskDedupe() {
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
      mode: "dry-run",
      duplicate_group_count: 1,
      cancel_candidate_count: 1,
      cancelled_count: 0,
      duplicate_groups: [{
        dedupe_key: "gsc|content_refresh|/services/{{NICHE}}-seo|{{NICHE}} seo",
        keep: { task_id: "TSK-KEEP", priority_score: 900 },
        duplicates: [{ task_id: "TSK-DUP", priority_score: 700 }],
      }],
    }, getOutputFormat(args));
    return;
  }

  let db;
  try {
    db = openStateDb(resolveDbPath(args));
    const statuses = String(args.statuses || DEFAULT_STATUSES.join(","))
      .split(",").map((item) => item.trim()).filter(Boolean);
    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE status IN (${statuses.map(() => "?").join(",")})
      ORDER BY priority_score DESC, created_at ASC
    `).all(...statuses);
    const routed = rows.map((task) => ({ task, route: routeTask(task) }));
    const analysis = analyzeDuplicates(routed);
    const apply = boolArg(args, "apply");
    const cancelled = apply ? cancelDuplicates(db, analysis.cancel_candidates) : [];

    printOutput({
      ok: true,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      mode: apply ? "apply" : "dry-run",
      duplicate_group_count: analysis.duplicate_groups.length,
      cancel_candidate_count: analysis.cancel_candidates.length,
      cancelled_count: cancelled.length,
      duplicate_groups: analysis.duplicate_groups,
      cancelled,
    }, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  } finally {
    try { db?.close(); } catch {}
  }
};

function analyzeDuplicates(routed) {
  const byKey = new Map();
  for (const item of routed) {
    const key = item.route.dedupe_key;
    if (!key || !isEligible(item.route)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }

  const duplicateGroups = [];
  const cancelCandidates = [];
  for (const [key, rows] of byKey.entries()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort(sortByPriority);
    const keep = sorted[0];
    const duplicates = sorted.slice(1);
    duplicateGroups.push({
      dedupe_key: key,
      keep: summarize(keep),
      duplicates: duplicates.map((item) => summarize(item, keep, key)),
    });
    cancelCandidates.push(...duplicates.map((item) => ({ ...item, keep, dedupe_key: key })));
  }

  duplicateGroups.sort((a, b) => a.dedupe_key.localeCompare(b.dedupe_key));
  return { duplicate_groups: duplicateGroups, cancel_candidates: cancelCandidates };
}

function cancelDuplicates(db, candidates) {
  const now = new Date().toISOString();
  const cancelled = [];
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const item of candidates) {
      const task = item.task;
      const keep = item.keep.task;
      const current = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(task.task_id);
      if (!current || current.status === "cancelled") continue;
      const metadata = safeJson(current.metadata_json);
      metadata.duplicate_reason = "duplicate_active_task";
      metadata.duplicate_key = item.dedupe_key;
      metadata.superseded_by = keep.task_id;
      metadata.duplicate_cancelled_at = now;

      db.prepare(`
        UPDATE tasks
        SET status = 'cancelled', updated_at = ?, completed_at = ?, metadata_json = ?
        WHERE task_id = ?
      `).run(now, now, JSON.stringify(metadata), task.task_id);

      db.prepare(`
        INSERT INTO events (
          event_id, event_type, task_id, resource_type, resource_id,
          old_value, new_value, source, agent_name, created_at, metadata_json
        ) VALUES (?, 'task_duplicate_superseded', ?, 'task', ?, ?, 'cancelled', 'task-dedupe', 'Task Dedupe', ?, ?)
      `).run(
        makeId("EVT"),
        task.task_id,
        task.task_id,
        current.status,
        now,
        JSON.stringify({ superseded_by: keep.task_id, duplicate_key: item.dedupe_key }),
      );

      db.prepare(`
        INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
        VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
      `).run(
        makeId("OUT"),
        task.task_id,
        JSON.stringify({ task_id: task.task_id, status: "cancelled", superseded_by: keep.task_id }),
        now,
      );

      cancelled.push({ task_id: task.task_id, old_status: current.status, new_status: "cancelled", superseded_by: keep.task_id });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return cancelled;
}

function isEligible(route) {
  const flags = new Set(route.data_quality_flags || []);
  return !flags.has("invalid_metadata_json")
    && !flags.has("no_go_switch_monster");
}

function summarize(item, keep = null, dedupeKey = null) {
  const task = item.task;
  return {
    task_id: task.task_id,
    title: task.title,
    status: task.status,
    priority_score: task.priority_score,
    risk_level: task.risk_level,
    target_url: task.target_url,
    target_keyword: task.target_keyword,
    dedupe_key: dedupeKey || item.route.dedupe_key,
    superseded_by: keep ? keep.task.task_id : undefined,
  };
}

function sortByPriority(a, b) {
  return Number(b.task.priority_score || 0) - Number(a.task.priority_score || 0)
    || statusRank(a.task.status) - statusRank(b.task.status)
    || String(a.task.created_at || "").localeCompare(String(b.task.created_at || ""));
}

function statusRank(status) {
  return { preview_ready: 0, approved: 1, candidate: 2 }[status] ?? 9;
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

if (require.main === module) {
  module.exports();
}
