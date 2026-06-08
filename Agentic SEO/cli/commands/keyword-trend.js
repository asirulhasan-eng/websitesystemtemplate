/**
 * keyword-trend.js â€” Keyword position trends over time
 *
 * Queries GSC snapshots and SERP checks to show position history for a keyword.
 * Supports ASCII sparklines in table mode, competitor data, and multiple output formats.
 *
 * Usage:
 *   v2 keyword trend --keyword "{{AUDIENCE}} near me" --db state.db --table
 *   v2 keyword trend --keyword "drain cleaning" --days 60 --source gsc --json
 *   v2 keyword trend --keyword "{{NICHE}} seo" --with-competitors --sparkline --table
 *
 * Options:
 *   --keyword         Required. The keyword to analyze
 *   --days            Look-back period in days (default: 30)
 *   --source          Data source: gsc, serp, both (default: both)
 *   --with-competitors Include competitor positions from SERP data
 *   --sparkline       Show ASCII sparkline in table mode
 *   --db              SQLite database path
 *   --json            JSON output (default)
 *   --table           Table output
 *   --csv             CSV output
 *   --sample          Return sample data without DB interaction
 *   --help            Show this help text
 */

const { parseArgs, requireArg, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso, daysAgo } = require('../lib/dates');

const TOOL = 'keyword-trend';

const HELP = `
keyword-trend â€” Keyword position trends over time

USAGE
  v2 keyword trend --keyword <keyword> --db <path> [options]

REQUIRED
  --keyword         The keyword to analyze trends for

OPTIONS
  --days            Look-back period in days (default: 30)
  --source          Data source: gsc | serp | both (default: both)
  --with-competitors Include competitor positions from SERP check data
  --sparkline       Show ASCII sparkline of position history in table mode
  --db              SQLite database path (or CLIENT_DB_PATH env var)
  --json            JSON output (default)
  --table           Table output
  --csv             CSV output
  --sample          Return sample data without DB interaction
  --help            Show this help text

EXAMPLES
  v2 keyword trend --keyword "{{AUDIENCE}} near me" --db state.db --table --sparkline
  v2 keyword trend --keyword "drain cleaning" --days 60 --source gsc --json
  v2 keyword trend --keyword "{{NICHE}} seo" --with-competitors --table
  v2 keyword trend --keyword "emergency {{AUDIENCE}}" --source serp --csv

OUTPUT
  Each row includes: date, source, position, clicks (GSC), impressions (GSC),
  ctr (GSC), url, domain. With --with-competitors, includes competitor entries.

SPARKLINE
  When --sparkline is used with --table, an ASCII sparkline column shows
  the position trend using characters: â–â–‚â–ƒâ–„â–…â–†â–‡â–ˆ (lower = better position).
`.trim();

/**
 * Generate an ASCII sparkline for a series of position values.
 * Lower positions are better in SEO, so we invert the scale.
 */
function sparkline(values) {
  if (!values || values.length === 0) return '';
  const chars = 'â–â–‚â–ƒâ–„â–…â–†â–‡â–ˆ';
  const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (validValues.length === 0) return '';

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const range = max - min || 1;

  return values.map(v => {
    if (v === null || v === undefined || isNaN(v)) return ' ';
    // Invert: lower position = taller bar (better ranking)
    const normalized = 1 - (v - min) / range;
    const idx = Math.min(chars.length - 1, Math.floor(normalized * (chars.length - 1)));
    return chars[idx];
  }).join('');
}

