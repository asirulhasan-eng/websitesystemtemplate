#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, numberArg, exitWithError } = require("../lib/cli");
const { loadToolEnv } = require("../lib/env");
const { compactDateTime, nowIso } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const { sendSmtpMail } = require("../lib/smtp");
const { smtpCredentials } = require("../lib/email_credentials");
const git = require("../lib/git");
const {
  OUTBOX_RETRYABLE,
  OUTBOX_EMAIL_JOB_TYPES,
  isSmtpAuthFailure,
  sqlList,
} = require("../lib/outbox_states");

const DEFAULT_TO = "owner@example.com";

// Addresses that should always be rewritten to DEFAULT_TO. Empty in the neutral
// template (no carried-over identities); populate per-client only if you migrate
// off a previously hardcoded address and want stragglers redirected.
const LEGACY_ADMIN_RECIPIENTS = new Set([]);

function normalizeRecipient(value) {
  const to = String(value || DEFAULT_TO).trim();
  return LEGACY_ADMIN_RECIPIENTS.has(to.toLowerCase()) ? DEFAULT_TO : to;
}

// An address still carrying an unfilled {{TOKEN}} (e.g. customize.ps1 never set
// ADMIN_EMAIL) is not a real mailbox. Detect it so the job fails with a clear
// reason and dead-letters, instead of handing SMTP a literal token and emitting
// a confusing transport error.
function hasUnfilledToken(value) {
  return /\{\{[^}]+\}\}/.test(String(value || ""));
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadToolEnv({ envPath: args.env });
  const db = openStateDb(args.db || process.env.WEBSITE_AGENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/website-state/website-agent.db");
  const limit = numberArg(args, "limit", 20);
  const dryRun = Boolean(args["dry-run"]);
  const reconciliation = args["reconcile-smtp-auth-dead-letters"]
    ? reconcileSmtpAuthDeadLetters(db, args, dryRun)
    : { eligible: 0, changed: 0, results: [] };
  const jobs = args["reconcile-only"] ? [] : db
    .prepare(
      `
        SELECT *
        FROM outbox_jobs
        WHERE status IN (${sqlList(OUTBOX_RETRYABLE)})
          AND job_type IN (${sqlList(OUTBOX_EMAIL_JOB_TYPES)})
        ORDER BY created_at ASC
        LIMIT ?
      `,
    )
    .all(limit);

  const results = [];
  for (const job of jobs) {
    results.push(await processEmailJob(db, config, job, args, dryRun));
  }
  db.close();

  const output = {
    generated_at: nowIso(),
    tool: "send_email_outbox",
    dry_run: dryRun,
    reconciliation,
    processed: results.length,
    results,
  };
  const outPath = args.out || (results.length > 0
    ? path.join(process.cwd(), "tools", "out", "email", `email-outbox-${compactDateTime()}.json`)
    : null);
  output.report_path = outPath;
  if (outPath) writeJson(outPath, output);

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${dryRun ? "Dry-ran" : "Processed"} ${results.length} email outbox jobs${outPath ? `; report: ${outPath}` : "; no report written"}`);
    for (const result of results) console.log([result.status, result.outbox_id, result.to, result.subject].join(" | "));
  }
}

function reconcileSmtpAuthDeadLetters(db, args = {}, dryRun = false) {
  const action = String(args["reconcile-action"] || "resolved").toLowerCase();
  if (!new Set(["resolved", "retry"]).has(action)) {
    throw new Error("--reconcile-action must be 'resolved' or 'retry'");
  }
  const smtpRepairedAfter = args["smtp-repaired-after"]
    ? String(args["smtp-repaired-after"])
    : latestSuccessfulEmailAt(db);
  const jobs = db.prepare(`
    SELECT outbox_id, job_type, entity_type, entity_id, payload_json, status,
           attempt_count, last_attempt_at, created_at, error_message
    FROM outbox_jobs
    WHERE status = 'dead_letter'
      AND job_type IN (${sqlList(OUTBOX_EMAIL_JOB_TYPES)})
    ORDER BY created_at ASC
  `).all();
  const eligible = jobs.filter(job => isHistoricalSmtpAuthDeadLetter(job, smtpRepairedAfter));
  const results = [];
  for (const job of eligible) {
    if (!dryRun) applyDeadLetterReconciliation(db, job, action, smtpRepairedAfter);
    results.push({
      outbox_id: job.outbox_id,
      job_type: job.job_type,
      previous_status: job.status,
      status: dryRun ? `would_${action}` : action === "retry" ? "pending" : "resolved",
      smtp_repaired_after: smtpRepairedAfter,
    });
  }
  return {
    enabled: true,
    action,
    smtp_repaired_after: smtpRepairedAfter,
    eligible: eligible.length,
    changed: dryRun ? 0 : eligible.length,
    results,
  };
}

function latestSuccessfulEmailAt(db) {
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

function isHistoricalSmtpAuthDeadLetter(job, smtpRepairedAfter) {
  if (!smtpRepairedAfter) return false;
  if (!isSmtpAuthFailure(job.error_message)) return false;
  const jobAt = job.last_attempt_at || job.created_at || "";
  return Boolean(jobAt) && jobAt < smtpRepairedAfter;
}

function applyDeadLetterReconciliation(db, job, action, smtpRepairedAfter) {
  const now = nowIso();
  const newStatus = action === "retry" ? "pending" : "resolved";
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    if (action === "retry") {
      db.prepare(`
        UPDATE outbox_jobs
        SET status = 'pending', attempt_count = 0, last_attempt_at = NULL,
            next_attempt_at = NULL, error_message = NULL, completed_at = NULL
        WHERE outbox_id = ? AND status = 'dead_letter'
      `).run(job.outbox_id);
    } else {
      db.prepare(`
        UPDATE outbox_jobs
        SET status = 'resolved', completed_at = ?, error_message = NULL
        WHERE outbox_id = ? AND status = 'dead_letter'
      `).run(now, job.outbox_id);
      if (job.job_type === "send_monitor_alert" && job.entity_id) {
        db.prepare(`
          UPDATE monitor_alerts
          SET status = 'resolved', resolved_at = ?,
              resolution_note = 'Auto-resolved: stale SMTP-auth outbox dead letter after SMTP repair'
          WHERE alert_id = ? AND status = 'open'
        `).run(now, job.entity_id);
      }
    }
    db.prepare(
      'INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      makeId('EVT'),
      action === "retry" ? "email_outbox_dead_letter_requeued" : "email_outbox_dead_letter_resolved",
      job.entity_id || null,
      "outbox",
      job.outbox_id,
      "dead_letter",
      newStatus,
      "email_outbox",
      "Email Outbox Sender",
      now,
      JSON.stringify({ reason: "historical_smtp_auth_after_repair", smtp_repaired_after: smtpRepairedAfter }),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function processEmailJob(db, config, job, args, dryRun) {
  const now = nowIso();
  const payload = safeJson(job.payload_json);
  const message = messageForJob(config, job, payload);

  if (dryRun) {
    if (args["complete-dry-run"]) completeJob(db, job, now, { dry_run: true, message });
    return { outbox_id: job.outbox_id, status: args["complete-dry-run"] ? "completed_dry_run" : "dry_run", ...message };
  }

  if (hasUnfilledToken(message.to)) {
    const reason = `Recipient still contains an unfilled template token: ${message.to}. Set ADMIN_EMAIL / run customize.ps1.`;
    const failure = failJob(db, job, reason);
    return { outbox_id: job.outbox_id, status: failure.status, attempts: failure.attempt_count, error: reason, ...message };
  }

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(
      'UPDATE outbox_jobs SET status = ?, last_attempt_at = ? WHERE outbox_id = ?'
    ).run('processing', now, job.outbox_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  try {
    const smtp = smtpCredentials(config);
    await sendSmtpMail({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      pass: smtp.pass,
      from: smtp.from,
      message: {
        fromName: smtp.fromName,
        ...message,
      },
    });
    completeJob(db, job, nowIso(), { message });
    return { outbox_id: job.outbox_id, status: "completed", ...message };
  } catch (error) {
    const failure = failJob(db, job, error.message);
    return { outbox_id: job.outbox_id, status: failure.status, attempts: failure.attempt_count, error: error.message, ...message };
  }
}

function messageForJob(config, job, payload) {
  const defaultTo = normalizeRecipient(payload.to || config.get("EMAIL_TO") || config.get("ALERT_EMAIL_TO") || config.get("SMTP_USER"));

  if (job.job_type === "send_approval_request_email") {
    return {
      to: normalizeRecipient(payload.to || payload.source_email || config.get("APPROVAL_EMAIL_TO") || defaultTo),
      subject: `Approval needed: ${payload.task_id || payload.approval_id}`,
      text: [
        `Approval requested for ${payload.task_id || "task"}.`,
        "",
        `Approval ID: ${payload.approval_id || ""}`,
        `Task ID: ${payload.task_id || ""}`,
        `Task: ${payload.task_title || ""}`,
        `Token: ${payload.approval_token || ""}`,
        "",
        "Reply with:",
        `APPROVE ${payload.task_id || ""} TOKEN ${payload.approval_token || ""}`,
        "",
        "SQLite remains the source of truth.",
      ].join("\n"),
    };
  }

  if (job.job_type === "send_monitor_alert") {
    return {
      to: normalizeRecipient(payload.to || config.get("ALERT_EMAIL_TO") || defaultTo),
      subject: `Website Operations alert: ${payload.alert_type || payload.backup_id || job.entity_id}`,
      text: [
        `Alert: ${payload.alert_type || "system"}`,
        `Severity: ${payload.severity || ""}`,
        `Message: ${payload.message || payload.error || ""}`,
        "",
        JSON.stringify(payload, null, 2),
      ].join("\n"),
    };
  }

  if (job.job_type === "send_preview_email") {
    const github = githubLinksForPayload(config, payload);
    const cloudflarePreviewUrl = firstNonEmpty(
      payload.cloudflare_preview_url,
      payload.cloudflare_url,
      isHttpUrl(payload.preview_url) ? payload.preview_url : null,
    );
    const cloudflareBlogUrl = firstNonEmpty(payload.cloudflare_blog_url, payload.live_blog_url, payload.preview_blog_url);
    const previewReference = payload.preview_url && !isHttpUrl(payload.preview_url) ? payload.preview_url : "";
    return {
      to: normalizeRecipient(payload.to || config.get("APPROVAL_EMAIL_TO") || defaultTo),
      subject: `Preview ready: ${payload.task_id || job.entity_id}`,
      text: [
        `Preview ready for ${payload.task_id || job.entity_id}.`,
        `Task: ${payload.task_title || ""}`,
        "",
        "Clickable review links:",
        `GitHub branch: ${github.branch_url || ""}`,
        `GitHub compare / open PR: ${github.compare_url || ""}`,
        `Cloudflare preview: ${cloudflarePreviewUrl || "Not available yet"}`,
        `Cloudflare blog URL: ${cloudflareBlogUrl || "Not available yet"}`,
        previewReference ? `Preview reference: ${previewReference}` : "",
        "",
        `Branch: ${payload.branch_name || payload.branch || ""}`,
        `Commit: ${payload.commit_sha || ""}`,
        "",
        JSON.stringify(payload, null, 2),
      ].filter((line) => line !== "").join("\n"),
    };
  }

  return {
    to: defaultTo,
    subject: `Website Operations summary: ${payload.date || job.entity_id}`,
    text: payload.text || JSON.stringify(payload, null, 2),
  };
}

function completeJob(db, job, completedAt, metadata) {
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare("UPDATE outbox_jobs SET status = 'completed', completed_at = ?, error_message = NULL WHERE outbox_id = ?").run(
      completedAt,
      job.outbox_id,
    );
    db.prepare(
      `
        INSERT INTO events (
          event_id, event_type, resource_type, resource_id, old_value, new_value,
          source, agent_name, created_at, metadata_json
        ) VALUES (?, 'email_outbox_sent', 'outbox_job', ?, ?, 'completed',
          'email_outbox', 'Email Outbox Sender', ?, ?)
      `,
    ).run(makeId("EVT"), job.outbox_id, job.status, completedAt, JSON.stringify(metadata || {}));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function failJob(db, job, errorMessage) {
  const now = nowIso();
  // Own the attempt counter in the single item-failure path. SMTP failures used
  // to increment before sending, but pre-SMTP validation failures (for example
  // unfilled {{ADMIN_EMAIL}} recipients) reached failJob first and retried
  // forever with attempt_count=0. Increment here for every item failure so each
  // job deterministically retries and then parks in dead_letter without making
  // the whole outbox command fail.
  const newCount = Number(job.attempt_count || 0) + 1;
  const dead = newCount >= 3;
  const newStatus = dead ? 'dead_letter' : 'retrying';
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(
      'UPDATE outbox_jobs SET status = ?, attempt_count = ?, last_attempt_at = ?, error_message = ? WHERE outbox_id = ?'
    ).run(newStatus, newCount, now, errorMessage, job.outbox_id);
    db.prepare(
      'INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(makeId('EVT'), dead ? 'email_outbox_dead_letter' : 'email_outbox_retry', job.entity_id || null, 'outbox', job.outbox_id, job.status, newStatus, 'email_outbox', 'Email Outbox Sender', now, JSON.stringify({ error: errorMessage, attempt: newCount }));
    db.exec('COMMIT');
    return { status: newStatus, attempt_count: newCount };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function githubLinksForPayload(config, payload) {
  const branch = payload.branch_name || payload.branch || "";
  const explicitBranchUrl = firstNonEmpty(payload.github_branch_url, payload.github_url);
  const explicitCompareUrl = firstNonEmpty(payload.github_compare_url, payload.github_pr_url, payload.github_pull_request_url);
  if (explicitBranchUrl || explicitCompareUrl) {
    return { branch_url: explicitBranchUrl, compare_url: explicitCompareUrl };
  }
  if (!branch) return {};

  const repo = repoSlugForPayload(config, payload);
  if (!repo) return {};

  const encodedBranch = encodeGithubRefPath(branch);
  const base = config.get("GITHUB_PR_BASE") || config.get("CLOUDFLARE_PRODUCTION_BRANCH") || "master";
  return {
    branch_url: `https://github.com/${repo}/tree/${encodedBranch}`,
    compare_url: `https://github.com/${repo}/compare/${encodeGithubRefPath(base)}...${encodedBranch}`,
  };
}

