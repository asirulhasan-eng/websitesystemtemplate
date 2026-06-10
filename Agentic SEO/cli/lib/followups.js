// followups.js — Executor-created follow-up tasks.
//
// The twice-daily Hermes work plan is the primary task PRODUCER; the */7 ops
// pipeline is normally a pure CONSUMER. This module is the one sanctioned way an
// executor enqueues a small amount of *self-scheduled* work: after it ships a
// ranking-affecting change, it schedules a deterministic follow-up to re-check
// the rankings ~14 days later, and (if they regressed) enqueues a recovery task.
//
// Three guardrails keep this from becoming a runaway producer:
//   1. Only `safe`, non-approval task types are ever created here.
//   2. A depth cap (followup_depth) bounds optimize→verify→recover→verify chains.
//   3. Dedupe: never create a second active follow-up for the same target+type.
//
// Deferral is purely via tasks.scheduled_for (see task-next.js): a follow-up is
// created status='approved' with a future scheduled_for and stays invisible to
// the consumer until due. No promoter cron is involved.

const { makeId } = require("./state_db");
const { nowIso, nowPlusDaysIso } = require("./dates");
const { COMPLETED_TASK_STATUSES } = require("./statuses");
const { routeTaskCreationThroughGuardrails } = require("./guardrails");
const { normalizeUrlForDedupe } = require("./task_routing");
const { openExperiment } = require("./experiments");

const DEFAULT_FOLLOWUP_DAYS = 14;
// Bounds the optimize → ranking_followup → ranking_recovery → ranking_followup
// chain. depth 0 = original work; each generated task is parent depth + 1.
const MAX_FOLLOWUP_DEPTH = 3;
// A keyword that slips this many organic positions (or out of the tracked set)
// counts as a regression worth a recovery task + alert.
const DEFAULT_REGRESSION_DROP = 3;

// Issue/task types whose successful deploy can move rankings and therefore merit
// a delayed ranking re-check. `ranking_followup`/`ranking_recovery`/`protect_*`
// are intentionally absent: they are monitoring tasks, not page changes, so they
// do not start a fresh verification window (the depth cap also bounds them).
const RANKING_AFFECTING_TYPES = new Set([
  "missing_title",
  "missing_meta_description",
  "missing_canonical",
  "missing_image_alt",
  "internal_link_opportunity",
  "internal_linking",
  "new_blog_post",
  "content_refresh",
  "blog_content_refresh",
  "service_page_gap",
  "money_page_refresh",
  "new_service_page",
]);

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

