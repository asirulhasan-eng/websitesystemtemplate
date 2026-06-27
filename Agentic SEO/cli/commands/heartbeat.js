/**
 * heartbeat.js Ã¢â‚¬â€ Heartbeat management for cron jobs and background services
 *
 * Actions:
 *   start   Ã¢â‚¬â€ Register a new job run (INSERT/UPDATE heartbeats + INSERT cron_runs)
 *   finish  Ã¢â‚¬â€ Complete a job run (UPDATE heartbeats + UPDATE cron_runs)
 *   beat    Ã¢â‚¬â€ Update heartbeat_at timestamp (keep-alive ping)
 *   status  Ã¢â‚¬â€ Show all heartbeat statuses
 *   reconcile-stale
 *           Ã¢â‚¬â€ Supersede stale running cron_runs rows without changing heartbeat state
 *
 * Usage:
 *   v2 heartbeat start --job daily-gsc-fetch --db state.db
 *   v2 heartbeat finish --job daily-gsc-fetch --run-id CRN-2026-06-03-AB12
 *   v2 heartbeat beat --job daily-gsc-fetch --db state.db
 *   v2 heartbeat status --db state.db --table
 *
 * Options:
 *   First positional arg: action (start|finish|beat|status)
 *   --job              Required for start/finish/beat. Job name identifier
 *   --run-id           Cron run ID (auto-generated on start, required for finish)
 *   --error            Record error message on finish
 *   --task-id          Current task being processed
 *   --db               SQLite database path
 *   --json             JSON output (default)
 *   --table            Table output
 *   --csv              CSV output
 *   --sample           Return sample data without DB interaction
 *   --help             Show this help text
 */

