/**
 * lock-release.js â€” Release a resource lock atomically
 *
 * Atomic: BEGIN â†’ UPDATE lock status=released â†’ INSERT event â†’ COMMIT
 *
 * Usage:
 *   v2 lock release --id LCK-2026-06-03-AB12CD34 --db state.db
 *   v2 lock release --id LCK-2026-06-03-AB12CD34 --json
 *
 * Options:
 *   --id             Required. The lock_id to release
 *   --db             SQLite database path
 *   --json           JSON output (default)
 *   --table          Table output
 *   --sample         Return sample data without DB interaction
 *   --help           Show this help text
 */

const { parseArgs, requireArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'lock-release';

const HELP = `
lock-release â€” Release a resource lock atomically

USAGE
  v2 lock release --id <lock_id> [options]

REQUIRED
  --id              The lock_id to release

OPTIONS
  --db              SQLite database path (or CLIENT_DB_PATH env var)
  --json            JSON output (default)
  --table           Table output
  --sample          Return sample data without DB interaction
  --help            Show this help text

EXAMPLES
  v2 lock release --id LCK-2026-06-03-AB12CD34 --db state.db
  v2 lock release --id LCK-2026-06-03-AB12CD34 --json

BEHAVIOR
  Atomically sets lock status to 'released' and records released_at timestamp.
  If the lock is already released or doesn't exist, an error is returned.
  An event is recorded in the events table for audit trail.
`.trim();

module.exports = function lockRelease() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const now = nowIso();
    printOutput(envelope({
      lock_id: 'LCK-2026-06-03-SAMPLE1',
      status: 'released',
      released_at: now,
      message: 'Lock released successfully',
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const lockId = requireArg(args, 'id', 'Missing --id (lock_id to release)');
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    try {
      const now = nowIso();

      db.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        // Fetch existing lock
        const lock = db.prepare(
          'SELECT lock_id, lock_type, resource_id, task_id, owner_agent, status FROM locks WHERE lock_id = ?'
        ).get(lockId);

        if (!lock) {
          db.exec('ROLLBACK');
          printOutput(errorEnvelope(`Lock not found: ${lockId}`, { tool: TOOL }), 'json');
          process.exitCode = 1;
          return;
        }

        if (lock.status === 'released') {
          db.exec('ROLLBACK');
          printOutput(errorEnvelope(`Lock ${lockId} is already released`, { tool: TOOL }), 'json');
          process.exitCode = 1;
          return;
        }

        // Update lock to released
        db.prepare(
          'UPDATE locks SET status = ?, released_at = ? WHERE lock_id = ?'
        ).run('released', now, lockId);

        // Insert event
        db.prepare(`
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          makeId('EVT'), 'lock_released', lock.task_id, 'lock', lockId,
          lock.status, 'released', TOOL, lock.owner_agent || 'v2-cli', now,
          JSON.stringify({ lock_type: lock.lock_type, resource_id: lock.resource_id })
        );

        db.exec('COMMIT');

        printOutput(envelope({
          lock_id: lockId,
          lock_type: lock.lock_type,
          resource_id: lock.resource_id,
          status: 'released',
          released_at: now,
          previous_status: lock.status,
          message: 'Lock released successfully',
        }, { tool: TOOL }), getOutputFormat(args));

      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
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