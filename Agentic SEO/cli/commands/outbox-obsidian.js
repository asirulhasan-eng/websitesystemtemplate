#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, numberArg, resolveDbPath, exitWithError } = require("../lib/cli");
const { compactDateTime, nowIso } = require("../lib/dates");
const { slugify, writeJson, writeText } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  // Resolve the authoritative DB the same way every other v2 command does:
  // --db > CLIENT_DB_PATH > SEO_AGENT_DB > /opt/client-sqlite/seo-agent.db.
  // The previous cwd-relative fallback meant cron (which runs from outside the
  // agent root) could open an unintended /<cwd>/tools/out/state/seo-agent.db,
  // so the outbox sync polled the wrong database and drained nothing.
  const dbPath = resolveDbPath(args);
  const obsidianRoot = path.resolve(process.cwd(), args["obsidian-root"] || process.env.CLIENT_OBSIDIAN_ROOT || "/opt/client-obsidian");
  const limit = numberArg(args, "limit", 25);
  const db = openStateDb(dbPath);
  const jobs = db
    .prepare(
      `
        SELECT *
        FROM outbox_jobs
        WHERE status IN ('pending', 'retrying')
          AND job_type IN (
            'update_obsidian_task_note',
            'update_obsidian_approval_note',
            'update_obsidian_page_note',
            'update_obsidian_deployment_note',
            'update_obsidian_backup_report',
            'write_obsidian_brain_note',
            'report_lock_expired',
            'create_daily_report_section'
          )
        ORDER BY created_at ASC
        LIMIT ?
      `,
    )
    .all(limit);

  const results = [];
  for (const job of jobs) {
    results.push(processJob(db, job, obsidianRoot, Boolean(args["dry-run"])));
  }
  db.close();

  const output = {
    generated_at: nowIso(),
    tool: "sync_obsidian_outbox",
    db_path: dbPath,
    obsidian_root: obsidianRoot,
    dry_run: Boolean(args["dry-run"]),
    processed: results.length,
    results,
  };

  const outPath =
    args.out || path.join(process.cwd(), "tools", "out", "obsidian-sync", `obsidian-sync-${compactDateTime()}.json`);
  writeJson(outPath, output);

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Processed ${results.length} outbox jobs; wrote report to ${outPath}`);
    for (const result of results) {
      console.log([result.status, result.outbox_id, result.entity_id, result.note_path || result.error].join(" | "));
    }
  }
}

function processJob(db, job, obsidianRoot, dryRun) {
  const now = nowIso();
  const rendered = renderJob(db, job, obsidianRoot);
  if (!rendered.ok) {
    markJobFailed(db, job, rendered.error);
    return { outbox_id: job.outbox_id, entity_id: job.entity_id, status: "failed", error: rendered.error };
  }

  if (!dryRun) {
    // TX 1: Mark as processing. The attempt counter is owned by markJobFailed
    // (below) so that EVERY failure path increments it — including a render
    // failure, which returns before this transaction ever runs.
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      db.prepare(
        'UPDATE outbox_jobs SET status = ?, last_attempt_at = ? WHERE outbox_id = ?'
      ).run('processing', now, job.outbox_id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      markJobFailed(db, job, error.message);
      return { outbox_id: job.outbox_id, entity_id: job.entity_id, status: 'failed', error: error.message };
    }

    // File I/O: Write Obsidian note (outside any transaction)
    try {
      assertSafeObsidianWritePath(obsidianRoot, rendered.notePath, rendered.markdown);
      writeText(rendered.notePath, rendered.markdown);
    } catch (error) {
      markJobFailed(db, job, `File write failed: ${error.message}`);
      return { outbox_id: job.outbox_id, entity_id: job.entity_id, status: 'failed', error: error.message };
    }

    // TX 2: Mark as completed
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      db.prepare(
        'UPDATE outbox_jobs SET status = ?, completed_at = ?, error_message = NULL WHERE outbox_id = ?'
      ).run('completed', nowIso(), job.outbox_id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      markJobFailed(db, job, error.message);
      return { outbox_id: job.outbox_id, entity_id: job.entity_id, status: 'failed', error: error.message };
    }
  }

  return {
    outbox_id: job.outbox_id,
    entity_id: job.entity_id,
    job_type: job.job_type,
    status: dryRun ? 'dry_run' : 'completed',
    note_path: rendered.notePath,
  };
}

function renderJob(db, job, obsidianRoot) {
  if (job.job_type === "update_obsidian_task_note") {
    const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(job.entity_id);
    if (!task) return { ok: false, error: `Task not found: ${job.entity_id}` };
    return { ok: true, notePath: taskNotePath(obsidianRoot, task), markdown: makeTaskMarkdown(task) };
  }

  if (job.job_type === "update_obsidian_page_note") {
    const page = db.prepare("SELECT * FROM pages WHERE page_id = ?").get(job.entity_id);
    if (!page) return { ok: false, error: `Page not found: ${job.entity_id}` };
    
    // Create a safe filename for the page based on its URL path
    let urlSlug = "";
    try {
      const parsedUrl = new URL(page.url);
      urlSlug = slugify(parsedUrl.pathname) || "home";
    } catch(e) {
      urlSlug = slugify(page.url.replace(/^https?:\/\/[^\/]+/, '')) || "home";
    }
    
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "04-Pages", `${urlSlug}.md`),
      markdown: makePageMarkdown(page, db),
    };
  }

  if (job.job_type === "update_obsidian_approval_note") {
    const approval = db.prepare("SELECT * FROM approvals WHERE approval_id = ?").get(job.entity_id);
    if (!approval) return { ok: false, error: `Approval not found: ${job.entity_id}` };
    const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(approval.task_id);
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "11-Approvals", `${approval.approval_id} - ${slugify(task?.title || approval.task_id)}.md`),
      markdown: makeApprovalMarkdown(approval, task),
    };
  }

  if (job.job_type === "update_obsidian_deployment_note") {
    const deployment = db.prepare("SELECT * FROM deployments WHERE deployment_id = ?").get(job.entity_id);
    if (!deployment) return { ok: false, error: `Deployment not found: ${job.entity_id}` };
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "14-System-Logs", `Deployment - ${deployment.deployment_id}.md`),
      markdown: makeDeploymentMarkdown(deployment),
    };
  }

  if (job.job_type === "update_obsidian_backup_report") {
    const backup = db.prepare("SELECT * FROM backups WHERE backup_id = ?").get(job.entity_id);
    if (!backup) return { ok: false, error: `Backup not found: ${job.entity_id}` };
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "14-System-Logs", `Backup - ${backup.backup_id}.md`),
      markdown: makeBackupMarkdown(backup),
    };
  }

  if (job.job_type === "send_monitor_alert") {
    const payload = safeJson(job.payload_json);
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "14-System-Logs", `Alert - ${job.entity_id || job.outbox_id}.md`),
      markdown: makeAlertMarkdown(job, payload),
    };
  }

  if (job.job_type === "write_obsidian_brain_note") {
    const payload = safeJson(job.payload_json);
    if (!payload.relative_path || !payload.markdown) {
      return { ok: false, error: `Brain memory job ${job.outbox_id} is missing relative_path or markdown` };
    }
    // relative_path is vault-root-relative (e.g. 01-Agent-Brain/Lessons/...md).
    // assertSafeObsidianWritePath enforces it stays in-vault and (for Brain
    // writes) carries managed_by: client-agent, which the renderer emits.
    return {
      ok: true,
      notePath: path.join(obsidianRoot, payload.relative_path),
      markdown: payload.markdown,
    };
  }

  if (job.job_type === "report_lock_expired") {
    const payload = safeJson(job.payload_json);
    return {
      ok: true,
      notePath: path.join(obsidianRoot, "14-System-Logs", `Lock Report - ${job.entity_id || job.outbox_id}.md`),
      markdown: makeLockMarkdown(job, payload),
    };
  }

  if (job.job_type === "create_daily_report_section" || job.job_type === "send_daily_email_summary") {
    return renderDailyReportJob(db, job, obsidianRoot);
  }

  return { ok: false, error: `Unsupported Obsidian job type: ${job.job_type}` };
}

function renderDailyReportJob(db, job, obsidianRoot) {
  const payload = safeJson(job.payload_json);
  const reportId = payload.report_id || job.entity_id || null;
  let report = null;
  if (reportId) {
    report = db.prepare("SELECT * FROM daily_reports WHERE report_id = ?").get(reportId);
  }
  const date = payload.date || payload.target_date || report?.report_date || nowIso().slice(0, 10);
  if (!report && date) {
    report = db
      .prepare("SELECT * FROM daily_reports WHERE report_date = ? ORDER BY created_at DESC LIMIT 1")
      .get(date);
  }
  return {
    ok: true,
    notePath: path.join(obsidianRoot, "12-Reports", `Daily SEO Agent Summary - ${date}.md`),
    markdown: payload.markdown || report?.report_markdown || makeGenericMarkdown(job, payload),
  };
}

function assertSafeObsidianWritePath(obsidianRoot, notePath, markdown) {
  const root = path.resolve(obsidianRoot);
  const target = path.resolve(notePath);
  const relative = path.relative(root, target).replace(/\\/g, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing outbox write outside Obsidian root: ${target}`);
  }
  if (!relative.startsWith("01-Agent-Brain/")) return true;
  if (/^managed_by:\s*client-agent\s*$/im.test(String(markdown || ""))) return true;
  throw new Error(`Refusing outbox write into Obsidian Brain without managed_by: client-agent (${relative})`);
}

