#!/usr/bin/env node
/**
 * db-snapshot.js â€” System state summary for the {{SITE_NAME}} SQLite state DB.
 *
 * Provides a comprehensive health check: task counts, active locks, pending outbox,
 * heartbeats, alerts, cron runs, GSC/SERP snapshot stats, and DB file size.
 *
 * Usage:
 *   node db-snapshot.js [options]
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const HELP = `
db-snapshot â€” System state summary and health check.

USAGE
  node db-snapshot.js [options]

VIEWS
  --full                    Full system snapshot (default)
  --tasks-only              Only show task counts and status breakdown
  --health-only             Only show health indicators (locks, alerts, heartbeats)
  --recent-activity         Only show recent activity (last 24h events, cron runs)

OPTIONS
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without a database

OUTPUT SECTIONS (in --full mode)
  â€¢ task_summary      â€” Task counts by status and risk level
  â€¢ locks             â€” Active locks and their owners
  â€¢ outbox            â€” Pending/failed outbox jobs
  â€¢ heartbeats        â€” Latest heartbeat for each job
  â€¢ alerts            â€” Active/recent monitor alerts
  â€¢ cron_runs         â€” Last 5 cron runs by job
  â€¢ data_freshness    â€” GSC/SERP snapshot counts (last 7 days)
  â€¢ db_info           â€” Database file size, table count

EXAMPLES
  node db-snapshot.js                     # Full snapshot
  node db-snapshot.js --tasks-only --table
  node db-snapshot.js --health-only --json
  node db-snapshot.js --recent-activity
`.trim();

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = {
      snapshot_at: nowIso(),
      task_summary: {
        total: 149,
        by_status: [
          { status: 'candidate', count: 45 },
          { status: 'approved', count: 12 },
          { status: 'in_progress', count: 3 },
          { status: 'completed', count: 87 },
          { status: 'failed', count: 2 },
        ],
        by_risk: [
          { risk_level: 'safe', count: 60 },
          { risk_level: 'semi_safe', count: 72 },
          { risk_level: 'high_risk', count: 17 },
        ],
      },
      locks: { active: 2, stale: 0, details: [] },
      outbox: { pending: 5, failed: 0, processing: 1 },
      heartbeats: [],
      alerts: { active: 0, recent: [] },
      cron_runs: [],
      data_freshness: { gsc_snapshots_7d: 245, serp_checks_7d: 34 },
      db_info: { file_size_bytes: 524288, file_size_mb: 0.5, table_count: 18 },
    };
    printOutput(envelope(sample, { tool: 'db-snapshot' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    const isFull = boolArg(args, 'full') || (!args['tasks-only'] && !args['health-only'] && !args['recent-activity']);
    const tasksOnly = boolArg(args, 'tasks-only');
    const healthOnly = boolArg(args, 'health-only');
    const recentActivity = boolArg(args, 'recent-activity');

    const result = {
      snapshot_at: nowIso(),
    };

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // TASK SUMMARY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || tasksOnly) {
      const totalRow = db.prepare('SELECT COUNT(*) as total FROM tasks').get();

      result.task_summary = {
        total: totalRow.total,
        by_status: db.prepare(`
          SELECT status, COUNT(*) as count
          FROM tasks GROUP BY status ORDER BY count DESC
        `).all(),
        by_risk: db.prepare(`
          SELECT risk_level, COUNT(*) as count
          FROM tasks GROUP BY risk_level ORDER BY count DESC
        `).all(),
      };

      // Open tasks breakdown
      result.task_summary.open_tasks = db.prepare(`
        SELECT COUNT(*) as count
        FROM tasks
        WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected')
      `).get().count;

      // Recently completed (last 24h)
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      result.task_summary.completed_last_24h = db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE completed_at >= ?
      `).get(yesterday).count;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // HEALTH: LOCKS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || healthOnly) {
      const now = nowIso();
      const activeLocks = db.prepare(`
        SELECT * FROM locks WHERE status = 'active'
      `).all();

      const staleLocks = activeLocks.filter(l => {
        if (l.expires_at && l.expires_at < now) return true;
        if (l.heartbeat_at && l.stale_after_seconds) {
          const heartbeatAge = (Date.now() - new Date(l.heartbeat_at).getTime()) / 1000;
          return heartbeatAge > l.stale_after_seconds;
        }
        return false;
      });

      result.locks = {
        active: activeLocks.length,
        stale: staleLocks.length,
        details: activeLocks.map(l => ({
          lock_id: l.lock_id,
          lock_type: l.lock_type,
          resource_id: l.resource_id,
          task_id: l.task_id,
          owner_agent: l.owner_agent,
          created_at: l.created_at,
          expires_at: l.expires_at,
          is_stale: staleLocks.some(s => s.lock_id === l.lock_id),
        })),
      };
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // HEALTH: OUTBOX
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || healthOnly) {
      result.outbox = {
        pending: db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE status = 'pending'").get().c,
        failed: db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE status = 'failed'").get().c,
        processing: db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE status = 'processing'").get().c,
        completed: db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE status = 'completed'").get().c,
        oldest_pending: db.prepare(`
          SELECT outbox_id, job_type, entity_type, entity_id, created_at
          FROM outbox_jobs WHERE status = 'pending'
          ORDER BY created_at ASC LIMIT 3
        `).all(),
      };
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // HEALTH: HEARTBEATS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || healthOnly) {
      result.heartbeats = db.prepare(`
        SELECT job_name, status, heartbeat_at, current_task_id, duration_seconds,
               last_successful_run_at, last_failed_run_at, error_summary
        FROM heartbeats ORDER BY heartbeat_at DESC
      `).all();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // HEALTH: ALERTS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || healthOnly) {
      const activeAlerts = db.prepare(`
        SELECT * FROM monitor_alerts
        WHERE status IN ('active', 'triggered')
        ORDER BY triggered_at DESC
      `).all();

      const last24h = new Date(Date.now() - 86400000).toISOString();
      const recentAlerts = db.prepare(`
        SELECT * FROM monitor_alerts
        WHERE triggered_at >= ?
        ORDER BY triggered_at DESC LIMIT 10
      `).all(last24h);

      result.alerts = {
        active: activeAlerts.length,
        active_alerts: activeAlerts,
        recent_24h: recentAlerts,
      };
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // RECENT ACTIVITY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull || recentActivity) {
      const last24h = new Date(Date.now() - 86400000).toISOString();

      // Recent events
      result.recent_events = db.prepare(`
        SELECT event_id, event_type, task_id, source, agent_name, created_at
        FROM events
        WHERE created_at >= ?
        ORDER BY created_at DESC LIMIT 20
      `).all(last24h);

      // Recent cron runs
      result.cron_runs = db.prepare(`
        SELECT cron_run_id, job_name, status, started_at, finished_at,
               duration_seconds, created_tasks, completed_tasks, error_summary
        FROM cron_runs
        ORDER BY started_at DESC LIMIT 10
      `).all();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // DATA FRESHNESS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      result.data_freshness = {
        gsc_snapshots_7d: db.prepare(`
          SELECT COUNT(*) as c FROM gsc_snapshots WHERE captured_at >= ?
        `).get(sevenDaysAgo).c,
        serp_checks_7d: db.prepare(`
          SELECT COUNT(*) as c FROM serp_checks WHERE created_at >= ?
        `).get(sevenDaysAgo).c,
        total_keywords: db.prepare('SELECT COUNT(*) as c FROM keywords').get().c,
        total_pages: db.prepare('SELECT COUNT(*) as c FROM pages').get().c,
        latest_gsc_snapshot: db.prepare(`
          SELECT captured_at FROM gsc_snapshots ORDER BY captured_at DESC LIMIT 1
        `).get()?.captured_at || null,
        latest_serp_check: db.prepare(`
          SELECT created_at FROM serp_checks ORDER BY created_at DESC LIMIT 1
        `).get()?.created_at || null,
      };
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // DB INFO
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (isFull) {
      const resolvedPath = path.resolve(process.cwd(), dbPath);
      let fileSizeBytes = 0;
      try {
        fileSizeBytes = fs.statSync(resolvedPath).size;
      } catch { /* file might not exist yet */ }

      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();

      result.db_info = {
        path: resolvedPath,
        file_size_bytes: fileSizeBytes,
        file_size_mb: Math.round(fileSizeBytes / 1048576 * 100) / 100,
        table_count: tables.length,
        tables: tables.map(t => t.name),
      };
    }

    db.close();

    printOutput(envelope(result, { tool: 'db-snapshot' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'db-snapshot' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
