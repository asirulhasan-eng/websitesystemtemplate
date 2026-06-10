/**
 * monitor-check.js â€” System health checks
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
const path = require('node:path');
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const TOOL = 'monitor-check';

const HELP = `
monitor-check â€” System health checks

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

ACTIONS
  --alert-on-failure   Create monitor_alerts rows for any failures found
  --email-on-critical  Queue retryable email notification for critical severity issues
  --auto-fix           Automatically fix issues:
                       â€¢ Release stale/expired locks
                       â€¢ Re-queue outbox jobs orphaned in 'processing'
                       â€¢ Time out abandoned 'running' deployments

OPTIONS
  --stale-minutes    Minutes before a heartbeat is considered stale (default: 30)
  --outbox-processing-timeout-minutes  Minutes before a 'processing' outbox job is
                     treated as orphaned and re-queued (default: 30)
  --outbox-lag-minutes  Oldest-undrained-job age that flags the outbox as lagging
                     (default: 60)
  --db               SQLite database path (or CLIENT_DB_PATH env var)
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
  ok        â€” Check passed, no issues
  warning   â€” Non-critical issue detected
  critical  â€” Immediate attention required
`.trim();

module.exports = function monitorCheck() {
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
      const alertOnFailure = boolArg(args, 'alert-on-failure');
      const autoFix = boolArg(args, 'auto-fix');

      // Determine which checks to run
      const specificChecks = args.heartbeats || args.locks || args.outbox || args.disk || args['db-health'] || args.deployments;
      const runAll = boolArg(args, 'full') || !specificChecks;
      const checkHB = runAll || boolArg(args, 'heartbeats');
      const checkLocks = runAll || boolArg(args, 'locks');
      const checkOutbox = runAll || boolArg(args, 'outbox');
      const checkDeployments = runAll || boolArg(args, 'deployments');
      const checkDisk = runAll || boolArg(args, 'disk');
      const checkDbHealth = runAll || boolArg(args, 'db-health');
      const checkWatchlist = runAll || boolArg(args, 'watchlist');
      const deployTimeoutMinutes = numberArg(args, 'deploy-timeout-minutes', 30);
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

        const severity = staleJobs.length > 0 ? 'warning' : 'ok';
        checks.push({
          check: 'heartbeats',
          status: severity,
          message: `${heartbeats.length} jobs tracked, ${staleJobs.length} stale`,
          details: {
            total: heartbeats.length,
            running: heartbeats.filter(h => h.status === 'running').length,
            stale: staleJobs.length,
            stale_jobs: staleJobs.map(h => h.job_name),
          },
        });
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
      // The outbox workers cycle a job through pending → processing → completed |
      // retrying | dead_letter. The old check watched for `status='pending' AND
      // attempt_count>=3` and `status='failed'` — states the workers never write —
      // so it silently always reported healthy. This checks the states that
      // actually occur: dead_letter (gave up), stuck 'processing' (worker died
      // mid-flight; never re-selected by the drainers), and drain lag (oldest
      // undrained job age = is the mirror keeping up).
      if (checkOutbox) {
        const processingTimeoutMinutes = numberArg(args, 'outbox-processing-timeout-minutes', 30);
        const lagThresholdMinutes = numberArg(args, 'outbox-lag-minutes', 60);
        const processingThreshold = new Date(nowMs - processingTimeoutMinutes * 60 * 1000).toISOString();

        const undrained = db.prepare("SELECT COUNT(*) as cnt FROM outbox_jobs WHERE status IN ('pending','retrying')").get();
        const deadLetter = db.prepare("SELECT outbox_id, job_type, attempt_count, error_message FROM outbox_jobs WHERE status = 'dead_letter'").all();
        const stuckProcessing = db.prepare(
          "SELECT outbox_id, job_type, last_attempt_at FROM outbox_jobs WHERE status = 'processing' AND COALESCE(last_attempt_at, created_at) < ?"
        ).all(processingThreshold);
        const oldest = db.prepare(
          "SELECT MIN(created_at) as oldest FROM outbox_jobs WHERE status IN ('pending','retrying')"
        ).get();
        const lagMinutes = oldest && oldest.oldest
          ? Math.round((nowMs - new Date(oldest.oldest).getTime()) / 60000)
          : 0;
        const lagging = lagMinutes > lagThresholdMinutes;

        const severity = (deadLetter.length > 0 || stuckProcessing.length > 0 || lagging) ? 'warning' : 'ok';
        checks.push({
          check: 'outbox',
          status: severity,
          message: `${undrained.cnt} undrained, ${deadLetter.length} dead-letter, ${stuckProcessing.length} stuck-processing, oldest ${lagMinutes}m`,
          details: {
            undrained: undrained.cnt,
            dead_letter: deadLetter.length,
            stuck_processing: stuckProcessing.length,
            oldest_undrained_minutes: lagMinutes,
            lag_threshold_minutes: lagThresholdMinutes,
            dead_letter_jobs: deadLetter.map(j => ({ outbox_id: j.outbox_id, job_type: j.job_type, attempts: j.attempt_count, error: j.error_message })),
            stuck_processing_jobs: stuckProcessing.map(j => ({ outbox_id: j.outbox_id, job_type: j.job_type, last_attempt_at: j.last_attempt_at })),
          },
        });

        // Auto-fix: re-queue jobs orphaned in 'processing' (a worker died between
        // marking processing and committing the result). dead_letter is left as a
        // visible warning — it has already exhausted its retry budget, so silently
        // recycling it would just churn; it needs human/Hermes attention.
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

      // Determine overall status
      const severities = checks.map(c => c.status);
      const overallStatus = severities.includes('critical') ? 'critical'
        : severities.includes('warning') ? 'warning' : 'ok';

      // Create / update alerts for failures (dedup by alert_type)
      if (alertOnFailure) {
        const failedChecks = checks.filter(c => c.status !== 'ok');
        for (const check of failedChecks) {
          const alertType = `health_check_${check.check}`;
          const existing = db.prepare(
            "SELECT alert_id, occurrence_count FROM monitor_alerts WHERE alert_type = ? AND status = 'open' LIMIT 1"
          ).get(alertType);

          if (existing) {
            // Update existing open alert: bump count, refresh timestamps & message
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
          } else {
            // Insert new alert with occurrence tracking fields
            const alertId = makeId('ALT');
            db.prepare(`
              INSERT INTO monitor_alerts (alert_id, alert_type, severity, status, message, triggered_at, last_seen_at, occurrence_count, metadata_json)
              VALUES (?, ?, ?, 'open', ?, ?, ?, 1, ?)
            `).run(
              alertId, alertType, check.status, check.message, now, now,
              JSON.stringify(check.details)
            );
            check.alert_id = alertId;
          }
          alertsCreated++;
        }

        // Auto-resolve: checks that are now OK should close any lingering open alerts
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

      // Queue email for critical issues if requested (used by cron run-monitor.sh)
      let emailAlertsQueued = 0;
      if (boolArg(args, 'email-on-critical') && overallStatus === 'critical') {
        const criticalChecks = checks.filter(c => c.status === 'critical');
        for (const check of criticalChecks) {
          const outboxId = makeId('OUT');
          db.prepare(`
            INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
            VALUES (?, 'send_monitor_alert', 'monitor_alert', ?, ?, 'pending', ?)
          `).run(
            outboxId,
            check.alert_id || `health_check_${check.check}`,
            JSON.stringify({
              alert_id: check.alert_id || null,
              alert_type: `health_check_${check.check}`,
              severity: check.status,
              message: check.message,
              details: check.details,
              triggered_at: now,
            }),
            now,
          );
          emailAlertsQueued++;
        }
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

if (require.main === module) {
  module.exports();
}
