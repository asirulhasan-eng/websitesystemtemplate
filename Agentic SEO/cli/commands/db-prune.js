#!/usr/bin/env node
/**
 * db-prune.js — Retention pruning for the SEO agent state DB.
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
 *   --db        SQLite database path (or CLIENT_DB_PATH env var)
 *   --json      JSON output (default)
 *   --table     Table output
 *   --sample    Return sample data without DB interaction
 *   --help      Show this help text
 */

const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'db-prune';

const HELP = `
db-prune — Retention pruning for the SEO agent state DB.

USAGE
  v2 db-prune [options]

OPTIONS
  --dry-run    Report what would be pruned without actually deleting
  --db <path>  SQLite database path (or CLIENT_DB_PATH env var)
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
  heartbeats         90 days   (created_at)
  agent_runs         90 days   (created_at)
  crawler_runs       90 days   (started_at)
  analysis_reports   90 days   (created_at)
  outbox_jobs        30 days   (created_at)  — only sent/failed/dead_letter
  monitor_alerts     30 days   (created_at)  — only resolved

EXAMPLES
  v2 db-prune --json
  v2 db-prune --dry-run --table
`.trim();

// Retention rules: [table, days, timestamp_column, optional WHERE filter]
const RETENTION_RULES = [
  ['events',           90, 'created_at',  null],
  ['serp_checks',      90, 'checked_at',  null],
  ['outcome_log',      90, 'created_at',  null],
  ['task_history',     90, 'created_at',  null],
  ['cron_runs',        90, 'started_at',  null],
  ['heartbeats',       90, 'created_at',  null],
  ['agent_runs',       90, 'created_at',  null],
  ['crawler_runs',     90, 'started_at',  null],
  ['analysis_reports', 90, 'created_at',  null],
  ['outbox_jobs',      30, 'created_at',  "status IN ('sent','failed','dead_letter')"],
  ['monitor_alerts',   30, 'created_at',  "status = 'resolved'"],
];

module.exports = function dbPrune() {
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
      let totalDeleted = 0;

      for (const [table, days, tsCol, filter] of RETENTION_RULES) {
        // Check the table actually exists before trying to prune it
        const exists = db.prepare(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table);
        if (!exists || exists.cnt === 0) continue;

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const where = filter
          ? `${tsCol} < ? AND ${filter}`
          : `${tsCol} < ?`;

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
};

if (require.main === module) {
  module.exports();
}
