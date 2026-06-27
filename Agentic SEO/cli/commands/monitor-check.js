/**
 * monitor-check.js Ã¢â‚¬â€ System health checks
 *
 * Runs comprehensive health checks across heartbeats, locks, outbox, disk, and DB.
 * Optionally creates alerts, sends emails on critical issues, and auto-fixes stale state.
 *
 * Usage:
 *   v2 monitor-check --db state.db --full --json
 *   v2 monitor-check --db state.db --heartbeats --locks --table
 *   v2 monitor-check --db state.db --auto-fix --alert-on-failure
 *
 * Options:
 *   --full             Run all checks (default)
 *   --heartbeats       Check heartbeat freshness
 *   --locks            Check for stale/expired locks
 *   --outbox           Check for stuck outbox jobs
 *   --disk             Check disk space
 *   --db-health        Check DB integrity and size
 *   --authoritative-db-path
 *                     Check canonical DB path and phantom backslash DB files
 *   --self-improvement-backlog
 *                     Check approved self-improvement tasks older than 90m
 *   --self-improvement-worker
 *                     Check self-improvement worker heartbeat freshness
 *   --blog-credential-blockers
 *                     Check parked blog/content work blocked by Cloudflare credentials
 *   --stale-production
 *                     Check completed main-push tasks whose live clean URL remains 404 after deploy window
 *   --alert-on-failure Create monitor_alerts rows for failures
 *   --email-on-critical Queue retryable email for critical issues
 *   --auto-fix         Auto-fix: release stale locks, retry stuck outbox
 *   --stale-minutes    Minutes before heartbeat is considered stale (default: 30)
 *   --db               SQLite database path
 *   --json             JSON output (default)
 *   --table            Table output
 *   --sample           Return sample data without DB interaction
 *   --help             Show this help text
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');
const {
  OUTBOX_RETRYABLE,
  OUTBOX_EMAIL_JOB_TYPES,
  isSmtpAuthFailure,
  sqlList,
} = require('../lib/outbox_states');
const { SELF_IMPROVEMENT_TYPES } = require('../lib/task_routing');
const {
  DEFAULT_STALE_RUNNING_MINUTES,
  runningCronRunToPreserve,
  supersedeStaleRunningCronRuns,
} = require('./heartbeat');

const TOOL = 'monitor-check';

const HELP = `
monitor-check Ã¢â‚¬â€ System health checks

USAGE
  v2 monitor-check --db <path> [options]

CHECK TYPES
  --full             Run all checks (default if no specific checks chosen)
  --heartbeats       Check heartbeat freshness and stale jobs
  --locks            Check for stale/expired locks
  --outbox           Check outbox health: dead-letter jobs, jobs stuck in
                     'processing', and drain lag (oldest undrained job age)
  --disk             Check disk space usage
  --db-health        Check database integrity and size
  --authoritative-db-path
                     Check active DB path and phantom backslash DB files
  --self-improvement-backlog
                     Warn on approved self-improvement tasks unconsumed >90m
  --self-improvement-worker
                     Check self-improvement worker heartbeat freshness
  --blog-credential-blockers
                     Check parked blog/content work blocked by Cloudflare credentials
  --stale-production
                     Check completed main-push tasks whose live clean URL remains 404 after deploy window

ACTIONS
  --alert-on-failure   Create monitor_alerts rows for any failures found
  --email-on-critical  Queue retryable email notification for critical severity issues
  --auto-fix           Automatically fix issues:
                       Ã¢â‚¬Â¢ Release stale/expired locks
                       Ã¢â‚¬Â¢ Re-queue outbox jobs orphaned in 'processing'
                       Ã¢â‚¬Â¢ Time out abandoned 'running' deployments

OPTIONS
  --stale-minutes    Minutes before a heartbeat is considered stale (default: 30)
  --stale-running-minutes
                     Minutes before a running cron_runs ledger row is considered
                     stale/orphaned (default: ${DEFAULT_STALE_RUNNING_MINUTES})
  --outbox-processing-timeout-minutes  Minutes before a 'processing' outbox job is
                     treated as orphaned and re-queued (default: 30)
  --outbox-lag-minutes  Oldest-undrained-job age that flags the outbox as lagging
                     (default: 60)
  --smtp-repaired-after ISO timestamp. Dead-letter email jobs with SMTP auth
                     failures before this cutoff are treated as historical
                     repair fallout and --auto-fix marks them resolved.
  --renotify-hours   Re-send persistent critical alert emails after N hours
                     (default: 24, or MONITOR_RENOTIFY_HOURS)
  --db               SQLite database path (or WEBSITE_AGENT_DB_PATH env var)
  --json             JSON output (default)
  --table            Table output
  --sample           Return sample health check without DB
  --help             Show this help text

EXAMPLES
  v2 monitor-check --db state.db --full --json
  v2 monitor-check --db state.db --heartbeats --locks --table
  v2 monitor-check --db state.db --auto-fix --alert-on-failure
  v2 monitor-check --db state.db --full --email-on-critical

SEVERITY LEVELS
  ok        Ã¢â‚¬â€ Check passed, no issues
  warning   Ã¢â‚¬â€ Non-critical issue detected
  critical  Ã¢â‚¬â€ Immediate attention required
`.trim();

module.exports = async function monitorCheck() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      overall_status: 'warning',
      checks: [
        { check: 'heartbeats', status: 'ok', message: '3 jobs healthy, 0 stale', details: { total: 3, stale: 0 } },
        { check: 'locks', status: 'warning', message: '1 stale lock found', details: { active: 5, stale: 1 } },
        { check: 'outbox', status: 'ok', message: '0 stuck jobs', details: { pending: 2, stuck: 0 } },
        { check: 'disk', status: 'ok', message: 'DB size: 2.4 MB', details: { db_size_mb: 2.4 } },
        { check: 'db_health', status: 'ok', message: 'Integrity check passed', details: { integrity: 'ok' } },
        { check: 'authoritative_db_path', status: 'ok', message: 'Active DB path is canonical', details: { db_path: '/opt/website-state/website-agent.db' } },
        { check: 'self_improvement_backlog', status: 'ok', message: '0 approved self-improvement tasks older than 90m', details: { stale_approved: 0 } },
        { check: 'self_improvement_worker', status: 'ok', message: 'Worker heartbeat fresh', details: { job_name: 'self-improvement' } },
        { check: 'blog_credential_blockers', status: 'ok', message: '0 parked blog/content Cloudflare credential blockers', details: { blocked_tasks: 0, tasks: [] } },
        { check: 'stale_production_404', status: 'ok', message: '0 completed main-push tasks with live clean URL 404 after deploy window', details: { stale_tasks: 0, tasks: [] } },
      ],
      auto_fixes: [],
      alerts_created: 0,
      checked_at: nowIso(),
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    try {
      const now = nowIso();
      const nowMs = Date.now();
      const staleMinutes = numberArg(args, 'stale-minutes', 30);
      const staleRunningMinutes = numberArg(args, 'stale-running-minutes', DEFAULT_STALE_RUNNING_MINUTES);
      const alertOnFailure = boolArg(args, 'alert-on-failure');
      const autoFix = boolArg(args, 'auto-fix');

      // Determine which checks to run
      const specificChecks = args.heartbeats || args.locks || args.outbox || args.disk || args['db-health'] || args.deployments
        || args['authoritative-db-path'] || args['self-improvement-backlog'] || args['self-improvement-worker']
        || args['blog-credential-blockers'] || args['stale-production'];
      const runAll = boolArg(args, 'full') || !specificChecks;
      const checkHB = runAll || boolArg(args, 'heartbeats');
      const checkLocks = runAll || boolArg(args, 'locks');
      const checkOutbox = runAll || boolArg(args, 'outbox');
      const checkDeployments = runAll || boolArg(args, 'deployments');
      const checkDisk = runAll || boolArg(args, 'disk');
      const checkDbHealth = runAll || boolArg(args, 'db-health');
      const checkWatchlist = runAll || boolArg(args, 'watchlist');
      const checkAuthoritativeDbPath = runAll || boolArg(args, 'authoritative-db-path');
      const checkSelfImprovementBacklog = runAll || boolArg(args, 'self-improvement-backlog');
      const checkSelfImprovementWorker = runAll || boolArg(args, 'self-improvement-worker');
      const checkBlogCredentialBlockers = runAll || boolArg(args, 'blog-credential-blockers');
      const checkStaleProduction = runAll || boolArg(args, 'stale-production');
      const deployTimeoutMinutes = numberArg(args, 'deploy-timeout-minutes', 30);
      const deployWindowMinutes = numberArg(args, 'deploy-window-minutes', deployTimeoutMinutes);
      const expireMonitoredDays = numberArg(args, 'expire-monitored-days', 60);

      const checks = [];
      const autoFixes = [];
      let alertsCreated = 0;

      // --- HEARTBEAT CHECK ---
      if (checkHB) {
        const heartbeats = db.prepare('SELECT * FROM heartbeats').all();
        const staleThreshold = new Date(nowMs - staleMinutes * 60 * 1000).toISOString();
        const staleJobs = heartbeats.filter(h =>
          h.status === 'running' && h.heartbeat_at < staleThreshold
        );
        const staleRunningCronRuns = findStaleRunningCronRuns(db, now, staleRunningMinutes);

        const severity = (staleJobs.length > 0 || staleRunningCronRuns.length > 0) ? 'warning' : 'ok';
        checks.push({
          check: 'heartbeats',
          status: severity,
          message: `${heartbeats.length} jobs tracked, ${staleJobs.length} stale heartbeats, ${staleRunningCronRuns.length} stale running cron_runs`,
          details: {
            total: heartbeats.length,
            running: heartbeats.filter(h => h.status === 'running').length,
            stale: staleJobs.length,
            stale_jobs: staleJobs.map(h => h.job_name),
            stale_running_cron_runs: staleRunningCronRuns.length,
            stale_running_threshold_minutes: staleRunningMinutes,
            stale_running_rows: staleRunningCronRuns.map(row => ({
              cron_run_id: row.cron_run_id,
              job_name: row.job_name,
              started_at: row.started_at,
              heartbeat_status: row.heartbeat_status || null,
              heartbeat_at: row.heartbeat_at || null,
              preserved_active_run_id: row.preserved_active_run_id || null,
            })),
          },
        });

        // Auto-fix: close orphaned cron_runs rows that are still marked running
        // past the threshold. If the same job has a current active run (fresh
        // heartbeat or active run-lock), preserve that latest run id and only
        // supersede older orphan rows.
        if (autoFix && staleRunningCronRuns.length > 0) {
          const jobNames = [...new Set(staleRunningCronRuns.map(row => row.job_name))];
          for (const jobName of jobNames) {
            const preservedRunId = runningCronRunToPreserve(db, jobName, now);
            const superseded = supersedeStaleRunningCronRuns(db, {
              jobName,
              now,
              runId: preservedRunId,
              staleMinutes: staleRunningMinutes,
            });
            if (superseded > 0) {
              autoFixes.push({
                type: 'cron_run_superseded',
                job_name: jobName,
                superseded_stale_runs: superseded,
                preserved_active_run_id: preservedRunId || null,
                stale_running_threshold_minutes: staleRunningMinutes,
              });
            }
          }
        }
      }

      // --- LOCK CHECK ---
      if (checkLocks) {
        const activeLocks = db.prepare("SELECT * FROM locks WHERE status = 'active'").all();
        const staleLocks = activeLocks.filter(l =>
          l.expires_at && l.expires_at < now
        );

        const severity = staleLocks.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'locks',
          status: severity,
          message: `${activeLocks.length} active locks, ${staleLocks.length} expired/stale`,
          details: {
            active: activeLocks.length,
            stale: staleLocks.length,
            stale_locks: staleLocks.map(l => ({ lock_id: l.lock_id, resource_id: l.resource_id, expires_at: l.expires_at })),
          },
        });

        // Auto-fix: release stale locks
        if (autoFix && staleLocks.length > 0) {
          for (const lock of staleLocks) {
            db.prepare("UPDATE locks SET status = 'released', released_at = ? WHERE lock_id = ?").run(now, lock.lock_id);
            db.prepare(`
              INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id,
                old_value, new_value, source, agent_name, created_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              makeId('EVT'), 'lock_auto_released', lock.task_id, 'lock', lock.lock_id,
              'active', 'released', TOOL, 'monitor-check', now,
              JSON.stringify({ reason: 'expired_auto_fix' })
            );
            autoFixes.push({ type: 'lock_released', lock_id: lock.lock_id, resource_id: lock.resource_id });
          }
        }
      }

      // --- OUTBOX CHECK ---
      // The outbox workers cycle a job through pending â†’ processing â†’ completed |
      // retrying | dead_letter. The old check watched for `status='pending' AND
      // attempt_count>=3` and `status='failed'` â€” states the workers never write â€”
      // so it silently always reported healthy. This checks the states that
      // actually occur: dead_letter (gave up), stuck 'processing' (worker died
      // mid-flight; never re-selected by the drainers), and drain lag (oldest
      // undrained job age = is the mirror keeping up).
      if (checkOutbox) {
        const processingTimeoutMinutes = numberArg(args, 'outbox-processing-timeout-minutes', 30);
        const lagThresholdMinutes = numberArg(args, 'outbox-lag-minutes', 60);
        const processingThreshold = new Date(nowMs - processingTimeoutMinutes * 60 * 1000).toISOString();

        const retryableStatuses = sqlList(OUTBOX_RETRYABLE);
        const undrained = db.prepare(`SELECT COUNT(*) as cnt FROM outbox_jobs WHERE status IN (${retryableStatuses})`).get();
        const deadLetter = db.prepare(`
          SELECT outbox_id, job_type, entity_type, entity_id, attempt_count,
                 error_message, created_at, last_attempt_at
          FROM outbox_jobs
          WHERE status = 'dead_letter'
        `).all();
        const smtpRepairedAfter = repairCutoffForOutbox(db, args);
        const historicalSmtpAuthDeadLetter = deadLetter.filter(job => isHistoricalSmtpAuthDeadLetter(job, smtpRepairedAfter));
        const historicalIds = new Set(historicalSmtpAuthDeadLetter.map(job => job.outbox_id));
        const actionableDeadLetter = deadLetter.filter(job => !historicalIds.has(job.outbox_id));
        const stuckProcessing = db.prepare(
          "SELECT outbox_id, job_type, last_attempt_at FROM outbox_jobs WHERE status = 'processing' AND COALESCE(last_attempt_at, created_at) < ?"
        ).all(processingThreshold);
        const oldest = db.prepare(
          `SELECT MIN(created_at) as oldest FROM outbox_jobs WHERE status IN (${retryableStatuses})`
        ).get();
        const lagMinutes = oldest && oldest.oldest
          ? Math.round((nowMs - new Date(oldest.oldest).getTime()) / 60000)
          : 0;
        const lagging = lagMinutes > lagThresholdMinutes;

        const severity = (actionableDeadLetter.length > 0 || stuckProcessing.length > 0 || lagging) ? 'warning' : 'ok';
        checks.push({
          check: 'outbox',
          status: severity,
          message: `${undrained.cnt} undrained, ${actionableDeadLetter.length} actionable dead-letter, ${historicalSmtpAuthDeadLetter.length} historical SMTP-auth dead-letter, ${stuckProcessing.length} stuck-processing, oldest ${lagMinutes}m`,
          details: {
            undrained: undrained.cnt,
            dead_letter: actionableDeadLetter.length,
            historical_smtp_auth_dead_letter: historicalSmtpAuthDeadLetter.length,
            total_dead_letter: deadLetter.length,
            smtp_repaired_after: smtpRepairedAfter,
            stuck_processing: stuckProcessing.length,
            oldest_undrained_minutes: lagMinutes,
            lag_threshold_minutes: lagThresholdMinutes,
            dead_letter_jobs: actionableDeadLetter.map(j => ({ outbox_id: j.outbox_id, job_type: j.job_type, attempts: j.attempt_count, error: j.error_message })),
            historical_smtp_auth_dead_letter_jobs: historicalSmtpAuthDeadLetter.map(j => ({ outbox_id: j.outbox_id, job_type: j.job_type, attempts: j.attempt_count, error: j.error_message, last_attempt_at: j.last_attempt_at })),
            stuck_processing_jobs: stuckProcessing.map(j => ({ outbox_id: j.outbox_id, job_type: j.job_type, last_attempt_at: j.last_attempt_at })),
          },
        });

        // Auto-fix: re-queue jobs orphaned in 'processing' (a worker died between
        // marking processing and committing the result). Historical SMTP-auth
        // email dead letters are different: once a later successful email (or an
        // explicit --smtp-repaired-after cutoff) proves credentials were repaired,
        // old monitor/workplan notification failures are repair fallout. Mark them
        // resolved so they stop keeping health checks warning, while newer SMTP
        // auth failures remain actionable dead letters and still alert.
        if (autoFix && historicalSmtpAuthDeadLetter.length > 0) {
          for (const job of historicalSmtpAuthDeadLetter) {
            resolveHistoricalSmtpDeadLetter(db, job, now, smtpRepairedAfter);
            autoFixes.push({ type: 'outbox_dead_letter_resolved', outbox_id: job.outbox_id, job_type: job.job_type, reason: 'historical_smtp_auth_after_repair' });
          }
        }
        if (autoFix && stuckProcessing.length > 0) {
          for (const job of stuckProcessing) {
            db.prepare("UPDATE outbox_jobs SET status = 'pending', last_attempt_at = NULL WHERE outbox_id = ?").run(job.outbox_id);
            db.prepare(`
              INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id,
                old_value, new_value, source, agent_name, created_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              makeId('EVT'), 'outbox_processing_requeued', null, 'outbox', job.outbox_id,
              'processing', 'pending', TOOL, 'monitor-check', now,
              JSON.stringify({ reason: 'stuck_processing_auto_fix', timeout_minutes: processingTimeoutMinutes })
            );
            autoFixes.push({ type: 'outbox_requeued', outbox_id: job.outbox_id, job_type: job.job_type });
          }
        }
      }

      // --- DEPLOYMENT CHECK ---
      // A preview/production deployment is recorded 'running' by the executors and
      // is meant to be closed out by deploy-wait. Nothing else reconciles leftovers,
      // so an abandoned run (executor died, wait skipped) would sit 'running' forever
      // and leave its task hanging. Detect those and, with --auto-fix, time them out.
      if (checkDeployments) {
        const running = db.prepare("SELECT * FROM deployments WHERE status = 'running'").all();
        const failThreshold = new Date(nowMs - deployTimeoutMinutes * 60 * 1000).toISOString();
        const stuck = running.filter(d => (d.started_at || '') < failThreshold);

        const severity = stuck.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'deployments',
          status: severity,
          message: `${running.length} running, ${stuck.length} stuck (>${deployTimeoutMinutes}m)`,
          details: {
            running: running.length,
            stuck: stuck.length,
            stuck_deployments: stuck.map(d => ({ deployment_id: d.deployment_id, task_id: d.task_id, started_at: d.started_at })),
          },
        });

        // Auto-fix: time out abandoned 'running' deployments so the row and its
        // task stop hanging and the stall becomes visible as an event.
        if (autoFix && stuck.length > 0) {
          for (const dep of stuck) {
            db.prepare("UPDATE deployments SET status = 'timeout', finished_at = ? WHERE deployment_id = ?").run(now, dep.deployment_id);
            db.prepare(`
              INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id,
                old_value, new_value, source, agent_name, created_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              makeId('EVT'), 'deployment_auto_timeout', dep.task_id, 'deployment', dep.deployment_id,
              'running', 'timeout', TOOL, 'monitor-check', now,
              JSON.stringify({ reason: 'running_past_timeout_auto_fix', timeout_minutes: deployTimeoutMinutes })
            );
            autoFixes.push({ type: 'deployment_timed_out', deployment_id: dep.deployment_id, task_id: dep.task_id });
          }
        }
      }

      // --- WATCHLIST CHECK ---
      // 'monitored' tasks are an investigation watchlist with no natural exit, so
      // they accumulate forever. Age out stale ones (no update in N days) so the
      // queue reflects live work. Conservative default (60d) and event-logged.
      if (checkWatchlist) {
        const monitored = db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'monitored'").get();
        const expireThreshold = new Date(nowMs - expireMonitoredDays * 24 * 60 * 60 * 1000).toISOString();
        const expirable = db.prepare(
          "SELECT task_id, title FROM tasks WHERE status = 'monitored' AND COALESCE(updated_at, created_at) < ?"
        ).all(expireThreshold);

        const severity = expirable.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'watchlist',
          status: severity,
          message: `${monitored.cnt} monitored, ${expirable.length} stale (>${expireMonitoredDays}d)`,
          details: { monitored: monitored.cnt, expirable: expirable.length },
        });

        // Auto-fix: cancel watchlist items that have sat untouched past the window.
        if (autoFix && expirable.length > 0) {
          for (const t of expirable) {
            db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE task_id = ?").run(now, t.task_id);
            db.prepare(`
              INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id,
                old_value, new_value, source, agent_name, created_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              makeId('EVT'), 'task_watchlist_expired', t.task_id, 'task', t.task_id,
              'monitored', 'cancelled', TOOL, 'monitor-check', now,
              JSON.stringify({ reason: 'monitored_past_expiry_auto_fix', expire_days: expireMonitoredDays })
            );
            autoFixes.push({ type: 'watchlist_expired', task_id: t.task_id });
          }
        }
      }

      // --- DISK CHECK ---
      if (checkDisk) {
        const resolvedDbPath = path.resolve(dbPath);
        let dbSizeMb = 0;
        try {
          const stats = fs.statSync(resolvedDbPath);
          dbSizeMb = Math.round(stats.size / 1024 / 1024 * 100) / 100;
        } catch { /* file may not exist yet */ }

        const severity = dbSizeMb > 500 ? 'critical' : dbSizeMb > 100 ? 'warning' : 'ok';
        checks.push({
          check: 'disk',
          status: severity,
          message: `DB size: ${dbSizeMb} MB`,
          details: { db_path: resolvedDbPath, db_size_mb: dbSizeMb },
        });
      }

      // --- DB HEALTH CHECK ---
      if (checkDbHealth) {
        let integrity = 'unknown';
        try {
          const result = db.prepare('PRAGMA integrity_check').get();
          integrity = result['integrity_check'] || result[Object.keys(result)[0]] || 'unknown';
        } catch (e) {
          integrity = `error: ${e.message}`;
        }

        const tableCount = db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get();
        const severity = integrity === 'ok' ? 'ok' : 'critical';

        checks.push({
          check: 'db_health',
          status: severity,
          message: `Integrity: ${integrity}, ${tableCount.cnt} tables`,
          details: { integrity, table_count: tableCount.cnt },
        });
      }

      // --- AUTHORITATIVE DB PATH CHECK ---
      if (checkAuthoritativeDbPath) {
        const canonical = '/opt/website-state/website-agent.db';
        const activePath = String(dbPath || '').replace(/\\/g, '/');
        const phantomFiles = findPhantomDbFiles([
          process.cwd(),
          process.env.WEBSITE_AGENT_ROOT,
          os.tmpdir(),
        ]);
        const canonicalActive = activePath === canonical;
        const severity = canonicalActive && phantomFiles.length === 0 ? 'ok' : 'critical';
        checks.push({
          check: 'authoritative_db_path',
          status: severity,
          message: severity === 'ok'
            ? 'Active DB path is canonical and no phantom DB files were found'
            : `Active DB path is ${activePath}; phantom DB files found: ${phantomFiles.length}`,
          details: {
            db_path: activePath,
            canonical,
            canonical_active: canonicalActive,
            phantom_files: phantomFiles,
          },
        });
      }

      // --- SELF-IMPROVEMENT BACKLOG CHECK ---
      if (checkSelfImprovementBacklog) {
        const staleThreshold = new Date(nowMs - 90 * 60 * 1000).toISOString();
        const typeList = [...SELF_IMPROVEMENT_TYPES];
        const placeholders = typeList.map(() => '?').join(',');
        const selfImprovement = db.prepare(`
          SELECT task_id, title, created_at, updated_at,
                 json_extract(metadata_json, '$.task_type') AS task_type,
                 'self_improvement' AS backlog_kind
          FROM tasks
          WHERE status = 'approved'
            AND COALESCE(updated_at, created_at) < ?
            AND json_extract(metadata_json, '$.task_type') IN (${placeholders})
          ORDER BY COALESCE(updated_at, created_at) ASC
        `).all(staleThreshold, ...typeList);
        const substrateText = `LOWER(COALESCE(target_file, '') || ' ' || COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(metadata_json, ''))`;
        const legacyAuditor = db.prepare(`
          SELECT task_id, title, created_at, updated_at,
                 json_extract(metadata_json, '$.task_type') AS task_type,
                 'legacy_auditor_substrate' AS backlog_kind
          FROM tasks
          WHERE status = 'approved'
            AND source = 'auditor'
            AND risk_level = 'safe'
            AND COALESCE(updated_at, created_at) < ?
            AND COALESCE(json_extract(metadata_json, '$.task_type'), '') = 'general_operational'
            AND (
              ${substrateText} LIKE '%/opt/website-agent/%'
              OR ${substrateText} LIKE '% cli/%'
              OR ${substrateText} LIKE '% cron/%'
              OR ${substrateText} LIKE '% processes/%'
              OR ${substrateText} LIKE '%hermes/skills/client/%'
              OR ${substrateText} LIKE '%substrate%'
              OR ${substrateText} LIKE '%recovery%'
              OR ${substrateText} LIKE '%worker%'
              OR ${substrateText} LIKE '%pipeline%'
              OR ${substrateText} LIKE '%feedback%'
              OR ${substrateText} LIKE '%smtp%'
              OR ${substrateText} LIKE '%auth%'
            )
          ORDER BY COALESCE(updated_at, created_at) ASC
        `).all(staleThreshold);
        const stale = [...selfImprovement, ...legacyAuditor]
          .sort((a, b) => String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || '')));
        const severity = stale.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'self_improvement_backlog',
          status: severity,
          message: `${stale.length} approved self-improvement/legacy auditor substrate tasks older than 90m`,
          details: {
            stale_approved: stale.length,
            self_improvement_stale: selfImprovement.length,
            legacy_auditor_substrate_stale: legacyAuditor.length,
            stale_threshold: staleThreshold,
            tasks: stale,
          },
        });
      }

      // --- SELF-IMPROVEMENT WORKER CHECK ---
      if (checkSelfImprovementWorker) {
        const heartbeat = db.prepare("SELECT * FROM heartbeats WHERE job_name = 'self-improvement'").get();
        const staleThreshold = new Date(nowMs - staleMinutes * 60 * 1000).toISOString();
        const stale = !heartbeat || (heartbeat.heartbeat_at || '') < staleThreshold;
        const severity = stale ? 'warning' : 'ok';
        checks.push({
          check: 'self_improvement_worker',
          status: severity,
          message: heartbeat
            ? `self-improvement heartbeat ${stale ? 'stale' : 'fresh'} (${heartbeat.heartbeat_at})`
            : 'self-improvement heartbeat missing',
          details: {
            job_name: 'self-improvement',
            heartbeat_at: heartbeat ? heartbeat.heartbeat_at : null,
            status: heartbeat ? heartbeat.status : null,
            stale_threshold: staleThreshold,
          },
        });
      }

      // --- BLOG CLOUDFLARE CREDENTIAL BLOCKER CHECK ---
      // run-blog-pipeline parks approved blog/content work as status='blocked'
      // when the Cloudflare API reports auth code 10000. Expose those parked
      // tasks explicitly so monitor output tells the human what credential repair
      // is needed, without treating the content as complete/live.
      if (checkBlogCredentialBlockers) {
        const blockers = db.prepare(`
          SELECT task_id, title, status, updated_at, target_url, target_file, target_keyword,
                 completed_at,
                 json_extract(metadata_json, '$.evidence.cloudflare_credential_blocker.kind') AS blocker_kind,
                 json_extract(metadata_json, '$.evidence.cloudflare_credential_blocker.repair_task_id') AS repair_task_id,
                 json_extract(metadata_json, '$.evidence.cloudflare_credential_blocker.human_action') AS human_action,
                 json_extract(metadata_json, '$.evidence.cloudflare_credential_blocker.content_live') AS content_live
          FROM tasks
          WHERE status = 'blocked'
            AND (
              metadata_json LIKE '%cloudflare-credential-blocker%'
              OR json_extract(metadata_json, '$.evidence.cloudflare_credential_blocker.kind') IS NOT NULL
            )
          ORDER BY COALESCE(updated_at, created_at) ASC
        `).all();
        const severity = blockers.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'blog_credential_blockers',
          status: severity,
          message: blockers.length > 0
            ? `${blockers.length} blog/content task(s) parked for Cloudflare credential repair`
            : '0 parked blog/content Cloudflare credential blockers',
          details: {
            blocked_tasks: blockers.length,
            human_action: blockers.length > 0
              ? 'Repair Cloudflare API token/account/project access for example.com, then move parked blog/content tasks back to approved.'
              : null,
            tasks: blockers.map((task) => ({
              task_id: task.task_id,
              title: task.title,
              status: task.status,
              updated_at: task.updated_at,
              target_url: task.target_url,
              target_file: task.target_file,
              target_keyword: task.target_keyword,
              blocker_kind: task.blocker_kind || 'cloudflare_auth_code_10000',
              repair_task_id: task.repair_task_id || null,
              human_action: task.human_action || null,
              content_live: Boolean(task.content_live) && task.content_live !== 'false',
              completed_at: task.completed_at || null,
            })),
          },
        });
      }

      // --- STALE PRODUCTION 404 CHECK ---
      // Completed content tasks must not stay closed when a main-push deployment is
      // older than the deploy window but the live clean target URL still returns
      // 404. This catches the recurring failure where AI review accepted origin/main
      // evidence while production remained stale and Cloudflare project mapping was
      // unavailable.
      if (checkStaleProduction) {
        const candidates = findCompletedMainPushCandidates(db, nowMs, deployWindowMinutes, numberArg(args, 'stale-production-limit', 20));
        const checked = [];
        const stale = [];
        for (const candidate of candidates) {
          const live = await fetchLiveCleanStatus(candidate.target_url);
          const item = { ...candidate, live };
          checked.push(item);
          if (live.http_status === 404) stale.push(item);
        }
        const severity = stale.length > 0 ? 'critical' : 'ok';
        checks.push({
          check: 'stale_production_404',
          status: severity,
          message: stale.length > 0
            ? `${stale.length} completed main-push task(s) still return live HTTP 404 after ${deployWindowMinutes}m deploy window`
            : `0 completed main-push tasks with live clean URL 404 after ${deployWindowMinutes}m deploy window`,
          details: {
            deploy_window_minutes: deployWindowMinutes,
            checked_candidates: checked.length,
            stale_tasks: stale.length,
            human_action: stale.length > 0
              ? 'Reopen/retry these tasks and verify Cloudflare Pages production deployment. If Cloudflare credentials/project mapping are missing, set CLOUDFLARE_PROJECT_NAME to the actual example.com Pages project or grant API access to list deployments/custom domains; do not leave completed tasks live-404 after the deploy window.'
              : null,
            tasks: stale.map((task) => ({
              task_id: task.task_id,
              title: task.title,
              target_url: task.target_url,
              clean_url: task.live.clean_url,
              http_status: task.live.http_status,
              deployment_id: task.deployment_id,
              commit_sha: task.commit_sha,
              deployment_started_at: task.deployment_started_at,
              deployment_age_minutes: task.deployment_age_minutes,
              deployment_status: task.deployment_status,
              validation_status: task.validation_status,
              cloudflare_status_path_present: task.cloudflare_status_path_present,
              human_action: task.cloudflare_status_path_present
                ? 'Live URL is 404 after the deploy window; retry/inspect Cloudflare Pages production deployment before considering task complete.'
                : 'Cloudflare deployment status/project mapping is missing and live URL is 404 after the deploy window; repair CLOUDFLARE_PROJECT_NAME/API access or verified deploy hook/status path, then rerun validation.',
            })),
            checked: checked.map((task) => ({
              task_id: task.task_id,
              target_url: task.target_url,
              http_status: task.live.http_status,
              deployment_id: task.deployment_id,
            })),
          },
        });
      }

      // Determine overall status
      const severities = checks.map(c => c.status);
      const overallStatus = severities.includes('critical') ? 'critical'
        : severities.includes('warning') ? 'warning' : 'ok';

      // Create / update alerts for failures (dedup by alert_type)
      if (alertOnFailure) {
        alertsCreated = upsertFailedCheckAlerts(db, checks, now);
        resolveOkCheckAlerts(db, checks, now);
      }

      // Queue email for critical issues if requested (used by cron run-monitor.sh)
      let emailAlertsQueued = 0;
      if (boolArg(args, 'email-on-critical') && overallStatus === 'critical') {
        if (!alertOnFailure) {
          alertsCreated = upsertFailedCheckAlerts(db, checks, now);
          resolveOkCheckAlerts(db, checks, now);
        }
        const renotifyHours = numberArg(args, 'renotify-hours', Number(process.env.MONITOR_RENOTIFY_HOURS) || 24);
        emailAlertsQueued = queueCriticalAlertEmails(db, checks, now, renotifyHours);
      }

      printOutput(envelope({
        overall_status: overallStatus,
        checks,
        auto_fixes: autoFixes,
        alerts_created: alertsCreated,
        email_sent: emailAlertsQueued > 0,
        email_alerts_queued: emailAlertsQueued,
        checked_at: now,
      }, { tool: TOOL }), getOutputFormat(args));
    } finally {
      db.close();
    }

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};


