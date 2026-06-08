/**
 * lock-list.js â€” List resource locks with filtering
 *
 * Usage:
 *   v2 lock list --db state.db --table
 *   v2 lock list --status released --db state.db
 *   v2 lock list --stale --table
 *   v2 lock list --type file_lock --all
 *
 * Options:
 *   --status         Filter by status: active, released, stale (default: active)
 *   --type           Filter by lock_type (file_lock, url_lock, keyword_lock, etc.)
 *   --stale          Show only stale locks (past expires_at or heartbeat stale)
 *   --all            Show all locks regardless of status
 *   --owner          Filter by owner_agent
 *   --resource       Filter by resource_id (partial match)
 *   --limit          Max rows to return (default: 100)
 *   --db             SQLite database path
 *   --json           JSON output (default)
 *   --table          Table output
 *   --csv            CSV output
 *   --sample         Return sample data without DB interaction
 *   --help           Show this help text
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'lock-list';

const HELP = `
lock-list â€” List resource locks with filtering

USAGE
  v2 lock list [options]

OPTIONS
  --status          Filter by status: active | released | stale (default: active)
  --type            Filter by lock_type (file_lock, url_lock, keyword_lock, deploy_lock)
  --stale           Show only locks past their expires_at
  --all             Show all locks regardless of status
  --owner           Filter by owner_agent
  --resource        Filter by resource_id (partial match with LIKE)
  --limit           Maximum rows to return (default: 100)
  --db              SQLite database path (or CLIENT_DB_PATH env var)
  --json            JSON output (default)
  --table           Table output
  --csv             CSV output
  --sample          Return sample data without DB interaction
  --help            Show this help text

EXAMPLES
  v2 lock list --db state.db --table
  v2 lock list --status released --limit 50
  v2 lock list --stale --table
  v2 lock list --type file_lock --all --csv
  v2 lock list --owner "deploy-agent"

OUTPUT FIELDS
  lock_id, lock_type, resource_id, task_id, owner_agent, status,
  created_at, expires_at, released_at, reason
`.trim();

module.exports = function lockList() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const now = nowIso();
    const sampleData = {
      rows: [
        {
          lock_id: 'LCK-2026-06-03-SAMPLE1',
          lock_type: 'file_lock',
          resource_id: '/services/{{NICHE}}.html',
          task_id: 'TSK-2026-06-03-AB12CD34',
          owner_agent: 'content-agent',
          status: 'active',
          created_at: now,
          expires_at: new Date(Date.now() + 7200000).toISOString(),
          released_at: null,
          reason: 'Editing page content',
        },
        {
          lock_id: 'LCK-2026-06-03-SAMPLE2',
          lock_type: 'keyword_lock',
          resource_id: '{{AUDIENCE}} near me',
          task_id: null,
          owner_agent: 'v2-cli',
          status: 'active',
          created_at: now,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          released_at: null,
          reason: 'SERP monitoring',
        },
      ],
      count: 2,
    };
    printOutput(envelope(sampleData, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    try {
      const now = nowIso();
      const limit = numberArg(args, 'limit', 100);
      const showAll = boolArg(args, 'all');
      const showStale = boolArg(args, 'stale');

      const conditions = [];
      const params = [];

      if (showStale) {
        conditions.push('(status = ? AND expires_at IS NOT NULL AND expires_at < ?)');
        params.push('active', now);
      } else if (!showAll) {
        const status = args.status || 'active';
        conditions.push('status = ?');
        params.push(status);
      }

      if (args.type) {
        conditions.push('lock_type = ?');
        params.push(args.type);
      }

      if (args.owner) {
        conditions.push('owner_agent = ?');
        params.push(args.owner);
      }

      if (args.resource) {
        conditions.push('resource_id LIKE ?');
        params.push(`%${args.resource}%`);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      params.push(limit);

      const rows = db.prepare(`
        SELECT lock_id, lock_type, resource_id, task_id, owner_agent, status,
               created_at, expires_at, released_at, heartbeat_at, stale_after_seconds, reason
        FROM locks
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...params);

      // Annotate stale status for active locks
      const annotated = rows.map(row => {
        const isStale = row.status === 'active' && row.expires_at && row.expires_at < now;
        return { ...row, is_stale: isStale };
      });

      const fmt = getOutputFormat(args);
      if (fmt === 'json') {
        printOutput(envelope({ rows: annotated, count: annotated.length }, { tool: TOOL }), fmt);
      } else {
        printOutput(annotated, fmt);
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