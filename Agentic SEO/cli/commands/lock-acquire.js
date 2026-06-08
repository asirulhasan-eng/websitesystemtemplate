/**
 * lock-acquire.js â€” Acquire a resource lock atomically
 *
 * Atomic: BEGIN â†’ check for active conflicts â†’ INSERT lock â†’ INSERT event â†’ COMMIT
 *
 * Usage:
 *   v2 lock acquire --type file_lock --resource /services/{{NICHE}}.html --db state.db
 *   v2 lock acquire --type keyword_lock --resource "{{AUDIENCE}} near me" --task TSK-123 --ttl-minutes 60
 *   v2 lock acquire --type url_lock --resource https://example.com/page --reason "SEO update" --json
 *
 * Options:
 *   --type           Required. Lock type: file_lock, url_lock, keyword_lock, deploy_lock, etc.
 *   --resource       Required. The resource ID to lock (file path, URL, keyword, etc.)
 *   --task           Optional. Associated task_id
 *   --owner          Lock owner agent name (default: v2-cli)
 *   --ttl-minutes    Time-to-live in minutes before lock expires (default: 120)
 *   --reason         Human-readable reason for the lock
 *   --stale-seconds  Custom stale_after_seconds value (default: 1800)
 *   --db             SQLite database path
 *   --json           JSON output (default)
 *   --table          Table output
 *   --sample         Return sample data without touching DB
 *   --help           Show this help text
 */

const { parseArgs, requireArg, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'lock-acquire';

const HELP = `
lock-acquire â€” Acquire a resource lock atomically

USAGE
  v2 lock acquire --type <lock_type> --resource <resource_id> [options]

REQUIRED
  --type            Lock type: file_lock | url_lock | keyword_lock | deploy_lock | general
  --resource        Resource identifier to lock (file path, URL, keyword, etc.)

OPTIONS
  --task            Associated task_id
  --owner           Lock owner agent name (default: v2-cli)
  --ttl-minutes     Time-to-live in minutes (default: 120)
  --reason          Human-readable reason for locking
  --stale-seconds   Seconds before lock is considered stale (default: 1800)
  --db              SQLite database path (or CLIENT_DB_PATH env var)
  --json            JSON output (default)
  --table           Table output
  --sample          Return sample data without DB interaction
  --help            Show this help text

EXAMPLES
  v2 lock acquire --type file_lock --resource /services/{{NICHE}}.html --db state.db
  v2 lock acquire --type keyword_lock --resource "{{AUDIENCE}} near me" --task TSK-2026-06-03-AB12 --ttl-minutes 60
  v2 lock acquire --type deploy_lock --resource main --reason "Production deploy"

BEHAVIOR
  Atomically checks for conflicting active locks on the same type+resource.
  If a conflict exists, the command fails with details of the blocking lock.
  On success, returns the new lock_id and expiration time.
`.trim();

module.exports = function lockAcquire() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const now = nowIso();
    const sampleExpires = new Date(Date.now() + 120 * 60 * 1000).toISOString();
    printOutput(envelope({
      lock_id: 'LCK-2026-06-03-SAMPLE1',
      lock_type: 'file_lock',
      resource_id: '/services/{{NICHE}}.html',
      task_id: null,
      owner_agent: 'v2-cli',
      status: 'active',
      created_at: now,
      expires_at: sampleExpires,
      reason: 'Sample lock for testing',
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const lockType = requireArg(args, 'type', 'Missing --type (file_lock, url_lock, keyword_lock, deploy_lock, general)');
    const resourceId = requireArg(args, 'resource', 'Missing --resource (resource identifier to lock)');
    const taskId = args.task || null;
    const owner = args.owner || 'v2-cli';
    const ttlMinutes = numberArg(args, 'ttl-minutes', 120);
    const staleSeconds = numberArg(args, 'stale-seconds', 1800);
    const reason = args.reason || null;

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    try {
      const now = nowIso();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const lockId = makeId('LCK');

      db.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        // Check for conflicting active locks on the same type+resource
        const conflict = db.prepare(`
          SELECT lock_id, owner_agent, task_id, created_at, expires_at, reason
          FROM locks
          WHERE lock_type = ? AND resource_id = ? AND status = 'active'
            AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1
        `).get(lockType, resourceId, now);

        if (conflict) {
          db.exec('ROLLBACK');
          printOutput(errorEnvelope(
            `Lock conflict: resource "${resourceId}" (${lockType}) is already locked by "${conflict.owner_agent}" ` +
            `(lock_id: ${conflict.lock_id}, expires: ${conflict.expires_at || 'never'}, reason: ${conflict.reason || 'none'})`,
            { tool: TOOL }
          ), 'json');
          process.exitCode = 1;
          return;
        }

        // Insert the lock
        db.prepare(`
          INSERT INTO locks (
            lock_id, lock_type, resource_id, task_id, owner_agent, status,
            created_at, expires_at, heartbeat_at, stale_after_seconds, reason, metadata_json
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
        `).run(
          lockId, lockType, resourceId, taskId, owner,
          now, expiresAt, now, staleSeconds, reason,
          JSON.stringify({ ttl_minutes: ttlMinutes, acquired_via: 'cli' })
        );

        // Insert event
        db.prepare(`
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          makeId('EVT'), 'lock_acquired', taskId, 'lock', lockId,
          null, 'active', TOOL, owner, now,
          JSON.stringify({ lock_type: lockType, resource_id: resourceId, ttl_minutes: ttlMinutes })
        );

        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      printOutput(envelope({
        lock_id: lockId,
        lock_type: lockType,
        resource_id: resourceId,
        task_id: taskId,
        owner_agent: owner,
        status: 'active',
        created_at: now,
        expires_at: expiresAt,
        stale_after_seconds: staleSeconds,
        reason,
      }, { tool: TOOL }), getOutputFormat(args));
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