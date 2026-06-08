#!/usr/bin/env node
/**
 * task-stats.js â€” Task queue analytics for the {{SITE_NAME}} SQLite state DB.
 *
 * Runs GROUP BY queries and aggregations for operational insights.
 * Supports breakdowns by status, type, risk, source, day, and throughput.
 *
 * Usage:
 *   node task-stats.js [options]
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const HELP = `
task-stats â€” Task queue analytics and aggregations.

USAGE
  node task-stats.js [options]

VIEWS (pick one or combine)
  --by-status               Tasks grouped by status (default)
  --by-type                 Tasks grouped by task_type (from metadata)
  --by-risk                 Tasks grouped by risk_level
  --by-source               Tasks grouped by source
  --by-day                  Tasks created per day (last 30 days)
  --throughput              Completed tasks per day (last 30 days)
  --avg-age                 Average age of open tasks by status
  --backlog                 Backlog overview (open tasks by priority tiers)
  --all                     Show all analytics views combined

OPTIONS
  --days <n>                Number of days for --by-day and --throughput (default: 30)
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without a database

EXAMPLES
  node task-stats.js                      # Default: by-status breakdown
  node task-stats.js --by-type --table
  node task-stats.js --throughput --days 14
  node task-stats.js --all --json
  node task-stats.js --backlog
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
      by_status: [
        { status: 'candidate', count: 45 },
        { status: 'approved', count: 12 },
        { status: 'in_progress', count: 3 },
        { status: 'completed', count: 87 },
        { status: 'failed', count: 2 },
      ],
      total_tasks: 149,
      generated_at: nowIso(),
    };
    printOutput(envelope(sample, { tool: 'task-stats' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const days = numberArg(args, 'days', 30);
    const showAll = boolArg(args, 'all');

    const result = {};

    // Determine which views to show
    const explicitView = args['by-status'] || args['by-type'] || args['by-risk'] ||
      args['by-source'] || args['by-day'] || args.throughput ||
      args['avg-age'] || args.backlog;

    const showByStatus = showAll || boolArg(args, 'by-status') || !explicitView;
    const showByType = showAll || boolArg(args, 'by-type');
    const showByRisk = showAll || boolArg(args, 'by-risk');
    const showBySource = showAll || boolArg(args, 'by-source');
    const showByDay = showAll || boolArg(args, 'by-day');
    const showThroughput = showAll || boolArg(args, 'throughput');
    const showAvgAge = showAll || boolArg(args, 'avg-age');
    const showBacklog = showAll || boolArg(args, 'backlog');

    // â”€â”€ Total â”€â”€
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM tasks').get();
    result.total_tasks = totalRow.total;

    // â”€â”€ By Status â”€â”€
    if (showByStatus) {
      result.by_status = db.prepare(`
        SELECT status, COUNT(*) as count,
               ROUND(AVG(priority_score), 1) as avg_priority
        FROM tasks
        GROUP BY status
        ORDER BY count DESC
      `).all();
    }

    // â”€â”€ By Type â”€â”€
    if (showByType) {
      result.by_type = db.prepare(`
        SELECT json_extract(metadata_json, '$.task_type') as task_type,
               COUNT(*) as count,
               ROUND(AVG(priority_score), 1) as avg_priority
        FROM tasks
        GROUP BY task_type
        ORDER BY count DESC
      `).all();
    }

    // â”€â”€ By Risk â”€â”€
    if (showByRisk) {
      result.by_risk = db.prepare(`
        SELECT risk_level, COUNT(*) as count,
               ROUND(AVG(priority_score), 1) as avg_priority
        FROM tasks
        GROUP BY risk_level
        ORDER BY count DESC
      `).all();
    }

    // â”€â”€ By Source â”€â”€
    if (showBySource) {
      result.by_source = db.prepare(`
        SELECT source, COUNT(*) as count,
               ROUND(AVG(priority_score), 1) as avg_priority
        FROM tasks
        GROUP BY source
        ORDER BY count DESC
      `).all();
    }

    // â”€â”€ By Day (created) â”€â”€
    if (showByDay) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      result.by_day = db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as created
        FROM tasks
        WHERE created_at >= ?
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `).all(cutoff);
    }

    // â”€â”€ Throughput (completed per day) â”€â”€
    if (showThroughput) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      result.throughput = db.prepare(`
        SELECT DATE(completed_at) as date, COUNT(*) as completed
        FROM tasks
        WHERE completed_at IS NOT NULL AND completed_at >= ?
        GROUP BY DATE(completed_at)
        ORDER BY date DESC
      `).all(cutoff);

      // Calculate average daily throughput
      if (result.throughput.length > 0) {
        const totalCompleted = result.throughput.reduce((sum, r) => sum + r.completed, 0);
        result.avg_daily_throughput = Math.round((totalCompleted / days) * 100) / 100;
      } else {
        result.avg_daily_throughput = 0;
      }
    }

    // â”€â”€ Average Age of open tasks â”€â”€
    if (showAvgAge) {
      result.avg_age = db.prepare(`
        SELECT status,
               COUNT(*) as count,
               ROUND(AVG(julianday('now') - julianday(created_at)), 1) as avg_age_days,
               ROUND(MIN(julianday('now') - julianday(created_at)), 1) as min_age_days,
               ROUND(MAX(julianday('now') - julianday(created_at)), 1) as max_age_days
        FROM tasks
        WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected', 'executed', 'deployed_to_production')
        GROUP BY status
        ORDER BY avg_age_days DESC
      `).all();
    }

    // â”€â”€ Backlog overview â”€â”€
    if (showBacklog) {
      result.backlog = {
        open_tasks: db.prepare(`
          SELECT COUNT(*) as count
          FROM tasks
          WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected', 'executed', 'deployed_to_production')
        `).get().count,

        by_priority_tier: db.prepare(`
          SELECT
            CASE
              WHEN priority_score >= 800 THEN 'critical (800+)'
              WHEN priority_score >= 500 THEN 'high (500-799)'
              WHEN priority_score >= 200 THEN 'medium (200-499)'
              ELSE 'low (1-199)'
            END as tier,
            COUNT(*) as count
          FROM tasks
          WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected', 'executed', 'deployed_to_production')
          GROUP BY tier
          ORDER BY MIN(priority_score) DESC
        `).all(),

        oldest_open: db.prepare(`
          SELECT task_id, title, status, priority_score, created_at,
                 ROUND(julianday('now') - julianday(created_at), 1) as age_days
          FROM tasks
          WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected', 'executed', 'deployed_to_production')
          ORDER BY created_at ASC
          LIMIT 5
        `).all(),

        highest_priority_open: db.prepare(`
          SELECT task_id, title, status, priority_score, risk_level, created_at
          FROM tasks
          WHERE status NOT IN ('completed', 'failed', 'skipped', 'rejected', 'executed', 'deployed_to_production')
          ORDER BY priority_score DESC
          LIMIT 5
        `).all(),
      };
    }

    db.close();

    printOutput(envelope(result, { tool: 'task-stats' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'task-stats' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
