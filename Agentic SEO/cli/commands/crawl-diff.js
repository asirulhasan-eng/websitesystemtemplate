#!/usr/bin/env node
/**
 * crawl-diff.js — Compare two crawl runs to find new/fixed issues
 *
 * Uses historical crawler_runs data from SQLite to show what changed
 * between crawl runs. Helps AI understand if technical fixes are working
 * or if new issues have appeared.
 */
const { parseArgs, numberArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  try {
    const dbPath = resolveDbPath(args);
    const { openStateDb } = require('../lib/state_db');
    const db = openStateDb(dbPath);

    try {
      // Get the two most recent crawl runs (or use --run-id and --compare-to)
      let currentRun, previousRun;

      if (args['run-id'] && args['compare-to']) {
        currentRun = db.prepare('SELECT * FROM crawler_runs WHERE crawler_run_id = ?').get(args['run-id']);
        previousRun = db.prepare('SELECT * FROM crawler_runs WHERE crawler_run_id = ?').get(args['compare-to']);
      } else {
        const runs = db.prepare('SELECT * FROM crawler_runs WHERE status = ? ORDER BY finished_at DESC LIMIT 2').all('completed');
        if (runs.length < 2) {
          printOutput(envelope({
            error: 'Need at least 2 completed crawl runs for comparison. Run "v2 crawl --db" twice first.',
            available_runs: runs.length,
          }, { tool: 'crawl-diff' }), getOutputFormat(args));
          return;
        }
        currentRun = runs[0];
        previousRun = runs[1];
      }

      if (!currentRun || !previousRun) {
        throw new Error('Could not find the specified crawl runs');
      }

      const currentIssues = JSON.parse(currentRun.issue_summary_json || '[]');
      const previousIssues = JSON.parse(previousRun.issue_summary_json || '[]');

      // Create issue keys for comparison
      const issueKey = (issue) => `${issue.type}:${issue.page}:${issue.detail || ''}`;

      const currentSet = new Set(currentIssues.map(issueKey));
      const previousSet = new Set(previousIssues.map(issueKey));

      const newIssues = currentIssues.filter(i => !previousSet.has(issueKey(i)));
      const fixedIssues = previousIssues.filter(i => !currentSet.has(issueKey(i)));
      const persistentIssues = currentIssues.filter(i => previousSet.has(issueKey(i)));

      const result = {
        current_run: {
          id: currentRun.crawler_run_id,
          date: currentRun.finished_at,
          pages: currentRun.pages_scanned,
          issues: currentRun.issues_found,
        },
        previous_run: {
          id: previousRun.crawler_run_id,
          date: previousRun.finished_at,
          pages: previousRun.pages_scanned,
          issues: previousRun.issues_found,
        },
        delta: {
          pages_change: (currentRun.pages_scanned || 0) - (previousRun.pages_scanned || 0),
          issues_change: (currentRun.issues_found || 0) - (previousRun.issues_found || 0),
          new_issues: newIssues.length,
          fixed_issues: fixedIssues.length,
          persistent_issues: persistentIssues.length,
        },
        new_issues: newIssues,
        fixed_issues: fixedIssues,
      };

      printOutput(envelope(result, { tool: 'crawl-diff' }), getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'crawl-diff' }), 'json');
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`
crawl-diff — Compare two crawl runs to find new/fixed issues

Usage:
  v2 crawl-diff [options]

Options:
  --db <path>              SQLite DB path (required)
  --run-id <id>            Current crawl run ID
  --compare-to <id>        Previous crawl run ID to compare against
  (default: compares the two most recent completed crawl runs)

Output:
  --json                   JSON output (default)
  --table                  Table output

Output includes:
  - Current vs previous run summary (pages, issues)
  - New issues (found in current but not previous)
  - Fixed issues (found in previous but not current)
  - Delta counts

Examples:
  v2 crawl-diff --db /path/to/seo-agent.db --json
  v2 crawl-diff --run-id CRWL-2026-06-03-ABC --compare-to CRWL-2026-05-30-DEF --json
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
