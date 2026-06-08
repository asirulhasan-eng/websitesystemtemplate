#!/usr/bin/env node
/**
 * db-query.js â€” Run arbitrary SQL queries against the {{SITE_NAME}} SQLite state DB.
 *
 * Supports SELECT by default, and write queries with --allow-write.
 * Can read SQL from a file, bind parameters, and show EXPLAIN QUERY PLAN.
 *
 * Usage:
 *   node db-query.js --sql "SELECT * FROM tasks LIMIT 5"
 */

const fs = require('node:fs');
const { parseArgs, requireArg, boolArg, jsonArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
db-query â€” Run arbitrary SQL queries against the SQLite state database.

USAGE
  node db-query.js --sql "SELECT * FROM tasks LIMIT 10"
  node db-query.js --file ./report-query.sql --params '[100, "candidate"]'

REQUIRED (one of)
  --sql <query>             SQL query string
  --file <path>             Read SQL from a file

OPTIONS
  --params <json>           JSON array of bind parameters
                            e.g. --params '[100, "candidate"]'
  --allow-write             Required for INSERT, UPDATE, DELETE, etc.
                            Without this flag, only SELECT is allowed.
  --explain                 Show EXPLAIN QUERY PLAN instead of results
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --csv                     Output as CSV
  --sample                  Show sample output without a database

SAFETY
  â€¢ By default, only SELECT and EXPLAIN queries are allowed.
  â€¢ Non-SELECT queries require --allow-write flag.
  â€¢ PRAGMA and ATTACH are blocked for safety.
  â€¢ Use --explain to check query plans before running expensive queries.

EXAMPLES
  node db-query.js --sql "SELECT task_id, title, status FROM tasks WHERE status = 'candidate' LIMIT 10"
  node db-query.js --sql "SELECT * FROM tasks WHERE priority_score > ?" --params '[500]' --table
  node db-query.js --sql "UPDATE tasks SET status = ? WHERE task_id = ?" --params '["approved","TSK-001"]' --allow-write
  node db-query.js --file ./complex-report.sql --csv
  node db-query.js --sql "SELECT * FROM tasks WHERE target_keyword LIKE ?" --params '["%{{AUDIENCE}}%"]' --explain
`.trim();

const BLOCKED_PATTERNS = [
  /^\s*PRAGMA\s/i,
  /^\s*ATTACH\s/i,
  /^\s*DETACH\s/i,
  /^\s*DROP\s+TABLE/i,
  /^\s*DROP\s+INDEX/i,
  /^\s*ALTER\s+TABLE/i,
  /^\s*CREATE\s+TABLE/i,
  /^\s*CREATE\s+INDEX/i,
];

const WRITE_PATTERNS = [
  /^\s*INSERT\s/i,
  /^\s*UPDATE\s/i,
  /^\s*DELETE\s/i,
  /^\s*REPLACE\s/i,
  /^\s*BEGIN/i,
  /^\s*COMMIT/i,
  /^\s*ROLLBACK/i,
];

function isSelectQuery(sql) {
  const trimmed = sql.trim();
  return /^\s*SELECT\s/i.test(trimmed) || /^\s*EXPLAIN\s/i.test(trimmed) || /^\s*WITH\s/i.test(trimmed);
}

function isWriteQuery(sql) {
  return WRITE_PATTERNS.some(p => p.test(sql));
}

function isBlockedQuery(sql) {
  return BLOCKED_PATTERNS.some(p => p.test(sql));
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = {
      sql: 'SELECT task_id, title, status FROM tasks LIMIT 3',
      rows: [
        { task_id: 'TSK-2026-06-03-A1B2C3D4', title: 'Add schema markup', status: 'candidate' },
        { task_id: 'TSK-2026-06-02-E5F6G7H8', title: 'Fix meta description', status: 'approved' },
        { task_id: 'TSK-2026-06-01-I9J0K1L2', title: 'Content refresh', status: 'completed' },
      ],
      row_count: 3,
      execution_time_ms: 2,
    };
    printOutput(envelope(sample, { tool: 'db-query' }), getOutputFormat(args));
    return;
  }

  try {
    // â”€â”€ Resolve SQL â”€â”€
    let sql;
    if (args.file) {
      const filePath = args.file;
      if (!fs.existsSync(filePath)) {
        throw new Error(`SQL file not found: ${filePath}`);
      }
      sql = fs.readFileSync(filePath, 'utf8').trim();
    } else {
      sql = requireArg(args, 'sql', 'Missing required argument: --sql or --file');
    }

    if (!sql) {
      throw new Error('SQL query is empty');
    }

    // â”€â”€ Safety checks â”€â”€
    if (isBlockedQuery(sql)) {
      throw new Error('Blocked: PRAGMA, ATTACH, DROP, ALTER, and CREATE statements are not allowed via db-query. Use the SQLite DB directly.');
    }

    const allowWrite = boolArg(args, 'allow-write');
    if (isWriteQuery(sql) && !allowWrite) {
      throw new Error('Write queries (INSERT/UPDATE/DELETE) require --allow-write flag');
    }

    // â”€â”€ Parse bind params â”€â”€
    const params = jsonArg(args, 'params', []);
    if (!Array.isArray(params)) {
      throw new Error('--params must be a JSON array');
    }

    // â”€â”€ Open DB â”€â”€
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    const startTime = Date.now();

    // â”€â”€ EXPLAIN mode â”€â”€
    if (boolArg(args, 'explain')) {
      const explainSql = `EXPLAIN QUERY PLAN ${sql}`;
      const plan = db.prepare(explainSql).all(...params);
      db.close();

      const result = {
        sql,
        explain_query_plan: plan,
        execution_time_ms: Date.now() - startTime,
      };
      printOutput(envelope(result, { tool: 'db-query' }), getOutputFormat(args));
      return;
    }

    // â”€â”€ Execute query â”€â”€
    let result;

    if (isSelectQuery(sql)) {
      const rows = db.prepare(sql).all(...params);
      result = {
        sql: sql.length > 200 ? sql.slice(0, 200) + '...' : sql,
        rows,
        row_count: rows.length,
        execution_time_ms: Date.now() - startTime,
      };
    } else {
      // Write query
      const info = db.prepare(sql).run(...params);
      result = {
        sql: sql.length > 200 ? sql.slice(0, 200) + '...' : sql,
        changes: info.changes,
        last_insert_rowid: Number(info.lastInsertRowid),
        execution_time_ms: Date.now() - startTime,
      };
    }

    db.close();
    printOutput(envelope(result, { tool: 'db-query' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'db-query' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