function markJobFailed(db, job, message) {
  const now = nowIso();
  // Own the attempt counter here. This is the single failure path for both
  // unrenderable jobs (entity missing → returns before the 'processing' TX) and
  // write failures, so incrementing here guarantees a job that can never succeed
  // climbs to dead_letter instead of looping as 'retrying' forever (the prior
  // bug: render failures never incremented attempt_count, so dead was never true).
  const newCount = (job.attempt_count || 0) + 1;
  const dead = newCount >= 3;
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`UPDATE outbox_jobs SET status = ?, attempt_count = ?, last_attempt_at = ?, error_message = ? WHERE outbox_id = ?`)
      .run(dead ? 'dead_letter' : 'retrying', newCount, now, message, job.outbox_id);
    db.prepare(`INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(makeId('EVT'), dead ? 'outbox_dead_letter' : 'outbox_retry', job.entity_id || null, 'outbox', job.outbox_id, job.status, dead ? 'dead_letter' : 'retrying', 'outbox_sync', 'Obsidian Outbox Sync', now, JSON.stringify({error: message, attempt: newCount}));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function taskNotePath(obsidianRoot, task) {
  const fileName = `${task.task_id} - ${slugify(task.title || "task")}.md`;
  return path.join(obsidianRoot, "02-Tasks", fileName);
}

function makeTaskMarkdown(task) {
  const metadata = safeJson(task.metadata_json);
  const syncedAt = nowIso();
  return `---
task_id: ${task.task_id}
sqlite_status: ${task.status}
sqlite_risk_level: ${task.risk_level || ""}
sqlite_priority_score: ${task.priority_score || 0}
last_synced_from_sqlite: ${syncedAt}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - task
  - ${task.risk_level || "unclassified"}
  - sqlite-mirror
---

> [!warning] Source of Truth: SQLite
> This note is a human-readable mirror of SQLite.
> If this note conflicts with SQLite, **SQLite wins**.
> Do not manually edit the status fields above.

# ${task.task_id} - ${task.title}

## Current SQLite Status
==${task.status}==

## Summary
${task.description || ""}

## Target
- URL: ${task.target_url || ""}
- File: ${task.target_file || ""}
- Keyword: ${task.target_keyword || ""}

## Risk
- Level: ${task.risk_level || ""}
- Approval required: ${task.approval_required ? "yes" : "no"}
- Priority score: ${task.priority_score || 0}

## Locks
${formatLocks(metadata.locks || [])}

## Evidence
\`\`\`json
${JSON.stringify(metadata.evidence || {}, null, 2)}
\`\`\`

## Notes
This note was generated from SQLite and should not be used as source of truth.
`;
}

