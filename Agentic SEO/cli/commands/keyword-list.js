#!/usr/bin/env node
/**
 * keyword-list.js â€” List tracked keywords from the {{SITE_NAME}} SQLite state DB.
 *
 * Supports filtering, sorting, and optional JOINs with serp_checks and gsc_snapshots
 * for enriched output showing latest positions and search metrics.
 *
 * Usage:
 *   node keyword-list.js [options]
 */

const { parseArgs, numberArg, boolArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
keyword-list â€” List tracked keywords with optional SERP and GSC data.

USAGE
  node keyword-list.js [options]

FILTERS
  --cluster <name>          Filter by cluster group
  --priority <level>        Filter by priority: high | medium | low
  --keyword <text>          Substring filter on keyword text
  --intent-tier <tier>      Filter by intent: money | authority | info | noise
  --page-type <type>        Filter by page type: service | blog | home
  --source <src>            Filter by source: gsc | serper | manual
  --status <status>         Filter by status: active | aspirational | ranking | paused
  --has-url                 Only keywords with a target_url set

ENRICHMENT
  --with-latest             Join with serp_checks for latest SERP position
  --with-gsc                Join with gsc_snapshots for latest GSC metrics

SORTING & PAGINATION
  --sort <field>            Sort by: keyword | priority | position | cluster |
                            created | clicks | impressions (default: keyword)
  --asc                     Sort ascending (default for keyword)
  --desc                    Sort descending
  --limit <n>               Max results (default: 100)
  --offset <n>              Skip first N results (default: 0)

OUTPUT
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --csv                     Output as CSV
  --sample                  Show sample output without a database

EXAMPLES
  node keyword-list.js --table
  node keyword-list.js --cluster "core services" --with-latest --table
  node keyword-list.js --priority high --with-gsc --sort clicks --desc
  node keyword-list.js --with-latest --with-gsc --csv
  node keyword-list.js --keyword "{{AUDIENCE}}" --limit 10
`.trim();

const SORT_MAP = {
  keyword: 'k.keyword',
  priority: `CASE k.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
  position: 'k.current_position',
  cluster: 'k.cluster',
  created: 'k.created_at',
  clicks: 'gsc.clicks',
  impressions: 'gsc.impressions',
};

