#!/usr/bin/env node
/**
 * gsc-history.js â€” Query gsc_snapshots table from SQLite
 *
 * Dynamically builds SQL queries against stored GSC snapshot data.
 * Supports filtering, aggregation, grouping, and trend detection.
 *
 * Usage:
 *   node gsc-history.js --db <path> [options]
 *
 * See --help for full option list.
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { daysAgo, nowIso } = require('../lib/dates');

const TOOL = 'gsc-history';

const HELP = `
gsc-history â€” Query stored GSC snapshot data from SQLite

USAGE
  node gsc-history.js --db <path> [options]

REQUIRED
  --db <path>                SQLite database path

KEYWORD / PAGE FILTERS
  --keyword <text>           Filter by query substring (case-insensitive)
  --keyword-exact <text>     Filter by exact query match
  --page <text>              Filter by page URL substring

DATE FILTERS
  --days <N>                 Show last N days of data
  --since <YYYY-MM-DD>       Show data captured on or after date
  --until <YYYY-MM-DD>       Show data captured on or before date
  --tag <tag>                Filter by snapshot tag in metadata

AGGREGATION
  --group-by <keyword|page>  Group results by keyword or page
  --aggregate <avg|sum|min|max>  Aggregation function for metrics (default: avg)
  --latest                   Show only the most recent snapshot per keyword

METRIC FILTERS
  --min-impressions <N>      Minimum impressions threshold
  --min-position-change <N>  Minimum absolute position change
  --improving                Show only improving keywords (position went down)
  --declining                Show only declining keywords (position went up)

SORTING & LIMITS
  --sort <field>             Sort by field (default: captured_at)
  --limit <N>                Max rows to return (default: 100)

OUTPUT
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output

EXAMPLES
  node gsc-history.js --db ./seo.db --keyword {{NICHE}} --table
  node gsc-history.js --db ./seo.db --days 30 --group-by keyword --aggregate avg
  node gsc-history.js --db ./seo.db --latest --sort impressions --limit 20
  node gsc-history.js --db ./seo.db --improving --min-impressions 10
  node gsc-history.js --db ./seo.db --page /local-seo --since 2026-05-01
`.trim();

function buildQuery(args) {
  const conditions = [];
  const params = [];
  const groupBy = args['group-by'];
  const aggregate = args.aggregate || 'avg';
  const latest = boolArg(args, 'latest');

  // â”€â”€ Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (args.keyword) {
    conditions.push('LOWER(query) LIKE ?');
    params.push(`%${args.keyword.toLowerCase()}%`);
  }
  if (args['keyword-exact']) {
    conditions.push('query = ?');
    params.push(args['keyword-exact']);
  }
  if (args.page) {
    conditions.push('LOWER(page) LIKE ?');
    params.push(`%${args.page.toLowerCase()}%`);
  }
  if (args.days) {
    const since = daysAgo(numberArg(args, 'days'));
    conditions.push('captured_at >= ?');
    params.push(since);
  }
  if (args.since) {
    conditions.push('captured_at >= ?');
    params.push(args.since);
  }
  if (args.until) {
    conditions.push('captured_at <= ?');
    params.push(args.until + 'T23:59:59.999Z');
  }
  if (args.tag) {
    conditions.push("json_extract(metadata_json, '$.tag') = ?");
    params.push(args.tag);
  }
  if (args['min-impressions']) {
    const minImp = numberArg(args, 'min-impressions');
    if (groupBy) {
      // Applied via HAVING clause
    } else {
      conditions.push('impressions >= ?');
      params.push(minImp);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // â”€â”€ Latest per keyword â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (latest) {
    const VALID_LATEST_SORT = new Set(['snapshot_id', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position', 'date_range_start', 'date_range_end', 'captured_at']);
    const sortField = VALID_LATEST_SORT.has(args.sort) ? args.sort : 'impressions';
    const sortDir = sortField === 'position' ? 'ASC' : 'DESC';
    const limit = numberArg(args, 'limit', 100);

    const sql = `
      SELECT g.snapshot_id, g.query, g.page, g.clicks, g.impressions,
             g.ctr, g.position, g.date_range_start, g.date_range_end, g.captured_at
      FROM gsc_snapshots g
      INNER JOIN (
        SELECT query, MAX(captured_at) as max_captured
        FROM gsc_snapshots
        ${whereClause}
        GROUP BY query
      ) latest ON g.query = latest.query AND g.captured_at = latest.max_captured
      ${whereClause ? whereClause.replace('WHERE', 'AND').replace(/^AND/, 'WHERE') + ' ' : ''}
      ORDER BY ${sortField} ${sortDir}
      LIMIT ?
    `;
    // Duplicate params for the subquery and outer query is tricky; simplify:
    return { sql: buildLatestQuery(conditions, args), params: [...params, ...params, limit] };
  }

  // â”€â”€ Grouped aggregation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (groupBy) {
    const aggFn = ['avg', 'sum', 'min', 'max'].includes(aggregate) ? aggregate.toUpperCase() : 'AVG';
    const safeAggregate = ['avg', 'sum', 'min', 'max'].includes(aggregate) ? aggregate : 'avg';
    const safeGroupBy = groupBy === 'page' ? 'page' : 'query';
    const havingClauses = [];
    const havingParams = [];

    if (args['min-impressions']) {
      havingClauses.push(`${aggFn}(impressions) >= ?`);
      havingParams.push(numberArg(args, 'min-impressions'));
    }

    const havingClause = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';
    // Build valid grouped sort fields dynamically based on aggregate
    const VALID_GROUPED_SORT = new Set([
      `${safeAggregate}_clicks`, `${safeAggregate}_impressions`,
      `${safeAggregate}_ctr`, `${safeAggregate}_position`,
      'snapshot_count', 'first_seen', 'last_seen', safeGroupBy,
    ]);
    const safeSortField = VALID_GROUPED_SORT.has(args.sort) ? args.sort : `${safeAggregate}_impressions`;
    const safeSortDir = safeSortField === `${safeAggregate}_position` ? 'ASC' : 'DESC';
    const limit = numberArg(args, 'limit', 100);

    const sql = `
      SELECT ${safeGroupBy},
             COUNT(*) as snapshot_count,
             ROUND(${aggFn}(clicks), 1) as ${safeAggregate}_clicks,
             ROUND(${aggFn}(impressions), 1) as ${safeAggregate}_impressions,
             ROUND(${aggFn}(ctr), 4) as ${safeAggregate}_ctr,
             ROUND(${aggFn}(position), 1) as ${safeAggregate}_position,
             MIN(captured_at) as first_seen,
             MAX(captured_at) as last_seen
      FROM gsc_snapshots
      ${whereClause}
      GROUP BY ${safeGroupBy}
      ${havingClause}
      ORDER BY ${safeSortField} ${safeSortDir}
      LIMIT ?
    `;
    return { sql, params: [...params, ...havingParams, limit] };
  }

  // â”€â”€ Plain query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const VALID_PLAIN_SORT = new Set(['snapshot_id', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position', 'date_range_start', 'date_range_end', 'captured_at']);
  const sortField = VALID_PLAIN_SORT.has(args.sort) ? args.sort : 'captured_at';
  const sortDir = sortField === 'position' ? 'ASC' : 'DESC';
  const limit = numberArg(args, 'limit', 100);

  const sql = `
    SELECT snapshot_id, query, page, clicks, impressions, ctr, position,
           date_range_start, date_range_end, captured_at
    FROM gsc_snapshots
    ${whereClause}
    ORDER BY ${sortField} ${sortDir}
    LIMIT ?
  `;
  return { sql, params: [...params, limit] };
}

// Prefix bare snapshot column references with the given table alias so the
// outer JOIN conditions are unambiguous (`query` exists in both gsc_snapshots
// and the `latest` CTE, which otherwise throws "ambiguous column name").
function qualifyConditions(conditions, alias) {
  const COLUMNS = ['snapshot_id', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position', 'date_range_start', 'date_range_end', 'captured_at', 'metadata_json'];
  const re = new RegExp(`(?<![\\w.])(${COLUMNS.join('|')})\\b`, 'g');
  return conditions.map((cond) => cond.replace(re, `${alias}.$1`));
}

function buildLatestQuery(conditions, args) {
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const outerConditions = qualifyConditions(conditions, 'g');
  const VALID_LATEST_SORT = new Set(['snapshot_id', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position', 'date_range_start', 'date_range_end', 'captured_at']);
  const sortField = VALID_LATEST_SORT.has(args.sort) ? args.sort : 'impressions';
  const sortDir = sortField === 'position' ? 'ASC' : 'DESC';

  return `
    WITH latest AS (
      SELECT query, MAX(captured_at) as max_captured
      FROM gsc_snapshots
      ${whereClause}
      GROUP BY query
    )
    SELECT g.snapshot_id, g.query, g.page, g.clicks, g.impressions,
           g.ctr, g.position, g.date_range_start, g.date_range_end, g.captured_at
    FROM gsc_snapshots g
    INNER JOIN latest ON g.query = latest.query AND g.captured_at = latest.max_captured
    ${outerConditions.length ? 'WHERE ' + outerConditions.join(' AND ') : ''}
    ORDER BY g.${sortField} ${sortDir}
    LIMIT ?
  `;
}

function detectTrends(rows, db, args) {
  if (!boolArg(args, 'improving') && !boolArg(args, 'declining') && !args['min-position-change']) {
    return rows;
  }

  // For each row, look up previous snapshot to compute position change
  const enriched = [];
  for (const row of rows) {
    const prev = db.prepare(`
      SELECT position FROM gsc_snapshots
      WHERE query = ? AND captured_at < ?
      ORDER BY captured_at DESC LIMIT 1
    `).get(row.query, row.captured_at);

    const positionChange = prev ? Math.round((row.position - prev.position) * 10) / 10 : 0;
    const enrichedRow = { ...row, position_change: positionChange, previous_position: prev ? prev.position : null };

    if (args['min-position-change']) {
      if (Math.abs(positionChange) < numberArg(args, 'min-position-change')) continue;
    }
    if (boolArg(args, 'improving') && positionChange >= 0) continue;  // improving = position went down (lower=better)
    if (boolArg(args, 'declining') && positionChange <= 0) continue;  // declining = position went up

    enriched.push(enrichedRow);
  }
  return enriched;
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
    const { sql, params } = buildQuery(args);

    let rows;
    try {
      const stmt = db.prepare(sql);
      rows = stmt.all(...params);
    } catch (sqlErr) {
      throw new Error(`SQL error: ${sqlErr.message}\nQuery: ${sql}\nParams: ${JSON.stringify(params)}`);
    }

    // Apply trend detection filters
    const needsTrend = boolArg(args, 'improving') || boolArg(args, 'declining') || args['min-position-change'];
    if (needsTrend) {
      rows = detectTrends(rows, db, args);
    }

    db.close();

    const output = envelope({
      total_rows: rows.length,
      query_used: sql.replace(/\s+/g, ' ').trim(),
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
