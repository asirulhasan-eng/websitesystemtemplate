#!/usr/bin/env node
/**
 * serp-history.js â€” Query serp_checks table for historical SERP data
 *
 * Supports keyword filtering, trend analysis, best-ever position tracking,
 * volatility computation, and competitor analysis from stored SERP snapshots.
 *
 * Usage:
 *   node serp-history.js --db <path> [options]
 *
 * See --help for full option list.
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { daysAgo } = require('../lib/dates');

const TOOL = 'serp-history';

const HELP = `
serp-history â€” Query historical SERP check data from SQLite

USAGE
  node serp-history.js --db <path> [options]

REQUIRED
  --db <path>                SQLite database path

KEYWORD FILTER
  --keyword <text>           Filter by keyword substring (case-insensitive)

DATE FILTERS
  --days <N>                 Show last N days of data
  --since <YYYY-MM-DD>       Show data checked on or after date
  --until <YYYY-MM-DD>       Show data checked on or before date

ANALYSIS MODES
  --trend                    Show position trend over time per keyword
  --best                     Show best-ever position per keyword
  --volatility               Compute position volatility (std deviation)
  --competitors              Show competitor positions from snapshot data

SORTING & LIMITS
  --sort <field>             Sort by field (default: checked_at)
  --limit <N>                Max rows to return (default: 100)

OUTPUT
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output

EXAMPLES
  node serp-history.js --db ./seo.db --keyword "{{NICHE}} seo" --table
  node serp-history.js --db ./seo.db --trend --days 30
  node serp-history.js --db ./seo.db --best --sort position
  node serp-history.js --db ./seo.db --volatility --keyword {{NICHE}}
  node serp-history.js --db ./seo.db --competitors --keyword "{{NICHE}} seo" --limit 5
`.trim();

function buildBaseConditions(args) {
  const conditions = [];
  const params = [];

  if (args.keyword) {
    conditions.push('LOWER(keyword) LIKE ?');
    params.push(`%${args.keyword.toLowerCase()}%`);
  }
  if (args.days) {
    const since = daysAgo(numberArg(args, 'days'));
    conditions.push('checked_at >= ?');
    params.push(since);
  }
  if (args.since) {
    conditions.push('checked_at >= ?');
    params.push(args.since);
  }
  if (args.until) {
    conditions.push('checked_at <= ?');
    params.push(args.until + 'T23:59:59.999Z');
  }

  return { conditions, params };
}

function queryPlain(db, args) {
  const { conditions, params } = buildBaseConditions(args);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const VALID_PLAIN_SORT = new Set(['serp_check_id', 'keyword', 'provider', 'position', 'url', 'domain', 'checked_at']);
  const sortField = VALID_PLAIN_SORT.has(args.sort) ? args.sort : 'checked_at';
  const sortDir = sortField === 'position' ? 'ASC' : 'DESC';
  const limit = numberArg(args, 'limit', 100);

  const sql = `
    SELECT serp_check_id, keyword, provider, position, url, domain, checked_at
    FROM serp_checks
    ${whereClause}
    ORDER BY ${sortField} ${sortDir}
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, limit);
}

function queryTrend(db, args) {
  const { conditions, params } = buildBaseConditions(args);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = numberArg(args, 'limit', 100);

  // Get all checks grouped by keyword, ordered by time
  const sql = `
    SELECT keyword, position, url, checked_at, provider
    FROM serp_checks
    ${whereClause}
    ORDER BY keyword ASC, checked_at ASC
  `;
  const allRows = db.prepare(sql).all(...params);

  // Group by keyword and build trend
  const groups = {};
  for (const row of allRows) {
    if (!groups[row.keyword]) groups[row.keyword] = [];
    groups[row.keyword].push(row);
  }

  const trends = [];
  for (const [keyword, checks] of Object.entries(groups)) {
    const positions = checks.filter(c => c.position != null).map(c => c.position);
    const first = checks[0];
    const last = checks[checks.length - 1];

    const startPos = first.position;
    const endPos = last.position;
    const change = (startPos != null && endPos != null) ? Math.round((startPos - endPos) * 10) / 10 : null;

    let direction = 'stable';
    if (change != null) {
      if (change > 2) direction = 'improving';
      else if (change < -2) direction = 'declining';
    }

    trends.push({
      keyword,
      checks_count: checks.length,
      first_position: startPos,
      latest_position: endPos,
      position_change: change,
      direction,
      best_position: positions.length > 0 ? Math.min(...positions) : null,
      worst_position: positions.length > 0 ? Math.max(...positions) : null,
      latest_url: last.url,
      first_checked: first.checked_at,
      last_checked: last.checked_at,
      positions_over_time: checks.map(c => ({
        position: c.position,
        date: c.checked_at ? c.checked_at.slice(0, 10) : null,
      })),
    });
  }

  // Sort
  const VALID_TREND_SORT = new Set([
    'keyword', 'checks_count', 'first_position', 'latest_position',
    'position_change', 'direction', 'best_position', 'worst_position',
    'latest_url', 'first_checked', 'last_checked',
  ]);
  const sortField = VALID_TREND_SORT.has(args.sort) ? args.sort : 'position_change';
  trends.sort((a, b) => {
    const va = a[sortField];
    const vb = b[sortField];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number') return sortField === 'latest_position' ? va - vb : Math.abs(vb) - Math.abs(va);
    return String(va).localeCompare(String(vb));
  });

  return trends.slice(0, limit);
}

function queryBest(db, args) {
  const { conditions, params } = buildBaseConditions(args);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1';
  const VALID_BEST_SORT = new Set(['keyword', 'best_position', 'worst_position', 'avg_position', 'check_count', 'first_checked', 'last_checked']);
  const sortField = VALID_BEST_SORT.has(args.sort) ? args.sort : 'best_position';
  const sortDir = sortField === 'best_position' ? 'ASC' : 'DESC';
  const limit = numberArg(args, 'limit', 100);

  const sql = `
    SELECT keyword,
           MIN(position) as best_position,
           MAX(position) as worst_position,
           ROUND(AVG(position), 1) as avg_position,
           COUNT(*) as check_count,
           MIN(checked_at) as first_checked,
           MAX(checked_at) as last_checked
    FROM serp_checks
    ${whereClause}
    AND position IS NOT NULL
    GROUP BY keyword
    ORDER BY ${sortField} ${sortDir}
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, limit);
}

function queryVolatility(db, args) {
  const { conditions, params } = buildBaseConditions(args);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1';
  const limit = numberArg(args, 'limit', 100);

  // Get all position data grouped by keyword
  const sql = `
    SELECT keyword, position, checked_at
    FROM serp_checks
    ${whereClause}
    AND position IS NOT NULL
    ORDER BY keyword ASC, checked_at ASC
  `;
  const allRows = db.prepare(sql).all(...params);

  const groups = {};
  for (const row of allRows) {
    if (!groups[row.keyword]) groups[row.keyword] = [];
    groups[row.keyword].push(row.position);
  }

  const results = [];
  for (const [keyword, positions] of Object.entries(groups)) {
    if (positions.length < 2) continue;

    const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
    const variance = positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length;
    const stdDev = Math.sqrt(variance);

    // Compute max swing between consecutive checks
    let maxSwing = 0;
    for (let i = 1; i < positions.length; i++) {
      maxSwing = Math.max(maxSwing, Math.abs(positions[i] - positions[i - 1]));
    }

    let volatilityLevel = 'low';
    if (stdDev > 5) volatilityLevel = 'high';
    else if (stdDev > 2) volatilityLevel = 'medium';

    results.push({
      keyword,
      check_count: positions.length,
      avg_position: Math.round(mean * 10) / 10,
      std_deviation: Math.round(stdDev * 100) / 100,
      max_swing: Math.round(maxSwing * 10) / 10,
      min_position: Math.min(...positions),
      max_position: Math.max(...positions),
      range: Math.round((Math.max(...positions) - Math.min(...positions)) * 10) / 10,
      volatility_level: volatilityLevel,
    });
  }

  // Sort by volatility (std deviation desc)
  const VALID_VOL_SORT = new Set([
    'keyword', 'check_count', 'avg_position', 'std_deviation',
    'max_swing', 'min_position', 'max_position', 'range', 'volatility_level',
  ]);
  const sortField = VALID_VOL_SORT.has(args.sort) ? args.sort : 'std_deviation';
  results.sort((a, b) => {
    const va = a[sortField];
    const vb = b[sortField];
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number') return vb - va;
    return String(vb).localeCompare(String(va));
  });

  return results.slice(0, limit);
}

function queryCompetitors(db, args) {
  const { conditions, params } = buildBaseConditions(args);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1';
  const limit = numberArg(args, 'limit', 100);

  const sql = `
    SELECT serp_check_id, keyword, snapshot_json, checked_at
    FROM serp_checks
    ${whereClause}
    AND snapshot_json IS NOT NULL
    ORDER BY checked_at DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);

  const results = [];
  for (const row of rows) {
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot_json); } catch { continue; }

    const topResults = snapshot.top_results || [];
    if (topResults.length === 0) continue;

    // Build competitor breakdown
    const competitors = topResults.map(r => ({
      position: r.position,
      domain: r.domain,
      title: r.title,
      link: r.link,
    }));

    results.push({
      keyword: row.keyword,
      checked_at: row.checked_at,
      competitor_count: competitors.length,
      competitors,
    });
  }

  return results;
}

function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  try {
    if (!args.db && !process.env.CLIENT_DB_PATH && !process.env.SEO_AGENT_DB) {
      throw new Error('--db <path> is required. Provide the SQLite database path.');
    }

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    let rows;
    let mode = 'plain';

    if (boolArg(args, 'trend')) {
      mode = 'trend';
      rows = queryTrend(db, args);
    } else if (boolArg(args, 'best')) {
      mode = 'best';
      rows = queryBest(db, args);
    } else if (boolArg(args, 'volatility')) {
      mode = 'volatility';
      rows = queryVolatility(db, args);
    } else if (boolArg(args, 'competitors')) {
      mode = 'competitors';
      rows = queryCompetitors(db, args);
    } else {
      mode = 'plain';
      rows = queryPlain(db, args);
    }

    db.close();

    const output = envelope({
      mode,
      total_rows: rows.length,
      rows,
    }, { tool: TOOL });

    printOutput(output, getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
