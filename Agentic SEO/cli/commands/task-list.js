#!/usr/bin/env node
/**
 * task-list.js â€” Query tasks from the {{SITE_NAME}} SQLite state DB.
 *
 * Builds dynamic SQL with flexible filtering, sorting, and pagination.
 * Supports JSON, table, and CSV output formats.
 *
 * Usage:
 *   node task-list.js [options]
 */

const { parseArgs, numberArg, boolArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
task-list â€” Query and filter tasks from the SQLite state database.

USAGE
  node task-list.js [options]

FILTERS
  --status <list>           Comma-separated status filter
                            (e.g. candidate,approved,queued)
  --type <type>             Filter by task_type in metadata_json
  --risk-level <level>      Filter by risk_level (safe|semi_safe|high_risk)
  --priority-min <n>        Minimum priority_score (inclusive)
  --priority-max <n>        Maximum priority_score (inclusive)
  --keyword <text>          Substring match on target_keyword (case-insensitive)
  --url <text>              Substring match on target_url (case-insensitive)
  --source <source>         Filter by source field
  --created-after <date>    Tasks created after this ISO date
  --created-before <date>   Tasks created before this ISO date
  --updated-after <date>    Tasks updated after this ISO date
  --stale-days <n>          Tasks not updated in the last N days
  --has-tag <tag>           Filter tasks whose metadata_json contains this tag

SORTING & PAGINATION
  --sort <field>            Sort by: priority | created | updated | status
                            (default: priority)
  --asc                     Sort ascending instead of descending
  --limit <n>               Max results (default: 50)
  --offset <n>              Skip first N results (default: 0)

OUTPUT
  --fields <list>           Comma-separated list of fields to include
  --count-only              Only return the count of matching tasks
  --json                    Output as JSON (default)
  --table                   Output as table
  --csv                     Output as CSV
  --db <path>               SQLite database path
  --sample                  Show sample output without a database

EXAMPLES
  node task-list.js --status candidate,approved --sort priority
  node task-list.js --keyword "drain" --priority-min 300 --table
  node task-list.js --stale-days 7 --status in_progress --csv
  node task-list.js --count-only --status completed
  node task-list.js --has-tag "quick-win" --limit 10
`.trim();

const SORT_MAP = {
  priority: 'priority_score',
  created: 'created_at',
  updated: 'updated_at',
  status: 'status',
};

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
          task_id: 'TSK-2026-06-03-A1B2C3D4',
          title: 'Add schema markup to /{{AUDIENCE}}',
          status: 'candidate',
          risk_level: 'safe',
          priority_score: 500,
          source: 'gsc_analysis',
          target_url: 'https://client.com/{{AUDIENCE}}',
          target_keyword: '{{AUDIENCE}} near me',
          created_at: '2026-06-01T10:00:00.000Z',
          updated_at: '2026-06-02T14:30:00.000Z',
        },
        {
          task_id: 'TSK-2026-06-02-E5F6G7H8',
          title: 'Fix meta description on /drain-cleaning',
          status: 'approved',
          risk_level: 'semi_safe',
          priority_score: 350,
          source: 'crawler',
          target_url: 'https://client.com/drain-cleaning',
          target_keyword: 'drain cleaning service',
          created_at: '2026-06-01T08:00:00.000Z',
          updated_at: '2026-06-01T08:00:00.000Z',
        },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    };
    printOutput(envelope(sample, { tool: 'task-list' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    const conditions = [];
    const params = [];

    // â”€â”€ Status filter â”€â”€
    const statuses = listArg(args, 'status');
    if (statuses.length > 0) {
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

    // â”€â”€ Type filter (stored in metadata_json) â”€â”€
    if (args.type) {
      conditions.push(`json_extract(metadata_json, '$.task_type') = ?`);
      params.push(args.type);
    }

    // â”€â”€ Risk level â”€â”€
    if (args['risk-level']) {
      conditions.push('risk_level = ?');
      params.push(args['risk-level']);
    }

    // â”€â”€ Priority range â”€â”€
    if (args['priority-min'] !== undefined) {
      conditions.push('priority_score >= ?');
      params.push(Number(args['priority-min']));
    }
    if (args['priority-max'] !== undefined) {
      conditions.push('priority_score <= ?');
      params.push(Number(args['priority-max']));
    }

    // â”€â”€ Keyword substring â”€â”€
    if (args.keyword) {
      conditions.push('target_keyword LIKE ?');
      params.push(`%${args.keyword}%`);
    }

    // â”€â”€ URL substring â”€â”€
    if (args.url) {
      conditions.push('target_url LIKE ?');
      params.push(`%${args.url}%`);
    }

    // â”€â”€ Source â”€â”€
    if (args.source) {
      conditions.push('source = ?');
      params.push(args.source);
    }

    // â”€â”€ Date filters â”€â”€
    if (args['created-after']) {
      conditions.push('created_at >= ?');
      params.push(args['created-after']);
    }
    if (args['created-before']) {
      conditions.push('created_at <= ?');
      params.push(args['created-before']);
    }
    if (args['updated-after']) {
      conditions.push('updated_at >= ?');
      params.push(args['updated-after']);
    }

    // â”€â”€ Stale days â”€â”€
    if (args['stale-days']) {
      const staleDays = Number(args['stale-days']);
      const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
      conditions.push('updated_at < ?');
      params.push(cutoff);
    }

    // â”€â”€ Tag filter â”€â”€
    if (args['has-tag']) {
      conditions.push(`json_extract(metadata_json, '$.tags') LIKE ?`);
      params.push(`%${args['has-tag']}%`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // â”€â”€ Count-only mode â”€â”€
    if (boolArg(args, 'count-only')) {
      const countSql = `SELECT COUNT(*) as total FROM tasks ${whereClause}`;
      const row = db.prepare(countSql).get(...params);
      db.close();
      printOutput(envelope({ total: row.total }, { tool: 'task-list' }), getOutputFormat(args));
      return;
    }

    // â”€â”€ Sort â”€â”€
    const sortKey = SORT_MAP[args.sort] || 'priority_score';
    const sortDir = boolArg(args, 'asc') ? 'ASC' : 'DESC';

    // â”€â”€ Pagination â”€â”€
    const limit = numberArg(args, 'limit', 50);
    const offset = numberArg(args, 'offset', 0);

    // â”€â”€ Build query â”€â”€
    // Whitelist projectable columns â€” --fields is interpolated into SELECT,
    // so unvalidated input would be a SQL injection vector.
    const ALLOWED_FIELDS = new Set([
      'task_id', 'title', 'description', 'status', 'risk_level', 'priority_score',
      'source', 'target_url', 'target_file', 'target_keyword', 'approval_required',
      'created_at', 'updated_at', 'completed_at', 'metadata_json',
    ]);
    const requestedFields = listArg(args, 'fields');
    const invalidFields = requestedFields.filter((f) => !ALLOWED_FIELDS.has(f));
    if (invalidFields.length > 0) {
      throw new Error(`Invalid --fields: ${invalidFields.join(', ')}. Allowed: ${[...ALLOWED_FIELDS].join(', ')}`);
    }
    const selectClause = requestedFields.length > 0
      ? requestedFields.join(', ')
      : '*';

    const sql = `SELECT ${selectClause} FROM tasks ${whereClause} ORDER BY ${sortKey} ${sortDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const tasks = db.prepare(sql).all(...params);

    // Get total count for pagination info
    const countParams = params.slice(0, -2); // Remove limit/offset
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM tasks ${whereClause}`).get(...countParams);

    db.close();

    const result = {
      results: tasks,
      total: countRow.total,
      limit,
      offset,
      has_more: offset + tasks.length < countRow.total,
    };

    printOutput(envelope(result, { tool: 'task-list' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'task-list' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