function makePageMarkdown(page, db) {
  const metadata = safeJson(page.metadata_json);
  
  // Try to fetch latest GSC and SERP data
  let gscText = "No GSC data available for this page.";
  let serpText = "No SERP data available for this page.";
  
  try {
    // Check if table exists
    const hasGsc = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gsc_snapshots'").get();
    if (hasGsc) {
      const gscSnapshot = db.prepare("SELECT * FROM gsc_snapshots WHERE page = ? ORDER BY captured_at DESC LIMIT 1").get(page.url);
      if (gscSnapshot) {
        gscText = `- Clicks: ${gscSnapshot.clicks || 0}\n- Impressions: ${gscSnapshot.impressions || 0}\n- CTR: ${gscSnapshot.ctr || 0}\n- Position: ${gscSnapshot.position || 0}\n- Date: ${gscSnapshot.captured_at}`;
      }
    }
    
    const hasSerp = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='serp_checks'").get();
    if (hasSerp) {
      // Attempting to fetch SERP check based on URL matching
      const serpCheck = db.prepare("SELECT * FROM serp_checks WHERE url = ? ORDER BY checked_at DESC, created_at DESC LIMIT 1").get(page.url);
      if (serpCheck) {
        serpText = `- Keyword: ${serpCheck.keyword || ""}\n- Rank: ${serpCheck.position || 'Not found'}\n- Date: ${serpCheck.checked_at || serpCheck.created_at}`;
      }
    }
  } catch(e) {
    console.error(`[outbox-obsidian] performance data lookup failed for ${page.url}: ${e.message}`);
  }

  return `---
page_id: ${page.page_id}
url: ${page.url}
sqlite_status: ${page.status}
last_crawled_at: ${page.last_crawled_at || ""}
last_synced_from_sqlite: ${nowIso()}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - page
  - sqlite-mirror
---

> [!warning] Source of Truth: SQLite
> This note is a human-readable mirror of SQLite.
> If this note conflicts with SQLite, **SQLite wins**.

# Page: ${page.title || page.url}

## URL
[${page.url}](${page.url})
- File Path: ${page.file_path || "N/A"}

## Metadata
- **Title**: ${page.title || "N/A"}
- **Description**: ${metadata.meta_description || "N/A"}
- **Canonical**: ${metadata.canonical || "N/A"}
- **Robots**: ${metadata.robots || "N/A"}

## SEO Performance (Latest)
### Google Search Console
${gscText}

### SERP Rankings
${serpText}

## Crawler Data
\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`
`;
}

function makeApprovalMarkdown(approval, task) {
  const metadata = safeJson(approval.metadata_json);
  return `---
approval_id: ${approval.approval_id}
task_id: ${approval.task_id}
sqlite_status: ${approval.status}
last_synced_from_sqlite: ${nowIso()}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - approval
  - sqlite-mirror
---

> [!warning] Source of Truth: SQLite
> This note is a human-readable mirror of SQLite. If this note conflicts with SQLite, **SQLite wins**.

# Approval - ${task?.title || approval.task_id}

## Approval State
==${approval.status}==

## Task
- ID: [[${approval.task_id}]]
- Title: ${task?.title || ""}
- Risk: ${task?.risk_level || ""}
- Priority: ${task?.priority_score || ""}

## Dates
- Requested: ${approval.requested_at || ""}
- Approved: ${approval.approved_at || ""}
- Rejected: ${approval.rejected_at || ""}

## Metadata
\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`
`;
}