module.exports = function keywordTrend() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const showSparkline = boolArg(args, 'sparkline');
    const samplePositions = [12, 10, 11, 8, 7, 9, 6, 5, 5, 4, 4, 3, 3, 3, 2];
    const sampleRows = samplePositions.map((pos, i) => ({
      date: daysAgo(samplePositions.length - 1 - i),
      source: 'gsc',
      position: pos,
      clicks: Math.floor(Math.random() * 20) + 5,
      impressions: Math.floor(Math.random() * 200) + 100,
      ctr: Math.round((Math.random() * 0.05 + 0.02) * 10000) / 100,
      url: 'https://{{DOMAIN}}/services/{{NICHE}}',
      domain: '{{DOMAIN}}',
    }));

    const result = {
      keyword: '{{AUDIENCE}} near me',
      days: 30,
      source: 'both',
      data_points: sampleRows.length,
      current_position: samplePositions[samplePositions.length - 1],
      best_position: Math.min(...samplePositions),
      worst_position: Math.max(...samplePositions),
      position_delta: samplePositions[0] - samplePositions[samplePositions.length - 1],
      trend_direction: 'improving',
      rows: sampleRows,
    };

    if (showSparkline) {
      result.sparkline = sparkline(samplePositions);
    }

    printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const keyword = requireArg(args, 'keyword', 'Missing --keyword');
    const days = numberArg(args, 'days', 30);
    const source = (args.source || 'both').toLowerCase();
    const withCompetitors = boolArg(args, 'with-competitors');
    const showSparkline = boolArg(args, 'sparkline');

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    try {
      const sinceDate = daysAgo(days);

      const allRows = [];

      // --- GSC Data ---
      if (source === 'gsc' || source === 'both') {
        const gscRows = db.prepare(`
          SELECT
            date_range_start as date,
            'gsc' as source,
            position,
            clicks,
            impressions,
            ctr,
            page as url,
            NULL as domain
          FROM gsc_snapshots
          WHERE query = ? AND captured_at >= ?
          ORDER BY date_range_start ASC
        `).all(keyword, `${sinceDate}T00:00:00.000Z`);

        allRows.push(...gscRows);
      }

      // --- SERP Data ---
      if (source === 'serp' || source === 'both') {
        const serpQuery = withCompetitors
          ? `SELECT
               checked_at as date,
               'serp' as source,
               position,
               NULL as clicks,
               NULL as impressions,
               NULL as ctr,
               url,
               domain
             FROM serp_checks
             WHERE keyword = ? AND created_at >= ?
             ORDER BY checked_at ASC`
          : `SELECT
               checked_at as date,
               'serp' as source,
               position,
               NULL as clicks,
               NULL as impressions,
               NULL as ctr,
               url,
               domain
             FROM serp_checks
             WHERE keyword = ? AND created_at >= ?
               AND (domain LIKE '%client%' OR domain IS NULL)
             ORDER BY checked_at ASC`;

        const serpRows = db.prepare(serpQuery).all(keyword, `${sinceDate}T00:00:00.000Z`);
        allRows.push(...serpRows);
      }

      // Sort by date
      allRows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      // Compute trend statistics
      const positions = allRows
        .filter(r => r.position !== null && r.position !== undefined)
        .map(r => r.position);

      const currentPos = positions.length > 0 ? positions[positions.length - 1] : null;
      const bestPos = positions.length > 0 ? Math.min(...positions) : null;
      const worstPos = positions.length > 0 ? Math.max(...positions) : null;
      const firstPos = positions.length > 0 ? positions[0] : null;
      const delta = firstPos !== null && currentPos !== null ? firstPos - currentPos : null;
      const trendDirection = delta === null ? 'unknown'
        : delta > 0 ? 'improving'
        : delta < 0 ? 'declining'
        : 'stable';

      const result = {
        keyword,
        days,
        source,
        data_points: allRows.length,
        current_position: currentPos,
        best_position: bestPos,
        worst_position: worstPos,
        position_delta: delta,
        trend_direction: trendDirection,
        rows: allRows,
      };

      if (showSparkline) {
        result.sparkline = sparkline(positions);
      }

      // Check keyword table for additional info
      const kwRow = db.prepare('SELECT * FROM keywords WHERE keyword = ?').get(keyword);
      if (kwRow) {
        result.keyword_info = {
          cluster: kwRow.cluster,
          priority: kwRow.priority,
          target_url: kwRow.target_url,
          best_position_recorded: kwRow.best_position,
        };
      }

      const fmt = getOutputFormat(args);
      if (fmt === 'json') {
        printOutput(envelope(result, { tool: TOOL }), fmt);
      } else if (fmt === 'csv') {
        printOutput(allRows, fmt);
      } else {
        // Table mode â€” show summary + data
        console.log(`\nKeyword: ${keyword}`);
        console.log(`Period: last ${days} days (since ${sinceDate})`);
        console.log(`Source: ${source} | Data points: ${allRows.length}`);
        console.log(`Position: current=${currentPos ?? 'N/A'} best=${bestPos ?? 'N/A'} worst=${worstPos ?? 'N/A'} delta=${delta !== null ? (delta > 0 ? '+' : '') + delta : 'N/A'} (${trendDirection})`);
        if (showSparkline && positions.length > 0) {
          console.log(`Sparkline: ${sparkline(positions)}`);
        }
        console.log('');
        printOutput(allRows, fmt);
      }
    } finally {
      db.close();
    }

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}