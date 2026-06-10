const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { ensureDir } = require("./io");
const { localDateOnly, nowIso } = require("./dates");
const { inferLocks, urlToLikelyFile } = require("./tasks");
const { assertTaskStatus } = require("./statuses");

function openStateDb(dbPath) {
  const resolved = path.resolve(process.cwd(), dbPath);
  ensureDir(path.dirname(resolved));
  const db = new DatabaseSync(resolved);
  initSchema(db);
  migrateSchema(db);

  return db;
}

// Retrofit databases created before later schema additions. `CREATE TABLE IF
// NOT EXISTS` never alters an existing table, so pre-existing DBs miss columns
// and constraints added later. These migrations are idempotent and safe to run
// on every open.
function migrateSchema(db) {
  try {
    const gscColumns = new Set(
      db.prepare("PRAGMA table_info(gsc_snapshots)").all().map((c) => c.name),
    );
    if (gscColumns.size > 0) {
      if (!gscColumns.has("date_range_start")) {
        db.exec("ALTER TABLE gsc_snapshots ADD COLUMN date_range_start TEXT");
      }
      if (!gscColumns.has("date_range_end")) {
        db.exec("ALTER TABLE gsc_snapshots ADD COLUMN date_range_end TEXT");
      }
    }

    // The table's inline UNIQUE(query, page, date_range_start, date_range_end)
    // is never applied to legacy tables. Enforce the same dedupe rule with a
    // unique index (INSERT OR IGNORE relies on it). If legacy duplicate rows
    // exist the index creation throws — collapse them first, then retry.
    try {
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_snapshots_period_unique ON gsc_snapshots(query, page, date_range_start, date_range_end)",
      );
    } catch {
      db.exec(`
        DELETE FROM gsc_snapshots
        WHERE snapshot_id NOT IN (
          SELECT MIN(snapshot_id) FROM gsc_snapshots
          GROUP BY query, page, date_range_start, date_range_end
        )
      `);
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_snapshots_period_unique ON gsc_snapshots(query, page, date_range_start, date_range_end)",
      );
    }
  } catch (error) {
    // Never let a migration failure prevent the DB from opening; surface it.
    console.error(`[state_db] gsc_snapshots migration skipped: ${error.message}`);
  }

  // ── keywords table: add WS1 registry fields ──
  try {
    const kwColumns = new Set(
      db.prepare("PRAGMA table_info(keywords)").all().map((c) => c.name),
    );
    if (kwColumns.size > 0) {
      if (!kwColumns.has("intent_tier")) {
        db.exec("ALTER TABLE keywords ADD COLUMN intent_tier TEXT DEFAULT 'money'");
      }
      if (!kwColumns.has("target_page_type")) {
        db.exec("ALTER TABLE keywords ADD COLUMN target_page_type TEXT");
      }
      if (!kwColumns.has("source")) {
        db.exec("ALTER TABLE keywords ADD COLUMN source TEXT DEFAULT 'manual'");
      }
      if (!kwColumns.has("status")) {
        db.exec("ALTER TABLE keywords ADD COLUMN status TEXT DEFAULT 'active'");
      }
    }
  } catch (error) {
    console.error(`[state_db] keywords migration skipped: ${error.message}`);
  }

  // ── tasks table: add scheduled_for (deferred follow-up support) ──
  // A task with a future scheduled_for stays invisible to `task next` until the
  // due time passes, then becomes pickable automatically (no promoter cron). This
  // is what lets an executor enqueue a follow-up now that runs in ~14 days.
  try {
    const taskColumns = new Set(
      db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name),
    );
    if (taskColumns.size > 0 && !taskColumns.has("scheduled_for")) {
      db.exec("ALTER TABLE tasks ADD COLUMN scheduled_for TEXT");
    }
  } catch (error) {
    console.error(`[state_db] tasks.scheduled_for migration skipped: ${error.message}`);
  }

  // ── monitor_alerts table: add dedup / resolution columns ──
  try {
    const alertColumns = new Set(
      db.prepare("PRAGMA table_info(monitor_alerts)").all().map((c) => c.name),
    );
    if (alertColumns.size > 0) {
      if (!alertColumns.has("last_seen_at")) {
        db.exec("ALTER TABLE monitor_alerts ADD COLUMN last_seen_at TEXT");
      }
      if (!alertColumns.has("occurrence_count")) {
        db.exec("ALTER TABLE monitor_alerts ADD COLUMN occurrence_count INTEGER DEFAULT 1");
      }
      if (!alertColumns.has("resolution_note")) {
        db.exec("ALTER TABLE monitor_alerts ADD COLUMN resolution_note TEXT");
      }
    }
  } catch (error) {
    console.error(`[state_db] monitor_alerts migration skipped: ${error.message}`);
  }
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      risk_level TEXT,
      priority_score INTEGER,
      source TEXT,
      target_url TEXT,
      target_file TEXT,
      target_keyword TEXT,
      approval_required INTEGER DEFAULT 0,
      scheduled_for TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT,
      resource_type TEXT,
      resource_id TEXT,
      old_value TEXT,
      new_value TEXT,
      source TEXT,
      agent_name TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox_jobs (
      outbox_id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      payload_json TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      next_attempt_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_token_hash TEXT,
      requested_at TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      approved_by TEXT,
      source_email TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS deployments (
      deployment_id TEXT PRIMARY KEY,
      task_id TEXT,
      branch_name TEXT,
      commit_sha TEXT,
      deployment_type TEXT,
      cloudflare_deployment_id TEXT,
      preview_url TEXT,
      production_url TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      validation_status TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS locks (
      lock_id TEXT PRIMARY KEY,
      lock_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      task_id TEXT,
      owner_agent TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      released_at TEXT,
      heartbeat_at TEXT,
      stale_after_seconds INTEGER DEFAULT 1800,
      reason TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS cron_runs (
      cron_run_id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      duration_seconds REAL,
      last_successful_run_at TEXT,
      last_failed_run_at TEXT,
      error_summary TEXT,
      log_path TEXT,
      created_tasks INTEGER DEFAULT 0,
      completed_tasks INTEGER DEFAULT 0,
      email_sent INTEGER DEFAULT 0,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      heartbeat_id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      current_task_id TEXT,
      duration_seconds REAL,
      last_successful_run_at TEXT,
      last_failed_run_at TEXT,
      error_summary TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS monitor_alerts (
      alert_id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      last_seen_at TEXT,
      occurrence_count INTEGER DEFAULT 1,
      resolved_at TEXT,
      resolution_note TEXT,
      notified_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS backups (
      backup_id TEXT PRIMARY KEY,
      backup_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source_path TEXT,
      backup_path TEXT,
      started_at TEXT,
      finished_at TEXT,
      size_bytes INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_checks (
      sync_check_id TEXT PRIMARY KEY,
      check_type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS keywords (
      keyword_id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL UNIQUE,
      cluster TEXT,
      priority TEXT,
      target_url TEXT,
      current_position INTEGER,
      best_position INTEGER,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS pages (
      page_id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      file_path TEXT,
      title TEXT,
      status TEXT,
      last_crawled_at TEXT,
      last_modified_at TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS experiments (
      experiment_id TEXT PRIMARY KEY,
      task_id TEXT,
      experiment_type TEXT NOT NULL,
      target_url TEXT,
      target_keyword TEXT,
      hypothesis TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      baseline_json TEXT,
      result_json TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS serp_checks (
      serp_check_id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      provider TEXT,
      position INTEGER,
      url TEXT,
      domain TEXT,
      snapshot_json TEXT,
      checked_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS gsc_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      query TEXT,
      page TEXT,
      clicks INTEGER,
      impressions INTEGER,
      ctr REAL,
      position REAL,
      date_range_start TEXT,
      date_range_end TEXT,
      captured_at TEXT NOT NULL,
      metadata_json TEXT,
      UNIQUE(query, page, date_range_start, date_range_end)
    );

    CREATE TABLE IF NOT EXISTS crawler_runs (
      crawler_run_id TEXT PRIMARY KEY,
      site_root TEXT,
      pages_scanned INTEGER,
      issues_found INTEGER,
      issue_summary_json TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      agent_run_id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      run_type TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      tasks_created INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      error_summary TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_rules (
      rule_id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      source_task_id TEXT,
      source_experiment_id TEXT,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      report_id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL UNIQUE,
      report_json TEXT,
      report_markdown TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS repo_status_checks (
      repo_check_id TEXT PRIMARY KEY,
      repo_name TEXT NOT NULL,
      branch_name TEXT,
      is_dirty INTEGER,
      uncommitted_files TEXT,
      untracked_files TEXT,
      last_pull_at TEXT,
      last_push_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_reports (
      id            TEXT PRIMARY KEY,
      module_id     TEXT NOT NULL,
      session       TEXT NOT NULL,
      run_at        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'completed',
      severity      TEXT NOT NULL DEFAULT 'normal',
      headline      TEXT NOT NULL,
      report_json   TEXT NOT NULL,
      markdown_path TEXT,
      brain_note_id TEXT,
      duration_ms   INTEGER,
      error         TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id TEXT PRIMARY KEY,
      cluster TEXT NOT NULL,
      target_keyword TEXT NOT NULL,
      target_url TEXT,
      decision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      priority TEXT DEFAULT 'high',
      content_brief_json TEXT,
      success_metric TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status_score ON tasks(status, priority_score DESC);
    CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_locks_active_resource ON locks(status, lock_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_events_task_created ON events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_status_type ON monitor_alerts(status, alert_type);
    CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);
    CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
    CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
    CREATE INDEX IF NOT EXISTS idx_serp_checks_keyword ON serp_checks(keyword, checked_at);
    CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_query ON gsc_snapshots(query, captured_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_runs_status ON crawler_runs(status);
    CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_module ON analysis_reports(module_id, run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_session ON analysis_reports(session, run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_severity ON analysis_reports(severity, run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_cluster ON campaigns(cluster);
  `);
}

/**
 * Atomically persist an intelligence module's analysis report.
 *
 * Writes the analysis_reports row, an immutable event, and (optionally) a
 * write_obsidian_brain_note outbox job — all in one transaction, so the
 * report and its Brain observation note never diverge. The Markdown report
 * file itself is written to the filesystem by the caller, outside this TX.
 *
 * @param {object} db        - DatabaseSync instance
 * @param {object} report    - analysis_reports row fields (see intelligence-report.js)
 * @param {object} [brainNote] - optional { memory_id, memory_type, title, relative_path, markdown }
 *                               When present, brainNote.memory_id is stored as the row's brain_note_id.
 */
function recordAnalysisReportAtomic(db, report, brainNote = null) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(`
      INSERT INTO analysis_reports (
        id, module_id, session, run_at, status, severity, headline,
        report_json, markdown_path, brain_note_id, duration_ms, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.module_id,
      report.session,
      report.run_at,
      report.status || "completed",
      report.severity || "normal",
      report.headline,
      report.report_json,
      report.markdown_path || null,
      brainNote ? brainNote.memory_id : (report.brain_note_id || null),
      report.duration_ms == null ? null : Number(report.duration_ms),
      report.error || null,
      report.created_at || now,
    );

    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("EVT"),
      "analysis_report_recorded",
      null,
      "analysis_report",
      report.id,
      null,
      report.severity || "normal",
      report.module_id,
      "Intelligence Module",
      now,
      JSON.stringify({
        module_id: report.module_id,
        session: report.session,
        status: report.status || "completed",
        headline: report.headline,
        markdown_path: report.markdown_path || null,
        brain_note_id: brainNote ? brainNote.memory_id : null,
      }),
    );

    if (brainNote) {
      db.prepare(`
        INSERT INTO events (
          event_id, event_type, task_id, resource_type, resource_id,
          old_value, new_value, source, agent_name, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        makeId("EVT"),
        "brain_memory_written",
        null,
        "brain_memory",
        brainNote.memory_id,
        null,
        brainNote.memory_type || "observation",
        report.module_id,
        "Obsidian Memory Writer",
        now,
        JSON.stringify({
          memory_id: brainNote.memory_id,
          memory_type: brainNote.memory_type || "observation",
          title: brainNote.title,
          relative_path: brainNote.relative_path,
          source_report: report.id,
        }),
      );

      db.prepare(`
        INSERT INTO outbox_jobs (
          outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        makeId("OUT"),
        "write_obsidian_brain_note",
        "brain_memory",
        brainNote.memory_id,
        JSON.stringify({
          memory_id: brainNote.memory_id,
          memory_type: brainNote.memory_type || "observation",
          title: brainNote.title,
          relative_path: brainNote.relative_path,
          markdown: brainNote.markdown,
        }),
        "pending",
        now,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertTaskCandidatesAtomic(db, candidates, options = {}) {
  const now = nowIso();
  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at,
      updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO events (
      event_id, event_type, task_id, resource_type, resource_id, old_value,
      new_value, source, agent_name, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutbox = db.prepare(`
    INSERT INTO outbox_jobs (
      outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const backfillTargetFile = db.prepare(`
    UPDATE tasks
    SET target_file = ?, updated_at = ?, metadata_json = ?
    WHERE task_id = ? AND (target_file IS NULL OR target_file = '') AND ? IS NOT NULL AND ? != ''
  `);

  let inserted = 0;
  let updated = 0;
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const candidate of candidates) {
      const effectiveTargetFile = candidate.target_file || urlToLikelyFile(candidate.target_url);
      const effectiveLocks = candidate.locks && candidate.locks.length
        ? candidate.locks
        : inferLocks({
          taskType: candidate.task_type,
          targetFile: effectiveTargetFile,
          targetUrl: candidate.target_url,
          targetKeyword: candidate.target_keyword,
        });
      const metadata = {
        task_type: candidate.task_type,
        locks: effectiveLocks,
        evidence: candidate.evidence || {},
        candidate_id: candidate.candidate_id,
        generated_by: options.generatedBy || "generate_task_candidates",
        source_reports: candidate.source_reports || [],
      };
      const candidateStatus = assertTaskStatus(candidate.status || "candidate");

      const result = insertTask.run(
        candidate.candidate_id,
        candidate.title,
        candidate.description,
        candidateStatus,
        candidate.risk_level,
        Number(candidate.priority_score || 1),
        candidate.source,
        candidate.target_url,
        effectiveTargetFile,
        candidate.target_keyword,
        candidate.approval_required ? 1 : 0,
        candidate.created_at || now,
        now,
        JSON.stringify(metadata),
      );

      if (result.changes === 0) {
        const updateResult = backfillTargetFile.run(
          effectiveTargetFile,
          now,
          JSON.stringify(metadata),
          candidate.candidate_id,
          effectiveTargetFile,
          effectiveTargetFile,
        );
        if (updateResult.changes > 0) {
          updated += 1;
          insertEvent.run(
            makeId("EVT"),
            "task_target_file_backfilled",
            candidate.candidate_id,
            "task",
            candidate.candidate_id,
            null,
            effectiveTargetFile,
            candidate.source,
            options.agentName || "Task Candidate Generator",
            now,
            JSON.stringify(metadata),
          );
          insertOutbox.run(
            makeId("OUT"),
            "update_obsidian_task_note",
            "task",
            candidate.candidate_id,
            JSON.stringify({
              task_id: candidate.candidate_id,
              status: candidateStatus,
              risk_level: candidate.risk_level,
              priority_score: candidate.priority_score,
              target_file: effectiveTargetFile,
              source_of_truth: "SQLite",
            }),
            "pending",
            now,
          );
        }
        continue;
      }
      inserted += 1;

      insertEvent.run(
        makeId("EVT"),
        "task_candidate_created",
        candidate.candidate_id,
        "task",
        candidate.candidate_id,
        null,
        candidateStatus,
        candidate.source,
        options.agentName || "Task Candidate Generator",
        now,
        JSON.stringify(metadata),
      );

      insertOutbox.run(
        makeId("OUT"),
        "update_obsidian_task_note",
        "task",
        candidate.candidate_id,
        JSON.stringify({
          task_id: candidate.candidate_id,
          status: candidateStatus,
          risk_level: candidate.risk_level,
          priority_score: candidate.priority_score,
          source_of_truth: "SQLite",
        }),
        "pending",
        now,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { inserted, updated, skipped_existing: candidates.length - inserted - updated };
}

/**
 * Atomically update a task's status with event + outbox in one transaction.
 * Follows spec §4: BEGIN → UPDATE task → INSERT event → INSERT outbox → COMMIT.
 *
 * @param {object} db - DatabaseSync instance
 * @param {string} taskId - task to update
 * @param {string} newStatus - new status value
 * @param {object} [options]
 * @param {string} [options.oldStatus] - previous status (for event old_value)
 * @param {string} [options.source] - event source identifier
 * @param {string} [options.agentName] - agent performing the update
 * @param {object} [options.metadata] - extra metadata
 * @param {string} [options.completedAt] - set completed_at on task
 * @param {string} [options.outboxJobType] - outbox job type (default: update_obsidian_task_note)
 */
function updateTaskStatusAtomic(db, taskId, newStatus, options = {}) {
  assertTaskStatus(newStatus);
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // 1. Update task state. If the row disappears, abort before side effects.
    const completedClause = options.completedAt ? ", completed_at = ?" : "";
    const params = options.completedAt
      ? [newStatus, now, options.completedAt, taskId]
      : [newStatus, now, taskId];
    const updateResult = db.prepare(
      `UPDATE tasks SET status = ?, updated_at = ?${completedClause} WHERE task_id = ?`
    ).run(...params);
    if (updateResult.changes === 0) throw new Error(`Task not found: ${taskId}`);

    // 2. Insert immutable event row
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("EVT"),
      "task_status_changed",
      taskId,
      "task",
      taskId,
      options.oldStatus || task.status || null,
      newStatus,
      options.source || "state_db",
      options.agentName || "State Agent",
      now,
      JSON.stringify(options.metadata || {}),
    );

    // 3. Insert outbox job for Obsidian/report update
    db.prepare(`
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("OUT"),
      options.outboxJobType || "update_obsidian_task_note",
      "task",
      taskId,
      JSON.stringify({ task_id: taskId, status: newStatus, source_of_truth: "SQLite" }),
      "pending",
      now,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Atomically insert a single event row inside a transaction.
 * Used for observation/audit events that don't change task state.
 *
 * @param {object} db - DatabaseSync instance
 * @param {object} eventData
 * @param {string} eventData.eventType
 * @param {string} [eventData.taskId]
 * @param {string} [eventData.resourceType]
 * @param {string} [eventData.resourceId]
 * @param {string} [eventData.oldValue]
 * @param {string} [eventData.newValue]
 * @param {string} [eventData.source]
 * @param {string} [eventData.agentName]
 * @param {object} [eventData.metadata]
 */
function insertEventAtomic(db, eventData) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("EVT"),
      eventData.eventType,
      eventData.taskId || null,
      eventData.resourceType || null,
      eventData.resourceId || null,
      eventData.oldValue || null,
      eventData.newValue || null,
      eventData.source || "system",
      eventData.agentName || "System",
      now,
      JSON.stringify(eventData.metadata || {}),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Atomically insert an event row + outbox job in one transaction.
 * For state changes that don't involve the tasks table directly
 * (e.g., lock operations, backup pushes, monitor alerts).
 *
 * @param {object} db - DatabaseSync instance
 * @param {object} eventData - same as insertEventAtomic
 * @param {object} outboxData
 * @param {string} outboxData.jobType
 * @param {string} [outboxData.entityType]
 * @param {string} [outboxData.entityId]
 * @param {object} [outboxData.payload]
 */
function insertEventWithOutboxAtomic(db, eventData, outboxData) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("EVT"),
      eventData.eventType,
      eventData.taskId || null,
      eventData.resourceType || null,
      eventData.resourceId || null,
      eventData.oldValue || null,
      eventData.newValue || null,
      eventData.source || "system",
      eventData.agentName || "System",
      now,
      JSON.stringify(eventData.metadata || {}),
    );

    db.prepare(`
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("OUT"),
      outboxData.jobType,
      outboxData.entityType || null,
      outboxData.entityId || null,
      JSON.stringify(outboxData.payload || {}),
      "pending",
      now,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Atomically record a local crawler run, upsert pages, and queue Obsidian page note updates.
 *
 * @param {object} db - DatabaseSync instance
 * @param {object} crawlData - Output object from crawl_local_site
 */
function recordCrawlAtomic(db, crawlData) {
  const now = nowIso();
  const runId = makeId("CRWL");

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    // 1. Record the crawler run
    db.prepare(`
      INSERT INTO crawler_runs (
        crawler_run_id, site_root, pages_scanned, issues_found,
        issue_summary_json, status, started_at, finished_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      crawlData.site_root || "unknown",
      crawlData.page_count || 0,
      crawlData.issue_count || 0,
      JSON.stringify(crawlData.issues || []),
      "completed",
      crawlData.generated_at || now,
      now,
      JSON.stringify({ base_url: crawlData.base_url })
    );

    // 2. Prepare statement for page upsert
    const upsertPage = db.prepare(`
      INSERT INTO pages (
        page_id, url, file_path, title, status, last_crawled_at, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        file_path = excluded.file_path,
        title = excluded.title,
        status = excluded.status,
        last_crawled_at = excluded.last_crawled_at,
        metadata_json = excluded.metadata_json
    `);

    // 3. Prepare statement for outbox job insertion
    const insertOutbox = db.prepare(`
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // 4. Upsert each page and queue outbox job
    let pageInsertCount = 0;
    if (Array.isArray(crawlData.pages)) {
      for (const page of crawlData.pages) {
        if (!page.url) continue;

        // Try to find existing page ID first to preserve it, otherwise create new
        const existingPage = db.prepare("SELECT page_id FROM pages WHERE url = ?").get(page.url);
        const pageId = existingPage ? existingPage.page_id : makeId("PG");

        upsertPage.run(
          pageId,
          page.url,
          page.file || null,
          page.title || null,
          "live",
          now,
          now,
          JSON.stringify({
            meta_description: page.meta_description,
            h1s: page.h1s,
            canonical: page.canonical,
            robots: page.robots,
            crawler_run_id: runId
          })
        );

        insertOutbox.run(
          makeId("OUT"),
          "update_obsidian_page_note",
          "page",
          pageId,
          JSON.stringify({ page_id: pageId, url: page.url }),
          "pending",
          now
        );

        pageInsertCount++;
      }
    }

    // 5. Record completion event
    // Inline execution of event insertion since insertEventAtomic calls BEGIN TRANSACTION itself
    // Wait, insertEventAtomic calls BEGIN IMMEDIATE TRANSACTION inside.
    // If we are already inside a transaction, we can't call it. We have to do it manually.
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("EVT"),
      "crawler_run_completed",
      null,
      "crawler_run",
      runId,
      null,
      null,
      "crawl_local_site",
      "Local Crawler",
      now,
      JSON.stringify({ pages_upserted: pageInsertCount, issues_found: crawlData.issue_count })
    );

    db.exec("COMMIT");
    return { runId, pageInsertCount };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}-${localDateOnly()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

module.exports = {
  openStateDb,
  initSchema,
  insertTaskCandidatesAtomic,
  updateTaskStatusAtomic,
  insertEventAtomic,
  insertEventWithOutboxAtomic,
  recordCrawlAtomic,
  recordAnalysisReportAtomic,
  makeId,
};
