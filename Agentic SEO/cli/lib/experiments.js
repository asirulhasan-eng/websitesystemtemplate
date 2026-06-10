// experiments.js — Research / measurement-window integrity.
//
// When a ranking-affecting change deploys, followups.js already captures a
// per-keyword SERP baseline and schedules a ~14-day re-check. This module turns
// that implicit window into an explicit EXPERIMENT: a row recording that a
// measurement window is open on a URL for a specific "lever" (title, meta,
// content, internal_links, …), with the baseline and a window end (ended_at).
//
// Why it exists: while that window is open, a NEW change that pulls the SAME
// lever on the SAME URL confounds attribution — you can no longer tell which
// change moved the rank. So a same-lever change is HELD until the window closes.
// A change on a DIFFERENT lever is allowed (blocking every edit to a page for 14
// days costs far more velocity than the muddier attribution buys) but annotated
// and logged, so movement can still be read against the change log.
//
// Policy (mirrors the operator playbook):
//   - same lever,  window open  -> HOLD   (defer; the gate auto-lifts at ended_at
//                                           even if the close step never runs)
//   - other lever, same URL     -> ANNOTATE (allow, flag, log a page_change_event)
//   - corrective / approval type -> ALLOW  (never block a ranking_recovery)
//   - reopening same url+lever   -> SUPERSEDE the prior experiment = clock reset
//
// routeTask() consumes classifyIncomingChange() (pure) to apply the gate;
// followups.js calls openExperiment()/closeExperiment() to manage lifecycle.

const { makeId } = require("./state_db");
const { nowIso, nowPlusDaysIso } = require("./dates");

// Lazy to break the require cycle: task_routing.js requires this module for the
// gate, and we only need its URL normalizer (require() is cached, so this is cheap).
function normalizeUrlForDedupe(value) {
  return require("./task_routing").normalizeUrlForDedupe(value);
}

// task_type -> measurement lever. Two task types that share a lever are treated
// as confounding on the same URL. Keep this aligned with followups.RANKING_AFFECTING_TYPES.
const LEVER_FOR_TYPE = {
  missing_title: "title",
  missing_meta_description: "meta",
  missing_canonical: "canonical",
  missing_image_alt: "image_alt",
  duplicate_faqpage_schema: "schema",
  internal_link_opportunity: "internal_links",
  internal_linking: "internal_links",
  new_blog_post: "content",
  content_refresh: "content",
  blog_content_refresh: "content",
  editorial_copy_revision: "content",
  service_page_gap: "content",
  money_page_refresh: "content",
  new_service_page: "content",
};

// Monitoring / corrective task types never carry a lever and are never held: you
// must always be able to investigate or recover a ranking drop, even mid-window.
const CORRECTIVE_TYPES = new Set([
  "ranking_recovery",
  "ranking_followup",
  "protect_ranking_gain",
  "monitor",
]);

const DEFAULT_WINDOW_DAYS = 14;

function leverForType(taskType) {
  if (!taskType) return null;
  if (CORRECTIVE_TYPES.has(taskType)) return null;
  return LEVER_FOR_TYPE[taskType] || null;
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

// Is this experiment row still actively holding (open and not past its window)?
function isWindowOpen(experiment, now) {
  if (!experiment || experiment.status !== "open") return false;
  if (!experiment.ended_at) return true;
  return experiment.ended_at > now; // ISO-8601 UTC sorts lexicographically
}

// Decorate a raw experiments row with a convenient `lever` (stored in
// experiment_type) and parsed metadata/baseline.
function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    lever: row.experiment_type || null,
    baseline: safeJson(row.baseline_json),
    metadata: safeJson(row.metadata_json),
  };
}

/**
 * Pure decision for an incoming change against the open experiments on its URL.
 *
 * @param {object} input
 * @param {string} input.taskType        - canonical task type of the incoming change
 * @param {boolean} [input.approvalRequired] - explicit-approval tasks are gated elsewhere
 * @param {Array}  [input.openExperiments]   - open experiments on the same URL (decorated)
 * @param {string} [input.taskId]         - to ignore an experiment this task itself opened
 * @param {string} [input.now]            - ISO timestamp (defaults to now)
 * @returns {{decision:'allow'|'hold'|'annotate', reason:string, lever:?string,
 *            confounds:Array, orthogonal:Array, lift_at:?string}}
 */
