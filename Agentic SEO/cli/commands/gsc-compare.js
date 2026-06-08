#!/usr/bin/env node
/**
 * gsc-compare.js â€” Compare two GSC periods side by side
 *
 * Fetches or reads current vs previous period data, joins by keyword+page,
 * and computes position/impressions/clicks changes with trend classification.
 *
 * Usage:
 *   node gsc-compare.js [options]
 *
 * See --help for full option list.
 */

const { parseArgs, numberArg, boolArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { loadToolEnv } = require('../lib/env');
const { querySearchAnalytics } = require('../lib/gsc');
const { nowIso, daysAgo } = require('../lib/dates');

const TOOL = 'gsc-compare';

const HELP = `
gsc-compare â€” Compare two GSC time periods

USAGE
  node gsc-compare.js [options]

DATE RANGES
  --current-days <N>         Days for current period (default: 7)
  --previous-days <N>        Days for previous period (default: 7)
  --current-start <date>     Explicit current period start
  --current-end <date>       Explicit current period end
  --previous-start <date>    Explicit previous period start
  --previous-end <date>      Explicit previous period end

DATA SOURCE
  --from-db                  Use stored gsc_snapshots (default)
  --live                     Fetch fresh data from GSC API
  --sample                   Use built-in sample data
  --db <path>                SQLite database path (for --from-db)

FILTERS
  --min-impressions <N>      Min impressions in either period (default: 0)
  --keyword <text>           Filter by keyword substring
  --only-changes             Hide rows with no position change
  --threshold <N>            Position change threshold to flag (default: 2)

SORTING & OUTPUT
  --sort <field>             Sort by field (default: position_change)
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output

OUTPUT COLUMNS
  keyword, page, current_position, previous_position, position_change,
  current_impressions, previous_impressions, impressions_change_pct,
  current_clicks, previous_clicks, clicks_change_pct,
  current_ctr, previous_ctr, trend

TREND VALUES
  improving  â€” position improved (went down) by >= threshold
  declining  â€” position worsened (went up) by >= threshold
  stable     â€” position changed by < threshold
  new        â€” keyword appeared only in current period
  lost       â€” keyword appeared only in previous period

EXAMPLES
  node gsc-compare.js --sample --table
  node gsc-compare.js --db ./seo.db --current-days 7 --previous-days 7
  node gsc-compare.js --live --only-changes --threshold 3
  node gsc-compare.js --db ./seo.db --keyword {{NICHE}} --sort impressions_change_pct
`.trim();

function getSampleData() {
  return {
    current: [
      { query: '{{NICHE}} seo', page: 'https://{{DOMAIN}}/', clicks: 42, impressions: 890, ctr: 0.0472, position: 4.2 },
      { query: 'seo for {{AUDIENCE}}', page: 'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}', clicks: 38, impressions: 720, ctr: 0.0528, position: 5.1 },
      { query: '{{AUDIENCE}} website design', page: 'https://{{DOMAIN}}/web-design', clicks: 22, impressions: 540, ctr: 0.0407, position: 7.3 },
      { query: 'local seo {{NICHE}}', page: 'https://{{DOMAIN}}/local-seo', clicks: 18, impressions: 410, ctr: 0.0439, position: 8.6 },
      { query: '{{NICHE}} google ads', page: 'https://{{DOMAIN}}/google-ads', clicks: 15, impressions: 380, ctr: 0.0395, position: 9.2 },
      { query: '{{AUDIENCE}} lead generation', page: 'https://{{DOMAIN}}/leads', clicks: 10, impressions: 210, ctr: 0.0476, position: 12.5 },
    ],
    previous: [
      { query: '{{NICHE}} seo', page: 'https://{{DOMAIN}}/', clicks: 35, impressions: 810, ctr: 0.0432, position: 5.8 },
      { query: 'seo for {{AUDIENCE}}', page: 'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}', clicks: 40, impressions: 750, ctr: 0.0533, position: 4.9 },
      { query: '{{AUDIENCE}} website design', page: 'https://{{DOMAIN}}/web-design', clicks: 20, impressions: 510, ctr: 0.0392, position: 8.1 },
      { query: 'local seo {{NICHE}}', page: 'https://{{DOMAIN}}/local-seo', clicks: 22, impressions: 450, ctr: 0.0489, position: 7.2 },
      { query: '{{NICHE}} company seo services', page: 'https://{{DOMAIN}}/services', clicks: 12, impressions: 240, ctr: 0.05, position: 10.3 },
    ],
    current_start: daysAgo(7),
    current_end: daysAgo(0),
    previous_start: daysAgo(14),
    previous_end: daysAgo(7),
  };
}

function fetchFromDb(db, startDate, endDate) {
  // Match on the snapshot's reporting window (date_range_start/end), NOT
  // captured_at. captured_at is when the row was fetched, so two periods
  // backfilled on the same day would both fall in any captured_at window and
  // double-count. Matching the reporting window also keeps adjacent periods
  // disjoint even when they share a boundary date.
  const rows = db.prepare(`
    SELECT query, page, clicks, impressions, ctr, position
    FROM gsc_snapshots
    WHERE date_range_start >= ? AND date_range_end <= ?
    ORDER BY impressions DESC
  `).all(startDate, endDate);
  return rows;
}

async function fetchFromApi(config, startDate, endDate) {
  const result = await querySearchAnalytics(config, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    dataState: 'final',
    rowLimit: 25000,
  });
  return (result.rows || []).map(row => ({
    query: row.keys ? row.keys[0] : row.query,
    page: row.keys ? row.keys[1] : row.page,
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr != null ? Math.round(row.ctr * 10000) / 10000 : 0,
    position: row.position != null ? Math.round(row.position * 10) / 10 : 0,
  }));
}