function repoSlugForPayload(config, payload) {
  const explicit = firstNonEmpty(payload.github_repo, payload.repo, config.get("GITHUB_REPO"), config.get("SITE_GITHUB_REPO"));
  if (explicit) return normalizeGithubRepo(explicit);
  const siteRoot = config.get("WEBSITE_AGENT_SITE_ROOT") || "/opt/website-site";
  try {
    const repo = git.githubRepo(siteRoot);
    return `${repo.owner}/${repo.repo}`;
  } catch {
    return "";
  }
}

function normalizeGithubRepo(value) {
  const text = String(value || "").trim().replace(/\.git$/i, "");
  const match = text.match(/github\.com[:/]([^/]+)\/(.+)$/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/i, "")}` : text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function encodeGithubRefPath(ref) {
  return String(ref || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function printHelp() {
  console.log(`
Usage:
  node tools/send_email_outbox.js --db tools/out/state/website-agent.db
  node tools/send_email_outbox.js --dry-run --complete-dry-run

Options:
  --db path             SQLite DB path.
  --limit 20            Maximum jobs to process.
  --dry-run             Compose/reconcile but do not send or mutate.
  --complete-dry-run    Mark jobs completed during dry run.
  --reconcile-smtp-auth-dead-letters
                        Reconcile old dead-letter email jobs caused by SMTP auth failures.
  --smtp-repaired-after ISO timestamp; jobs before this cutoff are historical.
                        Defaults to the latest successful email outbox send.
  --reconcile-action resolved|retry (default: resolved).
  --reconcile-only      Reconcile dead letters without sending retryable jobs.
  --out path            JSON report path.
  --json                Print full JSON.
`);
}

if (require.main === module) {
  main().catch(exitWithError);
}

module.exports = Object.assign(main, {
  messageForJob,
  githubLinksForPayload,
  reconcileSmtpAuthDeadLetters,
  latestSuccessfulEmailAt,
  isHistoricalSmtpAuthDeadLetter,
});
