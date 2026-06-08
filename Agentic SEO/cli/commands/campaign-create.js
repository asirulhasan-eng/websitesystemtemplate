#!/usr/bin/env node
/**
 * campaign-create.js â€” Create a money keyword campaign in the {{SITE_NAME}} state DB.
 *
 * A campaign is a persistent multi-step entity that turns a money-keyword gap
 * into an actionable plan: decide create-vs-upgrade â†’ content brief â†’ produce
 * via the content engine â†’ internal links â†’ track over weeks.
 */

const fs = require('node:fs');
const { parseArgs, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'campaign-create';

const HELP = `
campaign-create â€” Create a money keyword campaign.

USAGE
  v2 campaign create --cluster <name> --decision <type> [options]

REQUIRED
  --cluster <name>           Target keyword cluster
  --decision <type>          create_page | upgrade_page

OPTIONS
  --keyword <kw>             Primary target keyword (defaults to cluster name)
  --target-url <url>         Target URL for the page
  --brief <json>             Content brief JSON string
  --brief-file <path>        Content brief from JSON file
  --success-metric <text>    e.g., "position<=10 within 30d"
  --priority <level>         high | medium | low (default: high)
  --status <s>               planning | active (default: planning)
  --db <path>                SQLite database path
  --json                     JSON output (default)
  --table                    Table output
  --sample                   Show sample output without DB
  --help                     Show this help text

EXAMPLES
  v2 campaign create --cluster "seo-audit" --decision create_page --target-url "/services/seo-audit"
  v2 campaign create --cluster "pricing" --keyword "{{NICHE}} seo pricing" --decision create_page --priority high
  v2 campaign create --cluster "core-service" --decision upgrade_page --target-url "/" --success-metric "position<=5 within 30d"
`.trim();

const VALID_DECISIONS = new Set(['create_page', 'upgrade_page']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const VALID_STATUSES = new Set(['planning', 'active']);

module.exports = function campaignCreate() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const sample = {
      action: 'create',
      campaign: {
        campaign_id: 'CMP-2026-06-04-A1B2C3D4',
        cluster: 'seo-audit',
        target_keyword: '{{NICHE}} website seo audit service',
        target_url: '/services/seo-audit',
        decision: 'create_page',
        status: 'planning',
        priority: 'high',
        success_metric: 'position<=10 within 30d',
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    };
    printOutput(envelope(sample, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    if (!args.cluster) throw new Error('--cluster is required');
    if (!args.decision) throw new Error('--decision is required');
    if (!VALID_DECISIONS.has(args.decision)) {
      throw new Error(`--decision must be one of: ${[...VALID_DECISIONS].join(', ')}`);
    }
    if (args.priority && !VALID_PRIORITIES.has(args.priority)) {
      throw new Error(`--priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`);
    }
    if (args.status && !VALID_STATUSES.has(args.status)) {
      throw new Error(`--status must be one of: ${[...VALID_STATUSES].join(', ')}`);
    }

    // Load content brief
    let briefJson = null;
    if (args['brief-file']) {
      if (!fs.existsSync(args['brief-file'])) {
        throw new Error(`Brief file not found: ${args['brief-file']}`);
      }
      briefJson = fs.readFileSync(args['brief-file'], 'utf8');
      // Validate it's valid JSON
      JSON.parse(briefJson);
    } else if (args.brief) {
      briefJson = args.brief;
      JSON.parse(briefJson); // validate
    }

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const now = nowIso();

    try {
      const campaignId = makeId('CMP');
      const cluster = args.cluster;
      const keyword = args.keyword || cluster;
      const targetUrl = args['target-url'] || null;
      const decision = args.decision;
      const status = args.status || 'planning';
      const priority = args.priority || 'high';
      const successMetric = args['success-metric'] || null;

      db.prepare(`
        INSERT INTO campaigns (
          campaign_id, cluster, target_keyword, target_url, decision,
          status, priority, content_brief_json, success_metric,
          created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        campaignId, cluster, keyword, targetUrl, decision,
        status, priority, briefJson, successMetric,
        now, now, JSON.stringify({ source: 'campaign-create-cli' })
      );

      const campaign = db.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId);

      printOutput(envelope({
        action: 'create',
        campaign,
      }, { tool: TOOL }), getOutputFormat(args));
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
