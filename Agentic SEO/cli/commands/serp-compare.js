#!/usr/bin/env node
/**
 * serp-compare.js â€” Compare SERP positions over time
 *
 * Compares current SERP positions against historical data from serp_checks,
 * detecting position changes, URL changes, and competitor movements.
 *
 * Usage:
 *   node serp-compare.js --db <path> [options]
 *
 * See --help for full option list.
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { daysAgo } = require('../lib/dates');

const TOOL = 'serp-compare';

const HELP = `
serp-compare â€” Compare SERP positions over time

USAGE
  node serp-compare.js --db <path> [options]

REQUIRED
  --db <path>                SQLite database path

COMPARISON TARGET
  --days-ago <N>             Compare current vs N days ago (default: 7)
  --date <YYYY-MM-DD>        Compare current vs a specific date

KEYWORD FILTER
  --keyword <text>           Filter by keyword substring
  --all-tracked              Compare all tracked keywords from keywords table

OUTPUT
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output
  --sample                   Use built-in sample data (no DB needed)

OUTPUT COLUMNS
  keyword, current_position, previous_position, position_change,
  current_url, previous_url, url_changed, new_competitors, lost_competitors

EXAMPLES
  node serp-compare.js --sample --table
  node serp-compare.js --db ./seo.db --days-ago 7 --table
  node serp-compare.js --db ./seo.db --date 2026-05-15 --keyword {{NICHE}}
  node serp-compare.js --db ./seo.db --all-tracked --days-ago 30
`.trim();

function getSampleData() {
  return [
    {
      keyword: '{{NICHE}} seo',
      current_position: 4,
      previous_position: 6,
      position_change: 2,
      current_url: 'https://{{DOMAIN}}/',
      previous_url: 'https://{{DOMAIN}}/',
      url_changed: false,
      new_competitors: ['searchenginejournal.com'],
      lost_competitors: ['yelp.com'],
    },
    {
      keyword: 'seo for {{AUDIENCE}}',
      current_position: 5,
      previous_position: 4,
      position_change: -1,
      current_url: 'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}',
      previous_url: 'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}',
      url_changed: false,
      new_competitors: [],
      lost_competitors: [],
    },
    {
      keyword: '{{AUDIENCE}} website design',
      current_position: 7,
      previous_position: 12,
      position_change: 5,
      current_url: 'https://{{DOMAIN}}/web-design',
      previous_url: 'https://{{DOMAIN}}/web-design',
      url_changed: false,
      new_competitors: ['hookagency.com'],
      lost_competitors: ['thumbtack.com', 'homeadvisor.com'],
    },
    {
      keyword: '{{AUDIENCE}} lead generation',
      current_position: 15,
      previous_position: null,
      position_change: null,
      current_url: 'https://{{DOMAIN}}/leads',
      previous_url: null,
      url_changed: true,
      new_competitors: [],
      lost_competitors: [],
    },
    {
      keyword: '{{NICHE}} marketing agency',
      current_position: null,
      previous_position: 9,
      position_change: null,
      current_url: null,
      previous_url: 'https://{{DOMAIN}}/marketing',
      url_changed: true,
      new_competitors: [],
      lost_competitors: [],
    },
  ];
}

function getLatestChecks(db, keywords) {
  if (keywords.length === 0) return [];

  // Get the most recent check per keyword
  const placeholders = keywords.map(() => '?').join(',');
  // Group and join on LOWER(keyword) so rows stored with inconsistent casing
  // (e.g. "{{NICHE}} SEO" vs "{{NICHE}} seo") are treated as the same keyword.
  const sql = `
    SELECT s1.keyword, s1.position, s1.url, s1.snapshot_json, s1.checked_at
    FROM serp_checks s1
    INNER JOIN (
      SELECT LOWER(keyword) AS lk, MAX(checked_at) as max_checked
      FROM serp_checks
      WHERE LOWER(keyword) IN (${placeholders})
      GROUP BY LOWER(keyword)
    ) s2 ON LOWER(s1.keyword) = s2.lk AND s1.checked_at = s2.max_checked
  `;
  return db.prepare(sql).all(...keywords.map(k => k.toLowerCase()));
}

function getPreviousChecks(db, keywords, targetDate) {
  if (keywords.length === 0) return [];

  const placeholders = keywords.map(() => '?').join(',');

  // Find the check closest to (and on or before) the target date for each keyword
  const sql = `
    SELECT s1.keyword, s1.position, s1.url, s1.snapshot_json, s1.checked_at
    FROM serp_checks s1
    INNER JOIN (
      SELECT LOWER(keyword) AS lk, MAX(checked_at) as max_checked
      FROM serp_checks
      WHERE LOWER(keyword) IN (${placeholders})
        AND checked_at <= ?
      GROUP BY LOWER(keyword)
    ) s2 ON LOWER(s1.keyword) = s2.lk AND s1.checked_at = s2.max_checked
  `;
  return db.prepare(sql).all(...keywords.map(k => k.toLowerCase()), targetDate + 'T23:59:59.999Z');
}

function extractCompetitors(snapshotJson) {
  if (!snapshotJson) return [];
  try {
    const snapshot = JSON.parse(snapshotJson);
    return (snapshot.top_results || []).map(r => r.domain).filter(Boolean);
  } catch {
    return [];
  }
}

function buildComparison(currentChecks, previousChecks) {
  const currentMap = new Map();
  const previousMap = new Map();

  for (const c of currentChecks) currentMap.set(c.keyword.toLowerCase(), c);
  for (const p of previousChecks) previousMap.set(p.keyword.toLowerCase(), p);

  const allKeywords = new Set([...currentMap.keys(), ...previousMap.keys()]);
  const results = [];

  for (const kw of allKeywords) {
    const curr = currentMap.get(kw);
    const prev = previousMap.get(kw);

    const currPos = curr ? curr.position : null;
    const prevPos = prev ? prev.position : null;
    const posChange = (currPos != null && prevPos != null)
      ? Math.round((prevPos - currPos) * 10) / 10
      : null;

    const currUrl = curr ? curr.url : null;
    const prevUrl = prev ? prev.url : null;
    const urlChanged = currUrl !== prevUrl;

    // Extract competitors from snapshots
    const currCompetitors = curr ? extractCompetitors(curr.snapshot_json) : [];
    const prevCompetitors = prev ? extractCompetitors(prev.snapshot_json) : [];
    const currCompSet = new Set(currCompetitors);
    const prevCompSet = new Set(prevCompetitors);
    const newCompetitors = currCompetitors.filter(c => !prevCompSet.has(c));
    const lostCompetitors = prevCompetitors.filter(c => !currCompSet.has(c));

    results.push({
      keyword: (curr || prev).keyword,
      current_position: currPos,
      previous_position: prevPos,
      position_change: posChange,
      current_url: currUrl,
      previous_url: prevUrl,
      url_changed: urlChanged,
      current_checked_at: curr ? curr.checked_at : null,
      previous_checked_at: prev ? prev.checked_at : null,
      new_competitors: newCompetitors,
      lost_competitors: lostCompetitors,
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
    // â”€â”€ Sample mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (boolArg(args, 'sample')) {
      const sampleResults = getSampleData();
      const output = envelope({
        comparison_date: daysAgo(7),
        total_keywords: sampleResults.length,
        improved: sampleResults.filter(r => r.position_change != null && r.position_change > 0).length,
        declined: sampleResults.filter(r => r.position_change != null && r.position_change < 0).length,
        unchanged: sampleResults.filter(r => r.position_change === 0).length,
        new_rankings: sampleResults.filter(r => r.previous_position == null && r.current_position != null).length,
        lost_rankings: sampleResults.filter(r => r.current_position == null && r.previous_position != null).length,
        rows: sampleResults,
      }, { tool: TOOL });

      printOutput(output, getOutputFormat(args));
      return;
    }

    // â”€â”€ DB mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!args.db && !process.env.CLIENT_DB_PATH && !process.env.SEO_AGENT_DB) {
      throw new Error('--db <path> is required, or use --sample for demo data');
    }

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    // Determine keywords to compare
    let keywords = [];
    if (args.keyword) {
      // Find all matching keywords in serp_checks
      const matches = db.prepare(`
        SELECT DISTINCT keyword FROM serp_checks
        WHERE LOWER(keyword) LIKE ?
        ORDER BY keyword
      `).all(`%${args.keyword.toLowerCase()}%`);
      keywords = matches.map(r => r.keyword);
    } else if (boolArg(args, 'all-tracked')) {
      const tracked = db.prepare('SELECT keyword FROM keywords ORDER BY keyword').all();
      keywords = tracked.map(r => r.keyword);
    } else {
      // Default: all keywords that have serp checks
      const all = db.prepare('SELECT DISTINCT keyword FROM serp_checks ORDER BY keyword').all();
      keywords = all.map(r => r.keyword);
    }

    if (keywords.length === 0) {
      throw new Error('No keywords found. Use --keyword to filter, --all-tracked for tracked keywords, or ensure serp_checks has data.');
    }

    // Determine comparison date
    const daysAgoNum = numberArg(args, 'days-ago', 7);
    const comparisonDate = args.date || daysAgo(daysAgoNum);

    // Get current and previous checks
    const currentChecks = getLatestChecks(db, keywords);
    const previousChecks = getPreviousChecks(db, keywords, comparisonDate);

    db.close();

    // Build comparison
    let results = buildComparison(currentChecks, previousChecks);

    // Sort by absolute position change (biggest movers first)
    results.sort((a, b) => {
      const aChange = a.position_change != null ? Math.abs(a.position_change) : -1;
      const bChange = b.position_change != null ? Math.abs(b.position_change) : -1;
      return bChange - aChange;
    });

    // â”€â”€ Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const output = envelope({
      comparison_date: comparisonDate,
      days_ago: daysAgoNum,
      total_keywords: results.length,
      improved: results.filter(r => r.position_change != null && r.position_change > 0).length,
      declined: results.filter(r => r.position_change != null && r.position_change < 0).length,
      unchanged: results.filter(r => r.position_change === 0).length,
      new_rankings: results.filter(r => r.previous_position == null && r.current_position != null).length,
      lost_rankings: results.filter(r => r.current_position == null && r.previous_position != null).length,
      url_changes: results.filter(r => r.url_changed).length,
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