function findCompletedMainPushCandidates(db, nowMs, deployWindowMinutes, limit) {
  const cutoff = new Date(nowMs - deployWindowMinutes * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT t.task_id, t.title, t.target_url, t.completed_at,
           d.deployment_id, d.commit_sha, d.started_at AS deployment_started_at,
           d.status AS deployment_status, d.validation_status,
           d.cloudflare_deployment_id, d.production_url
    FROM tasks t
    JOIN deployments d ON d.task_id = t.task_id
    WHERE t.status = 'completed'
      AND t.target_url IS NOT NULL
      AND t.target_url != ''
      AND d.branch_name = 'main'
      AND d.started_at IS NOT NULL
      AND d.started_at < ?
      AND d.deployment_id = (
        SELECT dd.deployment_id
        FROM deployments dd
        WHERE dd.task_id = t.task_id
          AND dd.branch_name = 'main'
          AND dd.started_at IS NOT NULL
        ORDER BY dd.started_at DESC
        LIMIT 1
      )
    ORDER BY d.started_at DESC
    LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}
  `).all(cutoff);
  return rows.map((row) => ({
    task_id: row.task_id,
    title: row.title,
    target_url: stripQueryAndHash(row.target_url),
    completed_at: row.completed_at || null,
    deployment_id: row.deployment_id,
    commit_sha: row.commit_sha || null,
    deployment_started_at: row.deployment_started_at,
    deployment_age_minutes: minutesSince(row.deployment_started_at, nowMs),
    deployment_status: row.deployment_status || null,
    validation_status: row.validation_status || null,
    cloudflare_status_path_present: Boolean(row.cloudflare_deployment_id || row.production_url),
  }));
}

async function fetchLiveCleanStatus(rawUrl) {
  const cleanUrl = stripQueryAndHash(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const startMs = Date.now();
  try {
    const response = await fetch(cleanUrl, { redirect: 'follow', signal: controller.signal });
    return {
      clean_url: cleanUrl,
      http_status: response.status,
      response_time_ms: Date.now() - startMs,
      error: null,
    };
  } catch (error) {
    return {
      clean_url: cleanUrl,
      http_status: 0,
      response_time_ms: Date.now() - startMs,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stripQueryAndHash(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(rawUrl || '').split('#')[0].split('?')[0].replace(/\/$/, '');
  }
}

function minutesSince(startIso, nowMs) {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.round((nowMs - start) / 60000));
}

function repairCutoffForOutbox(db, args = {}) {
  if (args['smtp-repaired-after']) return String(args['smtp-repaired-after']);
  const emailTypes = sqlList(OUTBOX_EMAIL_JOB_TYPES);
  const successJob = db.prepare(`
    SELECT MAX(COALESCE(completed_at, last_attempt_at, created_at)) AS repaired_after
    FROM outbox_jobs
    WHERE job_type IN (${emailTypes})
      AND status IN ('completed', 'sent')
  `).get();
  const successEvent = db.prepare(`
    SELECT MAX(created_at) AS repaired_after
    FROM events
    WHERE event_type = 'email_outbox_sent'
  `).get();
  const candidates = [successJob && successJob.repaired_after, successEvent && successEvent.repaired_after]
    .filter(Boolean)
    .sort();
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function findStaleRunningCronRuns(db, now, staleMinutes) {
  const cutoff = new Date(new Date(now).getTime() - staleMinutes * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT c.cron_run_id, c.job_name, c.started_at, c.error_summary,
           h.status AS heartbeat_status, h.heartbeat_at
    FROM cron_runs c
    LEFT JOIN heartbeats h ON h.job_name = c.job_name
    WHERE c.status = 'running'
      AND c.started_at IS NOT NULL
      AND c.started_at < ?
    ORDER BY c.started_at ASC
  `).all(cutoff);

  const preservedByJob = new Map();
  return rows.filter((row) => {
    if (!preservedByJob.has(row.job_name)) {
      preservedByJob.set(row.job_name, runningCronRunToPreserve(db, row.job_name, now));
    }
    const preservedRunId = preservedByJob.get(row.job_name);
    row.preserved_active_run_id = preservedRunId || null;
    return !preservedRunId || row.cron_run_id !== preservedRunId;
  });
}