function computeComparison(currentRows, previousRows, threshold) {
  const currentMap = new Map();
  const previousMap = new Map();

  for (const row of currentRows) {
    const key = `${row.query}|||${row.page}`;
    currentMap.set(key, row);
  }
  for (const row of previousRows) {
    const key = `${row.query}|||${row.page}`;
    previousMap.set(key, row);
  }

  const allKeys = new Set([...currentMap.keys(), ...previousMap.keys()]);
  const results = [];

  for (const key of allKeys) {
    const curr = currentMap.get(key);
    const prev = previousMap.get(key);
    const [query, page] = key.split('|||');

    const currPos = curr ? curr.position : null;
    const prevPos = prev ? prev.position : null;
    const posChange = (currPos != null && prevPos != null) ? Math.round((prevPos - currPos) * 10) / 10 : null;

    const currImp = curr ? curr.impressions : 0;
    const prevImp = prev ? prev.impressions : 0;
    const impChangePct = prevImp > 0
      ? Math.round(((currImp - prevImp) / prevImp) * 1000) / 10
      : (currImp > 0 ? 100 : 0);

    const currClicks = curr ? curr.clicks : 0;
    const prevClicks = prev ? prev.clicks : 0;
    const clicksChangePct = prevClicks > 0
      ? Math.round(((currClicks - prevClicks) / prevClicks) * 1000) / 10
      : (currClicks > 0 ? 100 : 0);

    // Determine trend
    let trend;
    if (!prev) {
      trend = 'new';
    } else if (!curr) {
      trend = 'lost';
    } else if (posChange != null && posChange >= threshold) {
      trend = 'improving';  // position went down = improvement, posChange > 0 means prev was higher number
    } else if (posChange != null && posChange <= -threshold) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    results.push({
      keyword: query,
      page,
      current_position: currPos,
      previous_position: prevPos,
      position_change: posChange,
      current_impressions: currImp,
      previous_impressions: prevImp,
      impressions_change_pct: impChangePct,
      current_clicks: currClicks,
      previous_clicks: prevClicks,
      clicks_change_pct: clicksChangePct,
      current_ctr: curr ? curr.ctr : null,
      previous_ctr: prev ? prev.ctr : null,
      trend,
    });
  }

  return results;
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  try {
    const threshold = numberArg(args, 'threshold', 2);
    const currentDays = numberArg(args, 'current-days', 7);
    const previousDays = numberArg(args, 'previous-days', 7);

    let currentRows, previousRows;
    let currentStart, currentEnd, previousStart, previousEnd;

    if (boolArg(args, 'sample')) {
      // â”€â”€ Sample mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const sample = getSampleData();
      currentRows = sample.current;
      previousRows = sample.previous;
      currentStart = sample.current_start;
      currentEnd = sample.current_end;
      previousStart = sample.previous_start;
      previousEnd = sample.previous_end;

    } else if (boolArg(args, 'live')) {
      // â”€â”€ Live API mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const config = loadToolEnv({ cwd: args.cwd });
      currentEnd = args['current-end'] || daysAgo(0);
      currentStart = args['current-start'] || daysAgo(currentDays);
      previousEnd = args['previous-end'] || daysAgo(currentDays);
      previousStart = args['previous-start'] || daysAgo(currentDays + previousDays);

      currentRows = await fetchFromApi(config, currentStart, currentEnd);
      previousRows = await fetchFromApi(config, previousStart, previousEnd);

    } else {
      // â”€â”€ From DB mode (default) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (!args.db && !process.env.CLIENT_DB_PATH && !process.env.SEO_AGENT_DB) {
        throw new Error('--db <path> is required for --from-db mode, or use --live or --sample');
      }
      const db = openStateDb(resolveDbPath(args));

      currentEnd = args['current-end'] || daysAgo(0);
      currentStart = args['current-start'] || daysAgo(currentDays);
      previousEnd = args['previous-end'] || daysAgo(currentDays);
      previousStart = args['previous-start'] || daysAgo(currentDays + previousDays);

      currentRows = fetchFromDb(db, currentStart, currentEnd);
      previousRows = fetchFromDb(db, previousStart, previousEnd);
      db.close();
    }

    // â”€â”€ Compare â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let results = computeComparison(currentRows, previousRows, threshold);

    // â”€â”€ Apply filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const minImpressions = numberArg(args, 'min-impressions', 0);
    if (minImpressions > 0) {
      results = results.filter(r =>
        r.current_impressions >= minImpressions || r.previous_impressions >= minImpressions
      );
    }

    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      results = results.filter(r => r.keyword.toLowerCase().includes(kw));
    }

    if (boolArg(args, 'only-changes')) {
      results = results.filter(r => r.trend !== 'stable');
    }

    // â”€â”€ Sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const VALID_SORT_FIELDS = new Set([
      'keyword', 'page', 'current_position', 'previous_position', 'position_change',
      'current_impressions', 'previous_impressions', 'impressions_change_pct',
      'current_clicks', 'previous_clicks', 'clicks_change_pct',
      'current_ctr', 'previous_ctr', 'trend',
    ]);
    const sortField = VALID_SORT_FIELDS.has(args.sort) ? args.sort : 'position_change';
    results.sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return Math.abs(vb) - Math.abs(va);
      return String(vb).localeCompare(String(va));
    });

    // â”€â”€ Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const output = envelope({
      current_period: { start: currentStart, end: currentEnd },
      previous_period: { start: previousStart, end: previousEnd },
      threshold,
      total_keywords: results.length,
      improving: results.filter(r => r.trend === 'improving').length,
      declining: results.filter(r => r.trend === 'declining').length,
      stable: results.filter(r => r.trend === 'stable').length,
      new_keywords: results.filter(r => r.trend === 'new').length,
      lost_keywords: results.filter(r => r.trend === 'lost').length,
      rows: results,
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