const PRIORITY_ORDER = { high: 1, medium: 2, low: 3 };

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = {
      results: [
        {
          keyword_id: 'KW-2026-06-03-A1B2C3D4',
          keyword: '{{AUDIENCE}} near me',
          cluster: 'core services',
          priority: 'high',
          target_url: 'https://client.com/{{AUDIENCE}}',
          current_position: 8,
          best_position: 5,
          last_checked_at: '2026-06-03T04:00:00.000Z',
          latest_serp_position: 8,
          latest_serp_url: 'https://client.com/{{AUDIENCE}}',
          gsc_clicks: 45,
          gsc_impressions: 890,
          gsc_ctr: 0.051,
          gsc_position: 7.2,
        },
        {
          keyword_id: 'KW-2026-06-03-E5F6G7H8',
          keyword: 'emergency {{AUDIENCE}}',
          cluster: 'core services',
          priority: 'high',
          target_url: 'https://client.com/emergency-{{AUDIENCE}}',
          current_position: 15,
          best_position: 12,
          last_checked_at: '2026-06-03T04:00:00.000Z',
          latest_serp_position: 15,
          latest_serp_url: 'https://client.com/emergency-{{AUDIENCE}}',
          gsc_clicks: 12,
          gsc_impressions: 340,
          gsc_ctr: 0.035,
          gsc_position: 14.1,
        },
      ],
      total: 2,
    };
    printOutput(envelope(sample, { tool: 'keyword-list' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    const withLatest = boolArg(args, 'with-latest');
    const withGsc = boolArg(args, 'with-gsc');
    const limit = numberArg(args, 'limit', 100);
    const offset = numberArg(args, 'offset', 0);

    // â”€â”€ Build SELECT clause â”€â”€
    let selectFields = [
      'k.keyword_id', 'k.keyword', 'k.cluster', 'k.priority',
      'k.target_url', 'k.current_position', 'k.best_position',
      'k.last_checked_at', 'k.created_at', 'k.metadata_json',
      'k.intent_tier', 'k.target_page_type', 'k.source', 'k.status',
    ];

    const joins = [];
    const conditions = [];
    const params = [];

    // â”€â”€ Optional SERP JOIN â”€â”€
    if (withLatest) {
      // Use a correlated subquery to get the latest serp_check per keyword
      joins.push(`
        LEFT JOIN (
          SELECT s1.keyword, s1.position AS latest_serp_position,
                 s1.url AS latest_serp_url, s1.domain AS latest_serp_domain,
                 s1.provider AS latest_serp_provider, s1.checked_at AS latest_serp_checked_at
          FROM serp_checks s1
          INNER JOIN (
            SELECT keyword, MAX(checked_at) AS max_checked
            FROM serp_checks GROUP BY keyword
          ) s2 ON s1.keyword = s2.keyword AND s1.checked_at = s2.max_checked
        ) serp ON serp.keyword = k.keyword
      `);
      selectFields.push(
        'serp.latest_serp_position',
        'serp.latest_serp_url',
        'serp.latest_serp_domain',
        'serp.latest_serp_provider',
        'serp.latest_serp_checked_at'
      );
    }

    // â”€â”€ Optional GSC JOIN â”€â”€
    if (withGsc) {
      // Get the latest GSC snapshot per keyword (query field)
      joins.push(`
        LEFT JOIN (
          SELECT g1.query, g1.page AS gsc_page,
                 g1.clicks AS gsc_clicks, g1.impressions AS gsc_impressions,
                 g1.ctr AS gsc_ctr, g1.position AS gsc_position,
                 g1.date_range_start AS gsc_date_start, g1.date_range_end AS gsc_date_end,
                 g1.captured_at AS gsc_captured_at
          FROM gsc_snapshots g1
          INNER JOIN (
            SELECT query, MAX(captured_at) AS max_captured
            FROM gsc_snapshots GROUP BY query
          ) g2 ON g1.query = g2.query AND g1.captured_at = g2.max_captured
        ) gsc ON gsc.query = k.keyword
      `);
      selectFields.push(
        'gsc.gsc_page',
        'gsc.gsc_clicks',
        'gsc.gsc_impressions',
        'gsc.gsc_ctr',
        'gsc.gsc_position',
        'gsc.gsc_date_start',
        'gsc.gsc_date_end',
        'gsc.gsc_captured_at'
      );
    }

    // â”€â”€ WHERE conditions â”€â”€
    if (args.cluster) {
      conditions.push('k.cluster = ?');
      params.push(args.cluster);
    }

    if (args.priority) {
      conditions.push('k.priority = ?');
      params.push(args.priority);
    }

    if (args.keyword) {
      conditions.push('k.keyword LIKE ?');
      params.push(`%${args.keyword}%`);
    }

    if (boolArg(args, 'has-url')) {
      conditions.push("k.target_url IS NOT NULL AND k.target_url != ''");
    }

    if (args['intent-tier']) {
      conditions.push('k.intent_tier = ?');
      params.push(args['intent-tier']);
    }

    if (args['page-type']) {
      conditions.push('k.target_page_type = ?');
      params.push(args['page-type']);
    }

    if (args.source) {
      conditions.push('k.source = ?');
      params.push(args.source);
    }

    if (args.status) {
      conditions.push('k.status = ?');
      params.push(args.status);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // â”€â”€ Sort â”€â”€
    const VALID_SORT_FIELDS = new Set(Object.keys(SORT_MAP));
    const sortField = VALID_SORT_FIELDS.has(args.sort) ? args.sort : 'keyword';
    const sortExpr = SORT_MAP[sortField];

    // Determine sort direction
    let sortDir;
    if (boolArg(args, 'desc')) {
      sortDir = 'DESC';
    } else if (boolArg(args, 'asc')) {
      sortDir = 'ASC';
    } else {
      // Defaults: keyword/cluster ASC, others DESC
      sortDir = ['keyword', 'cluster', 'created'].includes(sortField) ? 'ASC' : 'DESC';
    }

    // Handle NULL positioning for sort
    const nullHandling = sortDir === 'ASC' ? 'NULLS LAST' : 'NULLS LAST';

    // â”€â”€ Build final SQL â”€â”€
    const sql = `
      SELECT ${selectFields.join(', ')}
      FROM keywords k
      ${joins.join('\n')}
      ${whereClause}
      ORDER BY ${sortExpr} ${sortDir}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const keywords = db.prepare(sql).all(...params);

    // Get total count
    const countParams = params.slice(0, -2);
    const countSql = `
      SELECT COUNT(*) as total
      FROM keywords k
      ${joins.join('\n')}
      ${whereClause}
    `;
    const totalRow = db.prepare(countSql).get(...countParams);

    // Get cluster summary
    const clusters = db.prepare(`
      SELECT cluster, COUNT(*) as count
      FROM keywords
      WHERE cluster IS NOT NULL
      GROUP BY cluster
      ORDER BY count DESC
    `).all();

    db.close();

    const result = {
      results: keywords,
      total: totalRow.total,
      limit,
      offset,
      has_more: offset + keywords.length < totalRow.total,
      clusters: clusters.length > 0 ? clusters : undefined,
    };

    printOutput(envelope(result, { tool: 'keyword-list' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'keyword-list' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