const { parseArgs, requireArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'heartbeat';
const DEFAULT_STALE_RUNNING_MINUTES = 120;

const HELP = `
heartbeat Ã¢â‚¬â€ Heartbeat management for cron jobs and background services

USAGE
  v2 heartbeat <action> --job <name> [options]

ACTIONS
  start    Register a new job run. Creates/updates heartbeats row + inserts cron_runs row.
  finish   Complete a job run. Updates heartbeats + cron_runs with duration and status.
  beat     Keep-alive ping. Updates heartbeat_at on the heartbeats row.
  status   Show all heartbeat statuses across all registered jobs.
  reconcile-stale
           Supersede stale running cron_runs rows without changing heartbeat state.
           Preserves the latest running row when heartbeat/lock state indicates
           the job is genuinely active.

REQUIRED (for start/finish/beat/reconcile-stale)
  --job              Job name identifier (e.g., daily-gsc-fetch, weekly-report)

OPTIONS
  --run-id           Cron run ID (auto-generated on start; required for finish)
  --error            Error message to record (on finish with failure)
  --preserve-stale-running
                     On finish, do not supersede older running cron_runs rows.
                     Use only when a wrapper exits because another tick is
                     genuinely still active (for example, a held run-lock).
  --stale-running-minutes
                     Age threshold for superseding stale running cron_runs rows
                     on finish (default: 120)
  --task-id          Current task being processed
  --created-tasks    Number of tasks created (for finish)
  --completed-tasks  Number of tasks completed (for finish)
  --email-sent       Number of emails sent (for finish)
  --db               SQLite database path (or WEBSITE_AGENT_DB_PATH env var)
  --json             JSON output (default)
  --table            Table output
  --csv              CSV output
  --sample           Return sample data without DB interaction
  --help             Show this help text

EXAMPLES
  v2 heartbeat start --job daily-gsc-fetch --db state.db
  v2 heartbeat beat --job daily-gsc-fetch --db state.db
  v2 heartbeat finish --job daily-gsc-fetch --run-id CRN-2026-06-03-AB12CD34 --db state.db
  v2 heartbeat finish --job daily-gsc-fetch --run-id CRN-123 --error "API timeout" --db state.db
  v2 heartbeat status --db state.db --table
`.trim();

module.exports = function heartbeat() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  const action = (args._positional[0] || '').toLowerCase();

  if (args.sample) {
    const now = nowIso();
    switch (action || 'status') {
      case 'start':
        printOutput(envelope({
          action: 'start',
          job_name: 'daily-gsc-fetch',
          run_id: 'CRN-2026-06-03-SAMPLE1',
          heartbeat_id: 'HBT-2026-06-03-SAMPLE1',
          status: 'running',
          started_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      case 'finish':
        printOutput(envelope({
          action: 'finish',
          job_name: 'daily-gsc-fetch',
          run_id: 'CRN-2026-06-03-SAMPLE1',
          status: 'completed',
          duration_seconds: 45.2,
          finished_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      case 'beat':
        printOutput(envelope({
          action: 'beat',
          job_name: 'daily-gsc-fetch',
          heartbeat_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      default:
        printOutput(envelope({
          rows: [
            { job_name: 'daily-gsc-fetch', status: 'running', heartbeat_at: now, last_successful_run_at: now, error_summary: null },
            { job_name: 'weekly-report', status: 'idle', heartbeat_at: daysAgoStr(1), last_successful_run_at: daysAgoStr(1), error_summary: null },
          ],
          count: 2,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
    }
  }

  try {
    if (!action || !['start', 'finish', 'beat', 'status', 'reconcile-stale'].includes(action)) {
      printOutput(errorEnvelope(
        `Invalid or missing action. Use: start | finish | beat | status | reconcile-stale\nUsage: v2 heartbeat <action> --job <name>`,
        { tool: TOOL }
      ), 'json');
      process.exitCode = 1;
      return;
    }

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const now = nowIso();

    try {
      if (action === 'status') {
        const rows = db.prepare(`
          SELECT heartbeat_id, job_name, status, heartbeat_at, current_task_id,
                 duration_seconds, last_successful_run_at, last_failed_run_at, error_summary
          FROM heartbeats
          ORDER BY heartbeat_at DESC
        `).all();

        const fmt = getOutputFormat(args);
        if (fmt === 'json') {
          printOutput(envelope({ rows, count: rows.length }, { tool: TOOL }), fmt);
        } else {
          printOutput(rows, fmt);
        }
        return;
      }

      // start, finish, beat, reconcile-stale all require --job
      const jobName = requireArg(args, 'job', 'Missing --job (job name identifier)');

      if (action === 'reconcile-stale') {
        let supersededStaleRuns = 0;
        let preservedRunId = null;
        db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
          preservedRunId = runningCronRunToPreserve(db, jobName, now);
          supersededStaleRuns = supersedeStaleRunningCronRuns(db, {
            jobName,
            now,
            runId: preservedRunId,
            staleMinutes: parsePositiveInteger(args['stale-running-minutes'], DEFAULT_STALE_RUNNING_MINUTES),
          });
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        printOutput(envelope({
          action: 'reconcile-stale',
          job_name: jobName,
          superseded_stale_runs: supersededStaleRuns,
          preserved_active_run_id: preservedRunId,
          reconciled_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      if (action === 'start') {
        const runId = makeId('CRN');
        const heartbeatId = makeId('HBT');
        let existing = null;

        db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
          // Upsert heartbeats row
          existing = db.prepare('SELECT heartbeat_id FROM heartbeats WHERE job_name = ?').get(jobName);

          if (existing) {
            db.prepare(`
              UPDATE heartbeats SET status = 'running', heartbeat_at = ?, current_task_id = ?,
                duration_seconds = NULL, error_summary = NULL
              WHERE job_name = ?
            `).run(now, args['task-id'] || null, jobName);
          } else {
            db.prepare(`
              INSERT INTO heartbeats (heartbeat_id, job_name, status, heartbeat_at, current_task_id)
              VALUES (?, ?, 'running', ?, ?)
            `).run(heartbeatId, jobName, now, args['task-id'] || null);
          }

          // Insert cron_runs row
          db.prepare(`
            INSERT INTO cron_runs (cron_run_id, job_name, status, started_at, metadata_json)
            VALUES (?, ?, 'running', ?, ?)
          `).run(runId, jobName, now, JSON.stringify({ started_via: 'cli' }));

          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        printOutput(envelope({
          action: 'start',
          job_name: jobName,
          run_id: runId,
          heartbeat_id: existing ? existing.heartbeat_id : heartbeatId,
          status: 'running',
          started_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      if (action === 'beat') {
        const result = db.prepare(
          'UPDATE heartbeats SET heartbeat_at = ? WHERE job_name = ?'
        ).run(now, jobName);

        if (result.changes === 0) {
          printOutput(errorEnvelope(`No heartbeat found for job: ${jobName}. Run "start" first.`, { tool: TOOL }), 'json');
          process.exitCode = 1;
          return;
        }

        printOutput(envelope({
          action: 'beat',
          job_name: jobName,
          heartbeat_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      if (action === 'finish') {
        const runId = args['run-id'];
        const errorMsg = args.error || null;
        const finalStatus = errorMsg ? 'failed' : 'completed';
        const preserveStaleRunning = Boolean(args['preserve-stale-running']);
        let supersededStaleRuns = 0;

        db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
          // Update heartbeats
          const hbUpdate = {
            status: errorMsg ? 'error' : 'idle',
            heartbeat_at: now,
            error_summary: errorMsg,
          };

          if (errorMsg) {
            db.prepare(`
              UPDATE heartbeats SET status = ?, heartbeat_at = ?, error_summary = ?,
                last_failed_run_at = ?, current_task_id = NULL
              WHERE job_name = ?
            `).run(hbUpdate.status, now, errorMsg, now, jobName);
          } else {
            db.prepare(`
              UPDATE heartbeats SET status = ?, heartbeat_at = ?, error_summary = NULL,
                last_successful_run_at = ?, current_task_id = NULL
              WHERE job_name = ?
            `).run(hbUpdate.status, now, now, jobName);
          }

          // Update cron_runs. If --run-id is provided, close that row. Otherwise
          // fall back to the most recent still-open ('running') row for this job,
          // so callers that don't thread the run-id through (e.g. the pipeline
          // cron scripts) don't leak 'running' rows forever.
          let cronRun = null;
          if (runId) {
            cronRun = db.prepare('SELECT cron_run_id, started_at FROM cron_runs WHERE cron_run_id = ?').get(runId);
          } else {
            cronRun = db.prepare(`
              SELECT cron_run_id, started_at FROM cron_runs
              WHERE job_name = ? AND status = 'running'
              ORDER BY started_at DESC LIMIT 1
            `).get(jobName);
          }

          if (cronRun) {
            const durationSec = (new Date(now).getTime() - new Date(cronRun.started_at).getTime()) / 1000;

            db.prepare(`
              UPDATE cron_runs SET status = ?, finished_at = ?, duration_seconds = ?,
                error_summary = ?, created_tasks = ?, completed_tasks = ?, email_sent = ?
              WHERE cron_run_id = ?
            `).run(
              finalStatus, now, durationSec, errorMsg,
              parseInt(args['created-tasks'] || '0', 10),
              parseInt(args['completed-tasks'] || '0', 10),
              parseInt(args['email-sent'] || '0', 10),
              cronRun.cron_run_id
            );
          }

          if (!preserveStaleRunning) {
            supersededStaleRuns = supersedeStaleRunningCronRuns(db, {
              jobName,
              now,
              runId: cronRun ? cronRun.cron_run_id : runId || null,
              staleMinutes: parsePositiveInteger(args['stale-running-minutes'], DEFAULT_STALE_RUNNING_MINUTES),
            });
          }

          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        printOutput(envelope({
          action: 'finish',
          job_name: jobName,
          run_id: runId || null,
          status: finalStatus,
          error: errorMsg,
          superseded_stale_runs: supersededStaleRuns,
          stale_running_preserved: preserveStaleRunning,
          finished_at: now,
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }
    } finally {
      db.close();
    }

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runningCronRunToPreserve(db, jobName, now) {
  const heartbeat = db.prepare('SELECT status FROM heartbeats WHERE job_name = ?').get(jobName);
  const freshActiveLock = db.prepare(`
    SELECT COUNT(*) AS count
    FROM locks
    WHERE status = 'active'
      AND (owner_agent = ? OR resource_id = ?)
      AND (expires_at IS NULL OR expires_at > ?)
  `).get(jobName, jobName, now);

  if (!(heartbeat && heartbeat.status === 'running') && !(freshActiveLock && freshActiveLock.count > 0)) {
    return null;
  }

  const latestRunning = db.prepare(`
    SELECT cron_run_id
    FROM cron_runs
    WHERE job_name = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `).get(jobName);
  return latestRunning ? latestRunning.cron_run_id : null;
}

function supersedeStaleRunningCronRuns(db, { jobName, now, runId, staleMinutes }) {
  const cutoff = new Date(new Date(now).getTime() - staleMinutes * 60 * 1000).toISOString();
  const reason = `superseded by later heartbeat finish after ${staleMinutes}m stale-running threshold`;
  const result = db.prepare(`
    UPDATE cron_runs
    SET status = 'superseded',
        finished_at = ?,
        duration_seconds = CASE
          WHEN started_at IS NOT NULL THEN (julianday(?) - julianday(started_at)) * 86400.0
          ELSE duration_seconds
        END,
        error_summary = COALESCE(error_summary, ?),
        metadata_json = json_set(
          CASE
            WHEN json_valid(COALESCE(metadata_json, '{}')) THEN COALESCE(metadata_json, '{}')
            ELSE '{}'
          END,
          '$.superseded_by_run_id', ?,
          '$.superseded_at', ?,
          '$.superseded_reason', ?
        )
    WHERE job_name = ?
      AND status = 'running'
      AND started_at IS NOT NULL
      AND started_at < ?
      AND (? IS NULL OR cron_run_id != ?)
  `).run(now, now, reason, runId || null, now, reason, jobName, cutoff, runId || null, runId || null);
  return result.changes || 0;
}

// Helper for sample mode
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

module.exports = Object.assign(module.exports, {
  DEFAULT_STALE_RUNNING_MINUTES,
  parsePositiveInteger,
  runningCronRunToPreserve,
  supersedeStaleRunningCronRuns,
});

if (require.main === module) {
  module.exports();
}