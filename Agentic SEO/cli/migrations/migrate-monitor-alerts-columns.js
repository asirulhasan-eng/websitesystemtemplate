/**
 * migrate-monitor-alerts-columns.js — Add dedup / resolution columns to monitor_alerts
 *
 * Adds:
 *   last_seen_at      TEXT     — timestamp of the most recent occurrence
 *   occurrence_count   INTEGER DEFAULT 1 — how many times this alert has fired
 *   resolved_at       TEXT     — when the alert was auto/manually resolved
 *   resolution_note   TEXT     — human-readable resolution reason
 *
 * These columns support the alert-dedup logic in monitor-check.js (Bug #5 fix).
 * Safe to run repeatedly: each ALTER is guarded by a column-existence check.
 *
 * Usage:
 *   node cli/migrations/migrate-monitor-alerts-columns.js [--db <path>]
 */

const path = require('node:path');
const { parseArgs, resolveDbPath } = require('../lib/cli');
const { openStateDb } = require('../lib/state_db');

function run() {
  const args = parseArgs();
  const dbPath = resolveDbPath(args);
  const db = openStateDb(dbPath);

  try {
    const columns = new Set(
      db.prepare("PRAGMA table_info(monitor_alerts)").all().map(c => c.name)
    );

    const additions = [
      { name: 'last_seen_at',     sql: 'ALTER TABLE monitor_alerts ADD COLUMN last_seen_at TEXT' },
      { name: 'occurrence_count', sql: 'ALTER TABLE monitor_alerts ADD COLUMN occurrence_count INTEGER DEFAULT 1' },
      { name: 'resolved_at',     sql: 'ALTER TABLE monitor_alerts ADD COLUMN resolved_at TEXT' },
      { name: 'resolution_note', sql: 'ALTER TABLE monitor_alerts ADD COLUMN resolution_note TEXT' },
    ];

    let added = 0;
    for (const col of additions) {
      if (!columns.has(col.name)) {
        db.exec(col.sql);
        console.log(`[migrate] Added column: monitor_alerts.${col.name}`);
        added++;
      } else {
        console.log(`[migrate] Column already exists: monitor_alerts.${col.name} — skipped`);
      }
    }

    console.log(`[migrate] Done. ${added} column(s) added.`);
  } finally {
    db.close();
  }
}

run();
