#!/usr/bin/env node
/**
 * campaign-list.js â€” List money keyword campaigns from the {{SITE_NAME}} state DB.
 *
 * Displays campaigns with optional task progress counts and filtering.
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const TOOL = 'campaign-list';

const HELP = `
campaign-list â€” List money keyword campaigns.

USAGE
  v2 campaign list --db <path> [options]

FILTERS
  --status <s>               Filter: planning | active | paused | completed | cancelled | all (default: all)
  --cluster <name>           Filter by cluster
  --priority <level>         Filter by priority: high | medium | low

OPTIONS
  --with-tasks               Include child task counts per campaign
  --limit <N>                Max results (default: 50)
  --db <path>                SQLite database path
  --json                     JSON output (default)
  --table                    Table output
  --sample                   Show sample output without DB
  --help                     Show this help text

EXAMPLES
  v2 campaign list --status active --with-tasks
  v2 campaign list --cluster "seo-audit"
  v2 campaign list --json
`.trim();

module.exports = function campaignList() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const sample = {
      campaigns: [
        {
          campaign_id: 'CMP-2026-06-04-A1B2C3D4',
          cluster: 'seo-audit',
          target_keyword: '{{NICHE}} website seo audit service',
          target_url: '/services/seo-audit',
          decision: 'create_page',
          status: 'active',
          priority: 'high',
          success_metric: 'position<=10 within 30d',
          created_at: '2026-06-04T06:00:00.000Z',
          updated_at: '2026-06-04T06:00:00.000Z',
          task_summary: { total: 3, completed: 1, pending: 1, in_progress: 1 },
        },
      ],
      total: 1,
      summary: {
        by_status: { active: 1 },
        by_priority: { high: 1 },
      },
    };
    printOutput(envelope(sample, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const limit = numberArg(args, 'limit', 50);
    const withTasks = boolArg(args, 'with-tasks');

    try {
      const conditions = [];
      const params = [];

      if (args.status && args.status !== 'all') {
        conditions.push('c.status = ?');
        params.push(args.status);
      }
      if (args.cluster) {
        conditions.push('c.cluster = ?');
        params.push(args.cluster);
      }
      if (args.priority) {
        conditions.push('c.priority = ?');
        params.push(args.priority);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const sql = `
        SELECT * FROM campaigns c
        ${whereClause}
        ORDER BY
          CASE c.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          c.created_at DESC
        LIMIT ?
      `;
      params.push(limit);

      const campaigns = db.prepare(sql).all(...params);

      // Enrich with child task counts if requested
      if (withTasks) {
        for (const campaign of campaigns) {
          const taskRows = db.prepare(`
            SELECT status, COUNT(*) as cnt
            FROM tasks
            WHERE metadata_json LIKE ?
            GROUP BY status
          `).all(`%${campaign.campaign_id}%`);

          const taskSummary = { total: 0 };
          for (const row of taskRows) {
            taskSummary[row.status] = row.cnt;
            taskSummary.total += row.cnt;
          }
          campaign.task_summary = taskSummary;
        }
      }

      // Parse content_brief_json for display
      for (const campaign of campaigns) {
        if (campaign.content_brief_json) {
          try {
            campaign.content_brief = JSON.parse(campaign.content_brief_json);
          } catch { /* leave as string */ }
        }
      }

      // Summary counts
      const countParams = params.slice(0, -1); // remove limit
      const totalRow = db.prepare(`
        SELECT COUNT(*) as total FROM campaigns c ${whereClause}
      `).get(...countParams);

      const byStatus = db.prepare(`
        SELECT status, COUNT(*) as cnt FROM campaigns GROUP BY status
      `).all();
      const byPriority = db.prepare(`
        SELECT priority, COUNT(*) as cnt FROM campaigns GROUP BY priority
      `).all();

      const result = {
        campaigns,
        total: totalRow.total,
        summary: {
          by_status: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
          by_priority: Object.fromEntries(byPriority.map(r => [r.priority, r.cnt])),
        },
      };

      printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