function isHistoricalSmtpAuthDeadLetter(job, smtpRepairedAfter) {
  if (!smtpRepairedAfter) return false;
  if (!OUTBOX_EMAIL_JOB_TYPES.includes(job.job_type)) return false;
  if (!isSmtpAuthFailure(job.error_message)) return false;
  const jobAt = job.last_attempt_at || job.created_at || '';
  return Boolean(jobAt) && jobAt < smtpRepairedAfter;
}

function resolveHistoricalSmtpDeadLetter(db, job, now, smtpRepairedAfter) {
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE outbox_jobs
      SET status = 'resolved', completed_at = ?, error_message = NULL
      WHERE outbox_id = ? AND status = 'dead_letter'
    `).run(now, job.outbox_id);
    if (job.job_type === 'send_monitor_alert' && job.entity_id) {
      db.prepare(`
        UPDATE monitor_alerts
        SET status = 'resolved', resolved_at = ?,
            resolution_note = 'Auto-resolved: stale SMTP-auth outbox dead letter after SMTP repair'
        WHERE alert_id = ? AND status = 'open'
      `).run(now, job.entity_id);
    }
    db.prepare(`
      INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId('EVT'), 'outbox_dead_letter_resolved', job.entity_id || null,
      'outbox', job.outbox_id, 'dead_letter', 'resolved', TOOL, 'monitor-check', now,
      JSON.stringify({ reason: 'historical_smtp_auth_after_repair', smtp_repaired_after: smtpRepairedAfter })
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function upsertFailedCheckAlerts(db, checks, now) {
  let changed = 0;
  const failedChecks = checks.filter(c => c.status !== 'ok');
  for (const check of failedChecks) {
    const alertType = `health_check_${check.check}`;
    const existing = db.prepare(
      "SELECT alert_id, occurrence_count, last_notified_at FROM monitor_alerts WHERE alert_type = ? AND status = 'open' LIMIT 1"
    ).get(alertType);

    if (existing) {
      db.prepare(`
        UPDATE monitor_alerts
        SET severity = ?, message = ?, last_seen_at = ?,
            occurrence_count = COALESCE(occurrence_count, 1) + 1,
            metadata_json = ?
        WHERE alert_id = ?
      `).run(
        check.status, check.message, now,
        JSON.stringify(check.details),
        existing.alert_id
      );
      check.alert_id = existing.alert_id;
      check.alert_is_new = false;
      check.last_notified_at = existing.last_notified_at || null;
    } else {
      const alertId = makeId('ALT');
      db.prepare(`
        INSERT INTO monitor_alerts (alert_id, alert_type, severity, status, message, triggered_at, last_seen_at, occurrence_count, metadata_json)
        VALUES (?, ?, ?, 'open', ?, ?, ?, 1, ?)
      `).run(
        alertId, alertType, check.status, check.message, now, now,
        JSON.stringify(check.details)
      );
      check.alert_id = alertId;
      check.alert_is_new = true;
      check.last_notified_at = null;
    }
    changed++;
  }
  return changed;
}

function resolveOkCheckAlerts(db, checks, now) {
  const okChecks = checks.filter(c => c.status === 'ok');
  for (const check of okChecks) {
    const alertType = `health_check_${check.check}`;
    db.prepare(`
      UPDATE monitor_alerts
      SET status = 'resolved', resolved_at = ?,
          resolution_note = 'Auto-resolved: check passed'
      WHERE alert_type = ? AND status = 'open'
    `).run(now, alertType);
  }
}

function queueCriticalAlertEmails(db, checks, now, renotifyHours = 24) {
  let queued = 0;
  const criticalChecks = checks.filter(c => c.status === 'critical');
  for (const check of criticalChecks) {
    if (!check.alert_id) continue;
    if (!shouldNotifyAlert({
      isNew: check.alert_is_new,
      lastNotifiedAt: check.last_notified_at,
      now,
      renotifyHours,
    })) continue;
    if (hasPendingMonitorAlertJob(db, check.alert_id)) continue;

    const alertType = `health_check_${check.check}`;
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'send_monitor_alert', 'monitor_alert', ?, ?, 'pending', ?)
    `).run(
      makeId('OUT'),
      check.alert_id,
      JSON.stringify({
        alert_id: check.alert_id,
        alert_type: alertType,
        severity: check.status,
        message: check.message,
        details: check.details,
        triggered_at: now,
      }),
      now,
    );
    db.prepare("UPDATE monitor_alerts SET last_notified_at = ? WHERE alert_id = ?").run(now, check.alert_id);
    check.last_notified_at = now;
    queued++;
  }
  return queued;
}

function shouldNotifyAlert({ isNew, lastNotifiedAt, now, renotifyHours = 24 }) {
  if (isNew) return true;
  if (!lastNotifiedAt) return true;
  const elapsedMs = Date.parse(now) - Date.parse(lastNotifiedAt);
  if (!Number.isFinite(elapsedMs)) return true;
  return elapsedMs >= Number(renotifyHours || 24) * 60 * 60 * 1000;
}

function hasPendingMonitorAlertJob(db, alertId) {
  const row = db.prepare(`
    SELECT 1 AS present
    FROM outbox_jobs
    WHERE job_type = 'send_monitor_alert'
      AND entity_type = 'monitor_alert'
      AND entity_id = ?
      AND status IN (${sqlList(OUTBOX_RETRYABLE)})
    LIMIT 1
  `).get(alertId);
  return Boolean(row);
}

function findPhantomDbFiles(candidateDirs) {
  const found = [];
  const seen = new Set();
  for (const dir of candidateDirs.filter(Boolean)) {
    const resolved = path.resolve(String(dir));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let entries = [];
    try {
      entries = fs.readdirSync(resolved);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('\\opt') || entry.startsWith('\\\\opt')) {
        found.push(path.join(resolved, entry));
      }
    }
  }
  return found;
}

module.exports = Object.assign(module.exports, {
  upsertFailedCheckAlerts,
  resolveOkCheckAlerts,
  queueCriticalAlertEmails,
  shouldNotifyAlert,
  repairCutoffForOutbox,
  isHistoricalSmtpAuthDeadLetter,
  resolveHistoricalSmtpDeadLetter,
  findStaleRunningCronRuns,
  findPhantomDbFiles,
  findCompletedMainPushCandidates,
  fetchLiveCleanStatus,
});

if (require.main === module) {
  Promise.resolve(module.exports()).catch((error) => {
    printOutput(errorEnvelope(error, { tool: TOOL }), 'json');
    process.exitCode = 1;
  });
}
