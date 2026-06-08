#!/usr/bin/env node
/**
 * gsc-fetch.js â€” Fetch Google Search Console data from the live API
 *
 * Pulls Search Analytics data, normalizes rows, applies filters,
 * optionally persists to gsc_snapshots table, and outputs results.
 *
 * Usage:
 *   node gsc-fetch.js [options]
 *
 * See --help for full option list.
 */

const fs = require('node:fs');
const { parseArgs, numberArg, boolArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { loadToolEnv } = require('../lib/env');
const { querySearchAnalytics } = require('../lib/gsc');
const { nowIso, daysAgo } = require('../lib/dates');
const { readJson } = require('../lib/io');

const TOOL = 'gsc-fetch';

const HELP = `
gsc-fetch â€” Fetch Google Search Console Search Analytics data

USAGE
  node gsc-fetch.js [options]

DATA SOURCE
  (default)           Fetch from GSC API (requires OAuth credentials)
  --from-file <path>  Read a previous JSON output file instead of calling API
  --sample            Use built-in sample data (no API key needed)

DATE RANGE
  --days <N>          Number of days back from today (default: 7)
  --start-date <YYYY-MM-DD>  Explicit start date (overrides --days)
  --end-date <YYYY-MM-DD>    Explicit end date (default: today)

API OPTIONS
  --data-state <final|all>   GSC data freshness (default: final)
  --dimensions <list>        Comma-separated dimensions (default: query,page)

FILTERS
  --min-impressions <N>      Minimum impressions to include (default: 3)
  --max-position <N>         Maximum average position (default: 50)
  --min-clicks <N>           Minimum clicks to include (default: 0)
  --query-contains <text>    Include only queries containing text
  --query-regex <pattern>    Include only queries matching regex
  --url-contains <text>      Include only pages containing text
  --exclude-query <text>     Exclude queries containing text

SORTING & LIMITS
  --sort <field>             Sort by field (default: impressions)
  --limit <N>                Max rows to return
  --top <N>                  Shorthand for --sort impressions --limit N
  --group-by <field>         Group results by field (query|page)

PERSISTENCE
  --db <path>                SQLite database path (enables persistence)
  --no-persist               Fetch data but skip saving to database
  --snapshot-tag <tag>       Tag to attach to snapshot metadata

OUTPUT
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output

EXAMPLES
  node gsc-fetch.js --sample --table
  node gsc-fetch.js --days 30 --min-impressions 10 --db ./seo.db
  node gsc-fetch.js --top 20 --query-contains {{NICHE}} --csv
  node gsc-fetch.js --from-file ./gsc-2026-05-27.json --sort clicks
  node gsc-fetch.js --start-date 2026-05-01 --end-date 2026-05-31
`.trim();

function getSampleData() {
  const endDate = daysAgo(0);
  const startDate = daysAgo(7);
  return {
    siteUrl: 'sc-domain:{{DOMAIN}}',
    date_range_start: startDate,
    date_range_end: endDate,
    rows: [
      { query: '{{NICHE}} seo', page: 'https://{{DOMAIN}}/', clicks: 42, impressions: 890, ctr: 0.0472, position: 4.2 },
      { query: 'seo for {{AUDIENCE}}', page: 'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}', clicks: 38, impressions: 720, ctr: 0.0528, position: 5.1 },
      { query: '{{AUDIENCE}} website design', page: 'https://{{DOMAIN}}/web-design', clicks: 22, impressions: 540, ctr: 0.0407, position: 7.3 },
      { query: 'local seo {{NICHE}}', page: 'https://{{DOMAIN}}/local-seo', clicks: 18, impressions: 410, ctr: 0.0439, position: 8.6 },
      { query: '{{NICHE}} google ads', page: 'https://{{DOMAIN}}/google-ads', clicks: 15, impressions: 380, ctr: 0.0395, position: 9.2 },
      { query: '{{AUDIENCE}} marketing', page: 'https://{{DOMAIN}}/marketing', clicks: 12, impressions: 310, ctr: 0.0387, position: 11.4 },
      { query: '{{NICHE}} company seo services', page: 'https://{{DOMAIN}}/services', clicks: 8, impressions: 185, ctr: 0.0432, position: 14.7 },
      { query: 'how to get {{NICHE}} leads online', page: 'https://{{DOMAIN}}/blog/{{NICHE}}-leads', clicks: 5, impressions: 95, ctr: 0.0526, position: 18.3 },
    ],
  };
}

function normalizeRows(apiRows, dimensions) {
  return apiRows.map(row => {
    const normalized = {
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr != null ? Math.round(row.ctr * 10000) / 10000 : 0,
      position: row.position != null ? Math.round(row.position * 10) / 10 : 0,
    };
    // Extract keys from GSC API response format
    if (row.keys && Array.isArray(row.keys)) {
      for (let i = 0; i < dimensions.length; i++) {
        normalized[dimensions[i]] = row.keys[i] || '';
      }
    }
    // If already normalized (from file or sample), copy query/page directly
    if (row.query !== undefined) normalized.query = row.query;
    if (row.page !== undefined) normalized.page = row.page;
    if (row.date !== undefined) normalized.date = row.date;
    if (row.device !== undefined) normalized.device = row.device;
    if (row.country !== undefined) normalized.country = row.country;
    return normalized;
  });
}

function applyFilters(rows, args) {
  const minImpressions = numberArg(args, 'min-impressions', 3);
  const maxPosition = numberArg(args, 'max-position', 50);
  const minClicks = numberArg(args, 'min-clicks', 0);
  const queryContains = args['query-contains'];
  const queryRegex = args['query-regex'];
  const urlContains = args['url-contains'];
  const excludeQuery = args['exclude-query'];

  return rows.filter(row => {
    if (row.impressions < minImpressions) return false;
    if (row.position > maxPosition) return false;
    if (row.clicks < minClicks) return false;
    if (queryContains && row.query && !row.query.toLowerCase().includes(queryContains.toLowerCase())) return false;
    if (queryRegex && row.query) {
      try { if (!new RegExp(queryRegex, 'i').test(row.query)) return false; } catch { /* skip invalid regex */ }
    }
    if (urlContains && row.page && !row.page.toLowerCase().includes(urlContains.toLowerCase())) return false;
    if (excludeQuery && row.query && row.query.toLowerCase().includes(excludeQuery.toLowerCase())) return false;
    return true;
  });
}

function groupRows(rows, groupBy) {
  const groups = {};
  for (const row of rows) {
    const key = row[groupBy] || 'unknown';
    if (!groups[key]) {
      groups[key] = { [groupBy]: key, clicks: 0, impressions: 0, ctr_sum: 0, position_sum: 0, count: 0 };
    }
    groups[key].clicks += row.clicks;
    groups[key].impressions += row.impressions;
    groups[key].ctr_sum += row.ctr;
    groups[key].position_sum += row.position;
    groups[key].count += 1;
  }
  return Object.values(groups).map(g => ({
    [groupBy]: g[groupBy],
    clicks: g.clicks,
    impressions: g.impressions,
    ctr: Math.round((g.ctr_sum / g.count) * 10000) / 10000,
    position: Math.round((g.position_sum / g.count) * 10) / 10,
    query_count: g.count,
  }));
}

function sortRows(rows, sortField, descending = true) {
  const numericFields = ['clicks', 'impressions', 'ctr', 'position', 'query_count'];
  const isNumeric = numericFields.includes(sortField);
  return rows.sort((a, b) => {
    const va = a[sortField];
    const vb = b[sortField];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    // Position: lower is better, so ascending when "descending" intent
    if (sortField === 'position') return descending ? va - vb : vb - va;
    if (isNumeric) return descending ? vb - va : va - vb;
    return descending ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
  });
}

function persistToDb(dbPath, rows, dateRangeStart, dateRangeEnd, tag) {
  const db = openStateDb(dbPath);
  const now = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO gsc_snapshots (
      snapshot_id, query, page, clicks, impressions, ctr, position,
      date_range_start, date_range_end, captured_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const row of rows) {
      const meta = {};
      if (tag) meta.tag = tag;
      if (row.device) meta.device = row.device;
      if (row.country) meta.country = row.country;

      insert.run(
        makeId('GSC'),
        row.query || null,
        row.page || null,
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
        dateRangeStart,
        dateRangeEnd,
        now,
        JSON.stringify(meta)
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.close();
  return inserted;
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  try {
    const dimensions = listArg(args, 'dimensions', ['query', 'page']);
    let rawRows, dateRangeStart, dateRangeEnd;

    // â”€â”€ Data source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (boolArg(args, 'sample')) {
      const sample = getSampleData();
      rawRows = sample.rows;
      dateRangeStart = sample.date_range_start;
      dateRangeEnd = sample.date_range_end;

    } else if (args['from-file']) {
      const fileData = readJson(args['from-file']);
      if (!fileData) throw new Error(`Cannot read file: ${args['from-file']}`);
      // Support both envelope format and raw array
      const source = fileData.rows || fileData.results || (Array.isArray(fileData) ? fileData : null);
      if (!source) throw new Error('File does not contain rows or results array');
      rawRows = source;
      dateRangeStart = fileData.date_range_start || fileData.startDate || 'unknown';
      dateRangeEnd = fileData.date_range_end || fileData.endDate || 'unknown';

    } else {
      // Live API fetch
      const config = loadToolEnv({ cwd: args.cwd });
      const days = numberArg(args, 'days', 7);
      dateRangeStart = args['start-date'] || daysAgo(days);
      dateRangeEnd = args['end-date'] || daysAgo(0);

      const result = await querySearchAnalytics(config, {
        startDate: dateRangeStart,
        endDate: dateRangeEnd,
        dimensions,
        dataState: args['data-state'] || 'final',
        rowLimit: 25000,
      });

      rawRows = result.rows;
    }

    // â”€â”€ Normalize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let rows = normalizeRows(rawRows, dimensions);

    // â”€â”€ Filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    rows = applyFilters(rows, args);

    // â”€â”€ Group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const groupBy = args['group-by'];
    if (groupBy) {
      rows = groupRows(rows, groupBy);
    }

    // â”€â”€ Sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let sortField = args.sort || 'impressions';
    let limit = args.limit ? numberArg(args, 'limit') : null;

    // --top is shorthand for --sort impressions --limit N
    if (args.top) {
      sortField = 'impressions';
      limit = numberArg(args, 'top');
    }

    rows = sortRows(rows, sortField);
    if (limit) rows = rows.slice(0, limit);

    // â”€â”€ Persist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let persisted = 0;
    const shouldPersist = args.db && !boolArg(args, 'no-persist');
    if (shouldPersist) {
      persisted = persistToDb(
        resolveDbPath(args),
        rows,
        dateRangeStart,
        dateRangeEnd,
        args['snapshot-tag'] || null
      );
    }

    // â”€â”€ Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const output = envelope({
      date_range_start: dateRangeStart,
      date_range_end: dateRangeEnd,
      total_rows: rows.length,
      persisted,
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