// Coerce a SERP position to a number or null. Critically, null/undefined/"" must
// map to null (unranked) — NOT 0 — because Number(null) === 0 would otherwise be
// read as the best possible rank and invert regression detection.
function toPosition(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTerminalStatus(status) {
  return COMPLETED_TASK_STATUSES.has(status) || status === "deferred";
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// Collect the keywords a ranking follow-up should track for a parent task.
function keywordsForTask(task, evidence = {}) {
  const fromEvidence = []
    .concat(Array.isArray(evidence.keywords) ? evidence.keywords : [])
    .concat(Array.isArray(evidence.target_keywords) ? evidence.target_keywords : []);
  return uniqueNonEmpty([task.target_keyword, ...fromEvidence]);
}

function followupWindowDays(evidence = {}) {
  const fromEvidence = Number(evidence.followup_days);
  if (Number.isFinite(fromEvidence) && fromEvidence > 0) return fromEvidence;
  const fromEnv = Number(process.env.CLIENT_FOLLOWUP_DAYS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_FOLLOWUP_DAYS;
}

// Best-effort baseline ranking per keyword, read-only: prefer positions the
// producer already recorded on the parent task, then fall back to the most
// recent serp_checks row for that keyword+domain. Null when unknown (the
// follow-up will then only report current standings, never auto-escalate).
function captureBaselinePositions(db, keywords, domain, evidence = {}) {
  const explicit = evidence.baseline_positions && typeof evidence.baseline_positions === "object"
    ? evidence.baseline_positions
    : {};
  const evidencePosition = toPosition(evidence.current_position);

  let latestForKeyword = null;
  try {
    latestForKeyword = db.prepare(
      "SELECT position FROM serp_checks WHERE keyword = ? AND (? IS NULL OR domain = ?) ORDER BY checked_at DESC LIMIT 1",
    );
  } catch {
    latestForKeyword = null;
  }

  const baseline = {};
  for (const keyword of keywords) {
    if (Object.prototype.hasOwnProperty.call(explicit, keyword)) {
      baseline[keyword] = explicit[keyword];
      continue;
    }
    let position = null;
    if (latestForKeyword) {
      try {
        const row = latestForKeyword.get(keyword, domain || null, domain || null);
        if (row) position = toPosition(row.position);
      } catch {
        position = null;
      }
    }
    // Single-keyword tasks can borrow evidence.current_position as a baseline.
    if (position === null && keywords.length === 1 && evidencePosition !== null) {
      position = evidencePosition;
    }
    baseline[keyword] = position;
  }
  return baseline;
}

// Pure comparison of baseline vs current positions. Lower position = better rank;
// a positive delta or falling out of the tracked set is a regression.
function evaluateRankingDeltas(baseline = {}, current = {}, options = {}) {
  const dropThreshold = Number.isFinite(Number(options.dropThreshold))
    ? Number(options.dropThreshold)
    : DEFAULT_REGRESSION_DROP;
  const rows = [];
  const keywords = uniqueNonEmpty([...Object.keys(baseline), ...Object.keys(current)]);
  for (const keyword of keywords) {
    const base = toPosition(baseline[keyword]);
    const cur = toPosition(current[keyword]);
    let status = "unknown";
    let delta = null;
    if (base !== null && cur !== null) {
      delta = cur - base;
      if (delta >= dropThreshold) status = "regressed";
      else if (delta < 0) status = "improved";
      else status = "stable";
    } else if (base !== null && cur === null) {
      status = "regressed"; // had a tracked rank, now nowhere in the checked window
    } else if (base === null && cur !== null) {
      status = "new"; // no baseline to compare against
    }
    rows.push({ keyword, baseline: base, current: cur, delta, status });
  }
  const regressions = rows.filter((r) => r.status === "regressed");
  const improvements = rows.filter((r) => r.status === "improved");
  return { rows, regressions, improvements, regressed: regressions.length > 0, drop_threshold: dropThreshold };
}

// Decide whether a just-completed page change warrants a ranking follow-up, and
// build its spec (without the baseline — captureBaselinePositions fills that).
function planRankingFollowup(parentTask, parentMetadata = {}, options = {}) {
  const evidence = parentMetadata.evidence && typeof parentMetadata.evidence === "object"
    ? parentMetadata.evidence
    : {};
  const taskType = options.canonicalTaskType
    || parentMetadata.task_type
    || evidence.type
    || null;
  if (!taskType || !RANKING_AFFECTING_TYPES.has(taskType)) return null;

  const keywords = keywordsForTask(parentTask, evidence);
  if (!keywords.length) return null; // nothing measurable to re-check

  const windowDays = followupWindowDays(evidence);
  const primaryKeyword = keywords[0];
  return {
    parentTask,
    parentMetadata,
    taskType: "ranking_followup",
    riskLevel: "safe",
    priority: 600,
    source: "executor_followup",
    title: `Ranking follow-up: ${primaryKeyword}`,
    description: `Re-evaluate rankings ${windowDays} days after "${parentTask.title}" (task ${parentTask.task_id}). `
      + `Compares current SERP positions for ${keywords.join(", ")} against the baseline captured at deploy `
      + `and enqueues a recovery task if they slipped.`,
    targetUrl: parentTask.target_url || null,
    targetFile: parentTask.target_file || null,
    targetKeyword: primaryKeyword,
    scheduledForIso: nowPlusDaysIso(windowDays),
    dedupeByTargetUrl: true,
    evidence: {
      type: "ranking_followup",
      keywords,
      window_days: windowDays,
      parent_task_id: parentTask.task_id,
      parent_task_type: taskType,
      // baseline_positions filled by captureBaselinePositions in maybeCreateFollowups
    },
  };
}

// Insert a follow-up task (+ event + outbox note) atomically, honoring the depth
// cap, dedupe, and guardrails. Returns { created, task_id?, reason }.
function createFollowupTask(db, spec) {
  const parentDepth = Number(spec.parentMetadata && spec.parentMetadata.followup_depth) || 0;
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_FOLLOWUP_DEPTH) {
    return { created: false, reason: `max_followup_depth_reached(${MAX_FOLLOWUP_DEPTH})` };
  }

  if (spec.dedupeByTargetUrl && spec.targetUrl) {
    const target = normalizeUrlForDedupe(spec.targetUrl);
    const candidates = db
      .prepare("SELECT status, metadata_json FROM tasks WHERE target_url = ?")
      .all(spec.targetUrl);
    const dupe = candidates.some((row) => {
      if (isTerminalStatus(row.status)) return false;
      const meta = safeJson(row.metadata_json);
      const type = meta.task_type || (meta.evidence && meta.evidence.type);
      return type === spec.taskType && normalizeUrlForDedupe(spec.targetUrl) === target;
    });
    if (dupe) return { created: false, reason: "duplicate_active_followup" };
  }

  const metadata = {
    task_type: spec.taskType,
    tags: spec.tags || ["followup"],
    evidence: spec.evidence || {},
    locks: spec.locks || [],
    generated_by: "executor_followup",
    followup_depth: childDepth,
    parent_task_id: spec.parentTask ? spec.parentTask.task_id : null,
  };

  // Route through guardrails so a misconfigured type can never silently bypass an
  // approval gate. Follow-ups are designed to be safe + autonomous; if a type ever
  // requires explicit approval, refuse rather than create an un-actioned task.
  const route = routeTaskCreationThroughGuardrails({
    taskType: spec.taskType,
    status: "approved",
    riskLevel: spec.riskLevel || "safe",
    approvalRequired: 0,
    metadata,
  });
  if (route.explicitApprovalRequired) {
    return { created: false, reason: `requires_explicit_approval(${spec.taskType})` };
  }

  const now = nowIso();
  const taskId = makeId("TSK");
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(`
      INSERT INTO tasks (
        task_id, title, description, status, risk_level, priority_score, source,
        target_url, target_file, target_keyword, approval_required, scheduled_for,
        created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      taskId,
      spec.title,
      spec.description || null,
      route.status,
      route.riskLevel,
      spec.priority || 500,
      spec.source || "executor_followup",
      spec.targetUrl || null,
      spec.targetFile || null,
      spec.targetKeyword || null,
      spec.scheduledForIso || null,
      now,
      now,
      JSON.stringify(route.metadata || metadata),
    );
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, 'followup_task_created', ?, 'task', ?, ?, 'approved', 'executor_followup', 'Task Executor', ?, ?)
    `).run(
      makeId("EVT"),
      taskId,
      taskId,
      spec.parentTask ? spec.parentTask.task_id : null,
      now,
      JSON.stringify({
        parent_task_id: spec.parentTask ? spec.parentTask.task_id : null,
        task_type: spec.taskType,
        scheduled_for: spec.scheduledForIso || null,
        followup_depth: childDepth,
      }),
    );
    db.prepare(`
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)
    `).run(
      makeId("OUT"),
      taskId,
      JSON.stringify({
        task_id: taskId,
        status: "approved",
        risk_level: route.riskLevel,
        priority_score: spec.priority || 500,
        scheduled_for: spec.scheduledForIso || null,
        source_of_truth: "SQLite",
      }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { created: true, task_id: taskId, scheduled_for: spec.scheduledForIso || null, depth: childDepth };
}

// Orchestrator called by the executor after a successful deploy. Captures the
// ranking baseline and schedules the follow-up. Never throws into the executor's
// success path — a follow-up failure must not fail the underlying task.
function maybeCreateFollowups(db, parentTask, parentMetadata = {}, options = {}) {
  const results = [];
  try {
    const spec = planRankingFollowup(parentTask, parentMetadata, options);
    if (!spec) return results;
    spec.evidence.baseline_positions = captureBaselinePositions(
      db,
      spec.evidence.keywords,
      options.domain || domainFromUrl(parentTask.target_url),
      parentMetadata.evidence || {},
    );
    results.push({ kind: "ranking_followup", ...createFollowupTask(db, spec) });

    // Open a measurement window (experiment) on this URL+lever so a SAME-lever
    // change is held until the window closes (it auto-lifts at ended_at). Reusing
    // the baseline + window we just computed; best-effort and never throws.
    results.push({
      kind: "experiment",
      ...openExperiment(db, {
        taskType: spec.evidence.parent_task_type,
        taskId: parentTask.task_id,
        targetUrl: parentTask.target_url,
        targetKeyword: spec.targetKeyword,
        hypothesis: parentTask.title,
        baseline: spec.evidence.baseline_positions,
        windowDays: spec.evidence.window_days,
      }),
    });
    return results;
  } catch (error) {
    results.push({ kind: "ranking_followup", created: false, reason: `error:${error.message}` });
    return results;
  }
}

function domainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_FOLLOWUP_DAYS,
  MAX_FOLLOWUP_DEPTH,
  DEFAULT_REGRESSION_DROP,
  RANKING_AFFECTING_TYPES,
  keywordsForTask,
  followupWindowDays,
  captureBaselinePositions,
  evaluateRankingDeltas,
  planRankingFollowup,
  createFollowupTask,
  maybeCreateFollowups,
  domainFromUrl,
};