function classifyIncomingChange(input = {}) {
  const now = input.now || nowIso();
  const lever = leverForType(input.taskType);
  const base = { decision: "allow", reason: "no_lever", lever, confounds: [], orthogonal: [], lift_at: null };

  // No lever (monitoring/corrective/unknown type) or an approval-gated task is
  // never held by the research window.
  if (!lever) return base;
  if (input.approvalRequired) return { ...base, reason: "approval_gated_elsewhere" };

  const open = (input.openExperiments || [])
    .map((e) => (e.lever ? e : decorate(e)))
    .filter((e) => isWindowOpen(e, now))
    .filter((e) => !input.taskId || e.task_id !== input.taskId);

  if (!open.length) return { ...base, reason: "no_open_window" };

  const sameLever = open.filter((e) => e.lever === lever);
  if (sameLever.length) {
    const liftAt = sameLever
      .map((e) => e.ended_at)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      decision: "hold",
      reason: "same_lever_window_open",
      lever,
      confounds: sameLever,
      orthogonal: open.filter((e) => e.lever !== lever),
      lift_at: liftAt,
    };
  }

  return {
    decision: "annotate",
    reason: "orthogonal_window_open",
    lever,
    confounds: [],
    orthogonal: open,
    lift_at: null,
  };
}

/**
 * Open an experiment (measurement window) for a just-deployed change, and log a
 * page_change_event. Reopening the same URL+lever supersedes the prior open
 * experiment — that is the clock-reset rule. Best-effort: never throws into the
 * executor's success path; returns {opened:false, reason} instead.
 *
 * @param {object} db
 * @param {object} spec
 * @param {string} spec.taskType         - the change's canonical task type
 * @param {string} spec.targetUrl
 * @param {string} [spec.targetKeyword]
 * @param {string} [spec.taskId]         - the parent change task (experiment owner)
 * @param {string} [spec.hypothesis]
 * @param {object} [spec.baseline]       - per-keyword baseline positions
 * @param {number} [spec.windowDays]
 * @param {string} [spec.now]
 */
