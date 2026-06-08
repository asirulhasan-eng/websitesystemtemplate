#!/usr/bin/env node
/**
 * db-tables.js â€” List tables with row counts and column info from the {{SITE_NAME}} SQLite state DB.
 *
 * Useful for introspection, debugging, and understanding the DB schema.
 *
 * Usage:
 *   node db-tables.js [options]
 */

const { parseArgs, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
db-tables â€” List tables with row counts and column info.

USAGE
  node db-tables.js [options]

OPTIONS
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without a database
  --verbose                 Include column details for each table

OUTPUT
  For each table:
    â€¢ name       â€” Table name
    â€¢ row_count  â€” Number of rows
    â€¢ columns    â€” Column names, types, and constraints (with --verbose)

EXAMPLES
  node db-tables.js --table
  node db-tables.js --verbose --json
  node db-tables.js --db ./state.db
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
      tables: [
        {
          name: 'tasks',
          row_count: 149,
          columns: [
            { name: 'task_id', type: 'TEXT', pk: 1, notnull: 0 },
            { name: 'title', type: 'TEXT', pk: 0, notnull: 1 },
            { name: 'status', type: 'TEXT', pk: 0, notnull: 1 },
          ],
        },
        {
          name: 'events',
          row_count: 523,
          columns: [
            { name: 'event_id', type: 'TEXT', pk: 1, notnull: 0 },
            { name: 'event_type', type: 'TEXT', pk: 0, notnull: 1 },
          ],
        },
      ],
      total_tables: 2,
      total_rows: 672,
    };
    printOutput(envelope(sample, { tool: 'db-tables' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const verbose = args.verbose || false;

    // â”€â”€ Get all user tables â”€â”€
    const tableRows = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    const tables = [];
    let totalRows = 0;

    for (const tableRow of tableRows) {
      const tableName = tableRow.name;

      // Get row count
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get();
      const rowCount = countRow.count;
      totalRows += rowCount;

      const tableInfo = {
        name: tableName,
        row_count: rowCount,
      };

      // Get column info (always for JSON, optional for table format)
      if (verbose || getOutputFormat(args) === 'json') {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        tableInfo.columns = columns.map(col => ({
          name: col.name,
          type: col.type || 'ANY',
          pk: col.pk,
          notnull: col.notnull,
          default_value: col.dflt_value,
        }));
        tableInfo.column_count = columns.length;
      }

      tables.push(tableInfo);
    }

    // â”€â”€ Get indexes â”€â”€
    const indexes = db.prepare(`
      SELECT name, tbl_name FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY tbl_name, name
    `).all();

    db.close();

    const result = {
      results: tables,
      total_tables: tables.length,
      total_rows: totalRows,
      total_indexes: indexes.length,
    };

    if (verbose || getOutputFormat(args) === 'json') {
      result.indexes = indexes.map(idx => ({
        name: idx.name,
        table: idx.tbl_name,
      }));
    }

    printOutput(envelope(result, { tool: 'db-tables' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'db-tables' }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
