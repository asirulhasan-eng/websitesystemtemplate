#!/usr/bin/env node
/**
 * task-search.js â€” Full-text search across tasks in the {{SITE_NAME}} SQLite state DB.
 *
 * Searches title, description, target_keyword, target_url, and metadata_json.
 * Results are ranked by number of field matches and priority score.
 *
 * Usage:
 *   node task-search.js --query "drain cleaning" [options]
 */

const { parseArgs, requireArg, numberArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
task-search â€” Full-text search across tasks in the SQLite state database.

USAGE
  node task-search.js --query "drain cleaning" [options]

REQUIRED
  --query <text>            Search query (searches across multiple fields)

FILTERS
  --status <list>           Comma-separated status filter
  --risk-level <level>      Filter by risk level
  --type <type>             Filter by task_type in metadata

OPTIONS
  --limit <n>               Max results (default: 25)
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without a database

SEARCH FIELDS
  The query is matched (case-insensitive) against:
    â€¢ title
    â€¢ description
    â€¢ target_keyword
    â€¢ target_url
    â€¢ metadata_json (including evidence, notes, tags)

  Results are ranked by:
    1. Number of fields matching the query (more matches = higher rank)
    2. Priority score (descending)

EXAMPLES
  node task-search.js --query "schema markup"
  node task-search.js --query "{{AUDIENCE}}" --status candidate,approved --table
  node task-search.js --query "drain" --limit 10
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
      query: 'drain cleaning',
      results: [
        {
          task_id: 'TSK-2026-06-03-A1B2C3D4',
          title: 'Refresh drain cleaning service page',
          status: 'candidate',
          priority_score: 600,
          target_url: 'https://client.com/drain-cleaning',
          target_keyword: 'drain cleaning service',
          match_score: 3,
          matched_fields: ['title', 'target_url', 'target_keyword'],
        },
        {
          task_id: 'TSK-2026-06-02-E5F6G7H8',
          title: 'Add FAQ schema to drain pages',
          status: 'approved',
          priority_score: 400,
          target_url: 'https://client.com/drain-cleaning',
          target_keyword: 'drain cleaning near me',
          match_score: 2,
          matched_fields: ['title', 'target_keyword'],
        },
      ],
      total: 2,
    };
    printOutput(envelope(sample, { tool: 'task-search' }), getOutputFormat(args));
    return;
  }

  try {
    const query = requireArg(args, 'query', 'Missing required argument: --query');
    const limit = numberArg(args, 'limit', 25);

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    // â”€â”€ Build search SQL â”€â”€
    // We use LIKE for substring matching across multiple fields and compute a match score.
    const searchFields = ['title', 'description', 'target_keyword', 'target_url', 'metadata_json'];
    const pattern = `%${query}%`;

    const matchExpressions = searchFields.map(f =>
      `(CASE WHEN ${f} LIKE ? THEN 1 ELSE 0 END)`
    );
    const matchScoreExpr = matchExpressions.join(' + ');

    // At least one field must match
    const orClauses = searchFields.map(f => `${f} LIKE ?`).join(' OR ');

    const whereConditions = [`(${orClauses})`];
    const whereParams = [...searchFields.map(() => pattern)]; // 5 params for OR clause

    // Optional status filter
    const statuses = listArg(args, 'status');
    if (statuses.length > 0) {
      whereConditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      whereParams.push(...statuses);
    }

    // Optional risk-level filter
    if (args['risk-level']) {
      whereConditions.push('risk_level = ?');
      whereParams.push(args['risk-level']);
    }

    // Optional type filter
    if (args.type) {
      whereConditions.push(`json_extract(metadata_json, '$.task_type') = ?`);
      whereParams.push(args.type);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const sql = `
      SELECT *,
        ${matchScoreExpr} AS match_score
      FROM tasks
      ${whereClause}
      ORDER BY match_score DESC, priority_score DESC
      LIMIT ?
    `;

    // Params order: 5 for SELECT CASE expressions, then whereParams, then LIMIT
    const allParams = [
      ...searchFields.map(() => pattern), // 5 params for match score in SELECT
      ...whereParams,                     // 5+ params for WHERE clause
      limit,                              // 1 param for LIMIT
    ];
    const rows = db.prepare(sql).all(...allParams);

    // Determine which fields matched for each result
    const results = rows.map(row => {
      const matchedFields = searchFields.filter(f => {
        const val = row[f];
        return val && String(val).toLowerCase().includes(query.toLowerCase());
      });
      return {
        task_id: row.task_id,
        title: row.title,
        description: row.description,
        status: row.status,
        risk_level: row.risk_level,
        priority_score: row.priority_score,
        source: row.source,
        target_url: row.target_url,
        target_keyword: row.target_keyword,
        created_at: row.created_at,
        updated_at: row.updated_at,
        match_score: row.match_score,
        matched_fields: matchedFields,
      };
    });

    db.close();

    const result = {
      query,
      results,
      total: results.length,
    };

    printOutput(envelope(result, { tool: 'task-search' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'task-search' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