function openExperiment(db, spec = {}) {
  const lever = leverForType(spec.taskType);
  if (!lever) return { opened: false, reason: "no_lever" };
  if (!spec.targetUrl) return { opened: false, reason: "no_target_url" };

  const startedAt = spec.now || nowIso();
  const windowDays = Number(spec.windowDays) > 0 ? Number(spec.windowDays) : DEFAULT_WINDOW_DAYS;
  const endedAt = nowPlusDaysIso(windowDays, new Date(startedAt));
  const normUrl = normalizeUrlForDedupe(spec.targetUrl);
  const experimentId = makeId("EXP");
  let supersededCount = 0;

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    // Clock reset: supersede any open experiment on the same URL + lever.
    const priorOpen = db
      .prepare("SELECT experiment_id, target_url FROM experiments WHERE status = 'open' AND experiment_type = ?")
      .all(lever)
      .filter((r) => normalizeUrlForDedupe(r.target_url) === normUrl);
    supersededCount = priorOpen.length;
    const supersede = db.prepare(
      "UPDATE experiments SET status = 'superseded', outcome = 'superseded', ended_at = ?, metadata_json = json_set(COALESCE(metadata_json,'{}'), '$.superseded_by', ?) WHERE experiment_id = ?",
    );
    const insertEvent = db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const prior of priorOpen) {
      supersede.run(startedAt, experimentId, prior.experiment_id);
      insertEvent.run(
        makeId("EVT"), "experiment_superseded", spec.taskId || null, "experiment", prior.experiment_id,
        "open", "superseded", "research_window", "Experiment Manager", startedAt,
        JSON.stringify({ superseded_by: experimentId, lever, target_url: spec.targetUrl }),
      );
    }

    db.prepare(`
      INSERT INTO experiments (
        experiment_id, task_id, experiment_type, target_url, target_keyword,
        hypothesis, status, started_at, ended_at, baseline_json, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      experimentId,
      spec.taskId || null,
      lever,
      spec.targetUrl,
      spec.targetKeyword || null,
      spec.hypothesis || null,
      startedAt,
      endedAt,
      JSON.stringify(spec.baseline || {}),
      startedAt,
      JSON.stringify({ task_type: spec.taskType, window_days: windowDays }),
    );

    // Lifecycle event + the per-URL change-log entry (what the operator reads
    // rank movement against).
    insertEvent.run(
      makeId("EVT"), "experiment_opened", spec.taskId || null, "experiment", experimentId,
      null, "open", "research_window", "Experiment Manager", startedAt,
      JSON.stringify({ lever, target_url: spec.targetUrl, ended_at: endedAt, window_days: windowDays }),
    );
    insertEvent.run(
      makeId("EVT"), "page_change_event", spec.taskId || null, "page", spec.targetUrl,
      null, lever, "research_window", "Experiment Manager", startedAt,
      JSON.stringify({
        lever,
        task_type: spec.taskType,
        experiment_id: experimentId,
        target_keyword: spec.targetKeyword || null,
        window_ends_at: endedAt,
      }),
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { opened: false, reason: `error:${error.message}` };
  }
  return { opened: true, experiment_id: experimentId, lever, started_at: startedAt, ended_at: endedAt, superseded: supersededCount };
}

/**
 * Close an experiment with its measured outcome. Resolves the row by explicit
 * experimentId, else by the owning (parent) change task. Best-effort.
 *
 * @param {object} db
 * @param {object} spec
 * @param {string} [spec.experimentId]
 * @param {string} [spec.parentTaskId] - experiments.task_id of the original change
 * @param {string} [spec.lever]
 * @param {string} spec.outcome        - improved | stable | regressed
 * @param {object} [spec.result]       - result_json payload (deltas, etc.)
 * @param {string} [spec.now]
 */
function closeExperiment(db, spec = {}) {
  const now = spec.now || nowIso();
  let row = null;
  if (spec.experimentId) {
    row = db.prepare("SELECT * FROM experiments WHERE experiment_id = ?").get(spec.experimentId);
  } else if (spec.parentTaskId) {
    const params = [spec.parentTaskId];
    let sql = "SELECT * FROM experiments WHERE task_id = ? AND status = 'open'";
    if (spec.lever) {
      sql += " AND experiment_type = ?";
      params.push(spec.lever);
    }
    sql += " ORDER BY started_at DESC LIMIT 1";
    row = db.prepare(sql).get(...params);
  }
  if (!row) return { closed: false, reason: "experiment_not_found" };
  if (row.status !== "open") return { closed: false, reason: `not_open(${row.status})`, experiment_id: row.experiment_id };

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      "UPDATE experiments SET status = 'closed', outcome = ?, result_json = ?, ended_at = ? WHERE experiment_id = ?",
    ).run(spec.outcome || "unknown", JSON.stringify(spec.result || {}), now, row.experiment_id);
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, 'experiment_closed', ?, 'experiment', ?, 'open', ?, 'research_window', 'Experiment Manager', ?, ?)
    `).run(
      makeId("EVT"), row.task_id || null, row.experiment_id, spec.outcome || "unknown", now,
      JSON.stringify({ lever: row.experiment_type, outcome: spec.outcome || "unknown" }),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { closed: false, reason: `error:${error.message}`, experiment_id: row.experiment_id };
  }
  return { closed: true, experiment_id: row.experiment_id, outcome: spec.outcome || "unknown" };
}

// All currently-open experiments whose window covers `now`, that target `url`.
function findOpenExperiments(db, url, now = nowIso()) {
  const norm = normalizeUrlForDedupe(url);
  return db
    .prepare("SELECT * FROM experiments WHERE status = 'open' AND (ended_at IS NULL OR ended_at > ?)")
    .all(now)
    .filter((r) => normalizeUrlForDedupe(r.target_url) === norm)
    .map(decorate);
}

// Map of normalized URL -> open experiments, for routing a whole ready pool in
// one query instead of one query per task.
function loadOpenExperimentsByUrl(db, now = nowIso()) {
  const map = new Map();
  const rows = db
    .prepare("SELECT * FROM experiments WHERE status = 'open' AND (ended_at IS NULL OR ended_at > ?)")
    .all(now);
  for (const raw of rows) {
    const exp = decorate(raw);
    const key = normalizeUrlForDedupe(exp.target_url);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(exp);
  }
  return map;
}

module.exports = {
  LEVER_FOR_TYPE,
  CORRECTIVE_TYPES,
  DEFAULT_WINDOW_DAYS,
  leverForType,
  isWindowOpen,
  classifyIncomingChange,
  openExperiment,
  closeExperiment,
  findOpenExperiments,
  loadOpenExperimentsByUrl,
};
