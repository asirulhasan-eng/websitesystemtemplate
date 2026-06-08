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

const DEFAULT_TO = "{{ADMIN_EMAIL}}";
const LEGACY_ADMIN_RECIPIENTS = new Set([
  "admin@{{DOMAIN}}",
  "admin@ppumbingseo.agency",
]);

function normalizeRecipient(value) {
  const to = String(value || DEFAULT_TO).trim();
  return LEGACY_ADMIN_RECIPIENTS.has(to.toLowerCase()) ? DEFAULT_TO : to;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadToolEnv({ envPath: args.env });
  const db = openStateDb(args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db");
  const limit = numberArg(args, "limit", 20);
  const dryRun = Boolean(args["dry-run"]);
  const jobs = db
    .prepare(
      `
        SELECT *
        FROM outbox_jobs
        WHERE status IN ('pending', 'retrying')
          AND job_type IN (
            'send_approval_request_email',
            'send_monitor_alert',
            'send_daily_email_summary',
            'send_preview_email'
          )
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
    processed: results.length,
    results,
  };
  const outPath = args.out || path.join(process.cwd(), "tools", "out", "email", `email-outbox-${compactDateTime()}.json`);
  writeJson(outPath, output);

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${dryRun ? "Dry-ran" : "Processed"} ${results.length} email outbox jobs; report: ${outPath}`);
    for (const result of results) console.log([result.status, result.outbox_id, result.to, result.subject].join(" | "));
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

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(
      'UPDATE outbox_jobs SET status = ?, attempt_count = attempt_count + 1, last_attempt_at = ? WHERE outbox_id = ?'
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
    failJob(db, job, error.message);
    return { outbox_id: job.outbox_id, status: "failed", error: error.message, ...message };
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
      subject: `{{SITE_NAME}} alert: ${payload.alert_type || payload.backup_id || job.entity_id}`,
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
    subject: `{{SITE_NAME}} summary: ${payload.date || job.entity_id}`,
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
  const dead = Number(job.attempt_count || 0) >= 2;
  const newStatus = dead ? 'dead_letter' : 'retrying';
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(
      'UPDATE outbox_jobs SET status = ?, last_attempt_at = ?, error_message = ? WHERE outbox_id = ?'
    ).run(newStatus, now, errorMessage, job.outbox_id);
    db.prepare(
      'INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(makeId('EVT'), dead ? 'email_outbox_dead_letter' : 'email_outbox_retry', job.entity_id || null, 'outbox', job.outbox_id, job.status, newStatus, 'email_outbox', 'Email Outbox Sender', now, JSON.stringify({ error: errorMessage }));
    db.exec('COMMIT');
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
  const siteRoot = config.get("CLIENT_SITE_ROOT") || "/opt/client-site";
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
  node tools/send_email_outbox.js --db tools/out/state/seo-agent.db
  node tools/send_email_outbox.js --dry-run --complete-dry-run

Options:
  --db path             SQLite DB path.
  --limit 20            Maximum jobs to process.
  --dry-run             Compose but do not send.
  --complete-dry-run    Mark jobs completed during dry run.
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
});
