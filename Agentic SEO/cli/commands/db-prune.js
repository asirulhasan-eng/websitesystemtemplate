#!/usr/bin/env node
/**
 * db-prune.js â€” Retention pruning for the SEO agent state DB.
 *
 * Deletes rows older than the configured retention window from high-volume
 * tables to keep the SQLite DB lean and prevent unbounded growth.
 *
 * Usage:
 *   v2 db-prune --json
 *   v2 db-prune --dry-run --json
 *   v2 db-prune --db /path/to/state.db --json
 *
 * Options:
 *   --dry-run   Report what would be pruned without deleting
 *   --db        SQLite database path (or WEBSITE_AGENT_DB_PATH env var)
 *   --json      JSON output (default)
 *   --table     Table output
 *   --sample    Return sample data without DB interaction
 *   --help      Show this help text
 */

const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');
const { OUTBOX_TERMINAL, sqlList } = require('../lib/outbox_states');

const TOOL = 'db-prune';

const HELP = `
db-prune â€” Retention pruning for the SEO agent state DB.

USAGE
  v2 db-prune [options]

OPTIONS
  --dry-run    Report what would be pruned without actually deleting
  --db <path>  SQLite database path (or WEBSITE_AGENT_DB_PATH env var)
  --json       JSON output (default)
  --table      Table output
  --sample     Return sample data without DB interaction
  --help       Show this help text

RETENTION RULES
  events             90 days   (created_at)
  serp_checks        90 days   (checked_at)
  outcome_log        90 days   (created_at)
  task_history       90 days   (created_at)
  cron_runs          90 days   (started_at)
  heartbeats         90 days   (heartbeat_at)
  agent_runs         90 days   (started_at)
  crawler_runs       90 days   (started_at)
  analysis_reports   90 days   (created_at)
  outbox_jobs        30 days   (created_at)  - only completed/sent/failed/dead_letter
  monitor_alerts     30 days   (resolved_at) â€” only resolved

EXAMPLES
  v2 db-prune --json
  v2 db-prune --dry-run --table
`.trim();

const OUTBOX_TERMINAL_FILTER = `status IN (${sqlList(OUTBOX_TERMINAL)})`;

// Retention rules: [table, days, timestamp_column(s), optional WHERE filter]
// Some tables predate the pruning command and do not share a generic created_at
// column. Keep the timestamp column explicit per table and skip rules whose
// table/column is absent so db-prune stays compatible with live and legacy DBs.
const RETENTION_RULES = [
  ['events',           90, 'created_at',  null],
  ['serp_checks',      90, 'checked_at',  null],
  ['outcome_log',      90, 'created_at',  null],
  ['task_history',     90, 'created_at',  null],
  ['cron_runs',        90, 'started_at',  null],
  ['heartbeats',       90, 'heartbeat_at', null],
  ['agent_runs',       90, 'started_at',  null],
  ['crawler_runs',     90, 'started_at',  null],
  ['analysis_reports', 90, 'created_at',  null],
  ['outbox_jobs',      30, 'created_at',  OUTBOX_TERMINAL_FILTER],
  ['monitor_alerts',   30, ['resolved_at', 'triggered_at'], "status = 'resolved'"],
];

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function resolveTimestampColumn(columns, tsCols) {
  const candidates = Array.isArray(tsCols) ? tsCols : [tsCols];
  return candidates.find((column) => columns.has(column)) || null;
}

function dbPrune() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      pruned: [
        { table: 'events', deleted: 142 },
        { table: 'serp_checks', deleted: 87 },
        { table: 'outbox_jobs', deleted: 23 },
      ],
      total_deleted: 252,
      wal_checkpoint: true,
      pruned_at: nowIso(),
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const dryRun = boolArg(args, 'dry-run');

    try {
      const now = nowIso();
      const pruned = [];
      const skipped = [];
      let totalDeleted = 0;

      for (const [table, days, tsCols, filter] of RETENTION_RULES) {
        // Check the table actually exists before trying to prune it
        const exists = db.prepare(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table);
        if (!exists || exists.cnt === 0) continue;

        const columns = tableColumns(db, table);
        const tsCol = resolveTimestampColumn(columns, tsCols);
        if (!tsCol) {
          skipped.push({ table, reason: 'missing_timestamp_column', expected: Array.isArray(tsCols) ? tsCols : [tsCols] });
          continue;
        }

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const where = filter
          ? `${tsCol} IS NOT NULL AND ${tsCol} < ? AND ${filter}`
          : `${tsCol} IS NOT NULL AND ${tsCol} < ?`;

        if (dryRun) {
          const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}`).get(cutoff);
          const count = row ? row.cnt : 0;
          if (count > 0) {
            pruned.push({ table, would_delete: count, cutoff, days });
            totalDeleted += count;
          }
        } else {
          const info = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(cutoff);
          if (info.changes > 0) {
            pruned.push({ table, deleted: info.changes, cutoff, days });
            totalDeleted += info.changes;
          }
        }
      }

      // WAL checkpoint after pruning to reclaim disk space
      let walCheckpoint = false;
      if (!dryRun && totalDeleted > 0) {
        try {
          db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
          walCheckpoint = true;
        } catch { /* WAL may not be enabled */ }
      }

      const result = {
        dry_run: dryRun,
        pruned,
        skipped,
        total_deleted: totalDeleted,
        wal_checkpoint: walCheckpoint,
        pruned_at: now,
      };

      printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

module.exports = Object.assign(dbPrune, {
  RETENTION_RULES,
  OUTBOX_TERMINAL_FILTER,
});

if (require.main === module) {
  module.exports();
}