function makeDeploymentMarkdown(deployment) {
  const metadata = safeJson(deployment.metadata_json);
  return `---
deployment_id: ${deployment.deployment_id}
task_id: ${deployment.task_id || ""}
sqlite_status: ${deployment.status}
deployment_type: ${deployment.deployment_type || ""}
last_synced_from_sqlite: ${nowIso()}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - deployment
  - sqlite-mirror
---

# Deployment - ${deployment.deployment_id}

## Status
==${deployment.status}==

## Target
- Task: ${deployment.task_id ? `[[${deployment.task_id}]]` : ""}
- Branch: ${deployment.branch_name || ""}
- Commit: ${deployment.commit_sha || ""}
- Cloudflare ID: ${deployment.cloudflare_deployment_id || ""}
- Preview URL: ${deployment.preview_url || ""}
- Production URL: ${deployment.production_url || ""}
- Validation: ${deployment.validation_status || ""}

## Timing
- Started: ${deployment.started_at || ""}
- Finished: ${deployment.finished_at || ""}

## Metadata
\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`
`;
}

function makeBackupMarkdown(backup) {
  const metadata = safeJson(backup.metadata_json);
  return `---
backup_id: ${backup.backup_id}
sqlite_status: ${backup.status}
last_synced_from_sqlite: ${nowIso()}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - backup
  - sqlite-mirror
---

# Backup - ${backup.backup_id}

- Type: ${backup.backup_type}
- Status: ==${backup.status}==
- Source: ${backup.source_path || ""}
- Backup path: ${backup.backup_path || ""}
- Started: ${backup.started_at || ""}
- Finished: ${backup.finished_at || ""}
- Size bytes: ${backup.size_bytes || 0}

\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`
`;
}

function makeAlertMarkdown(job, payload) {
  return `---
alert_id: ${payload.alert_id || job.entity_id || job.outbox_id}
sqlite_status: open
last_synced_from_sqlite: ${nowIso()}
source_of_truth: SQLite
do_not_manually_edit_status: true
tags:
  - alert
  - monitor
  - sqlite-mirror
---

> [!danger] Monitor Alert
> **${payload.alert_type || job.entity_id || job.outbox_id}**

- Severity: ==${payload.severity || ""}==
- Message: ${payload.message || payload.error || ""}
- Job: ${job.outbox_id}

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

function makeLockMarkdown(job, payload) {
  return `# Lock Report - ${payload.lock_id || job.entity_id || job.outbox_id}

- Type: ${payload.lock_type || ""}
- Resource: ${payload.resource_id || ""}

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

function makeGenericMarkdown(job, payload) {
  return `# ${job.job_type} - ${job.entity_id || job.outbox_id}

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

function formatLocks(locks) {
  if (!locks.length) return "- None";
  return locks.map((lock) => `- ${lock.lock_type}: ${lock.resource_id}`).join("\n");
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function printHelp() {
  console.log(`
Usage:
  node tools/sync_obsidian_outbox.js --db tools/out/state/seo-agent.db --obsidian-root ../client-obsidian

Options:
  --db path              SQLite DB path.
  --obsidian-root path   Obsidian vault path. Defaults to CLIENT_OBSIDIAN_ROOT or /opt/client-obsidian.
  --limit 25             Pending jobs to process.
  --dry-run              Do not write notes or update jobs.
  --out path             JSON report path.
  --json                 Print full JSON to stdout.
`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    exitWithError(error);
  }
}

module.exports = Object.assign(main, { assertSafeObsidianWritePath, renderJob });
