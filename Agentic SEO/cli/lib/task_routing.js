const { loadGuardrails, requiresExplicitApproval } = require("./guardrails");
const { classifyIncomingChange } = require("./experiments");

const BLOG_CONTENT_TYPES = new Set([
  'new_blog_post',
  'content_refresh',
  'blog_content_refresh',
  'editorial_copy_revision',
  'blog_visual_asset_update',
]);

const BLOG_EDIT_TYPES = new Set([
  'content_refresh',
  'blog_content_refresh',
  'editorial_copy_revision',
  'blog_visual_asset_update',
]);

// Pure-analysis service work (no file edit) stays in the deterministic ops lane.
const SERVICE_PAGE_TASK_TYPES = new Set([
  'service_architecture_review',
]);

// Rewriting/fixing an EXISTING page (resolve indexability/page-fit on a service
// page, refresh a money page) is NOT a deterministic edit — the ops safe executor
// has no handler for it, so routing it to general_operational produced an EMPTY
// branch and a fake 'preview_validated'. These need the Hermes content engine, so
// route them to blog_content → edit_refresh_needed (the content-refresh skill edits
// the published file in place and publishes straight to production).
const PAGE_CONTENT_EDIT_TYPES = new Set([
  'service_page_gap',
  'money_page_refresh',
]);

// Authoring a NEW service page from scratch needs the Hermes content engine, which
// lives in the blog_content worker. Route these to blog_content with a dedicated
// service-page draft bucket — NOT the generic ops lane, whose executors only apply
// deterministic edits to existing files and so cannot author a new page.
const SERVICE_PAGE_CREATE_TYPES = new Set([
  'new_service_page',
]);

// Deterministic operational edits (internal linking, etc.) handled by the ops
// executors. These must be routed to general_operational BEFORE the weak '/blog/'
// URL heuristic below — otherwise an internal-link task whose target happens to
// live under /blog/ gets misrouted to needs_lane_review.
const OPERATIONAL_TASK_TYPES = new Set([
  'internal_link_opportunity',
  'internal_linking',
]);

function safeJsonWithFlag(value) {
  if (!value) return { metadata: {}, invalid: false };
  try {
    const metadata = JSON.parse(value);
    return { metadata: metadata && typeof metadata === 'object' ? metadata : {}, invalid: false };
  } catch {
    return { metadata: {}, invalid: true };
  }
}

function readMetadata(task) {
  return safeJsonWithFlag(task.metadata_json).metadata;
}

function canonicalTaskType(task) {
  const { metadata } = safeJsonWithFlag(task.metadata_json);
  const evidence = metadata.evidence && typeof metadata.evidence === 'object' ? metadata.evidence : {};
  const explicit = clean(metadata.task_type || evidence.type);
  if (explicit) return explicit;

  const title = clean(task.title);
  if (title.startsWith('create blog:')) return 'new_blog_post';
  if (title.startsWith('monitor ')) return 'monitor';
  if (title.startsWith('ranking follow-up')) return 'ranking_followup';
  if (title.startsWith('investigate ranking drop') || title.startsWith('protect ranking gain')) return 'ranking_recovery';
  return '';
}

function routeTask(task, context = {}) {
  const { metadata, invalid } = safeJsonWithFlag(task.metadata_json);
  const taskType = canonicalTaskType(task);
  const routeReason = [];
  const flags = [];
  const title = clean(task.title);
  const url = clean(task.target_url);
  const targetText = clean([
    task.title,
    task.target_keyword,
    task.target_url,
    task.target_file,
    task.metadata_json,
  ].filter(Boolean).join(' '));

  if (invalid) flags.push('invalid_metadata_json');
  if (targetText.includes('switch.monster')) flags.push('no_go_switch_monster');
  if (hasMetadataTargetMismatch(task, metadata)) flags.push('metadata_target_mismatch');

  const activeTaskLock = Boolean(context.active_task_lock || hasActiveTaskLock(task, context.active_locks || [], context.now));
  if (activeTaskLock) flags.push('active_task_lock');

  const hasApprovedApproval = Boolean(context.has_approved_approval);
  const explicitApprovalRequired = taskRequiresExplicitApproval(taskType, context);
  if (explicitApprovalRequired && Number(task.approval_required || 0) === 1 && !hasApprovedApproval) {
    flags.push('approval_required_missing_approval');
  }

  // Research/measurement-window gate. A change that pulls the SAME lever as an
  // open experiment on this URL would confound rank attribution, so hold it until
  // that window closes (it auto-lifts at the experiment's ended_at). A change on a
  // DIFFERENT lever is allowed but annotated so movement stays interpretable.
  // Callers that don't pass context.open_experiments get decision:'allow' (no-op).
  const research = classifyIncomingChange({
    taskType,
    approvalRequired: Number(task.approval_required || 0) === 1,
    openExperiments: context.open_experiments || [],
    taskId: task.task_id,
    now: context.now,
  });
  if (research.decision === 'hold') flags.push('research_hold_same_lever');
  else if (research.decision === 'annotate') flags.push('experiment_window_orthogonal');

  let executionLane = 'general_operational';
  let routeConfidence = 'medium';

  if (BLOG_CONTENT_TYPES.has(taskType) || SERVICE_PAGE_CREATE_TYPES.has(taskType)
      || PAGE_CONTENT_EDIT_TYPES.has(taskType) || title.startsWith('create blog:')) {
    // Blog drafts, new-service-page authoring, and existing-page content fixes all
    // run through the Hermes worker (blog_content lane); bucketForTask separates them.
    executionLane = 'blog_content';
    routeConfidence = 'high';
    routeReason.push(taskType ? `task_type:${taskType}` : 'title:create_blog');
  } else if (title.startsWith('monitor ')) {
    executionLane = 'general_operational';
    routeConfidence = 'high';
    routeReason.push('monitor_title');
  } else if (taskType === 'monitor' || task.status === 'monitored') {
    executionLane = 'general_operational';
    routeReason.push(taskType === 'monitor' ? 'task_type:monitor' : 'status:monitored');
  } else if (taskType === 'ranking_recovery' || taskType === 'protect_ranking_gain' || taskType === 'ranking_followup') {
    // ranking_followup is an executor-scheduled SERP re-check (no file edit).
    // Match it here so a follow-up whose target happens to live under /blog/ is
    // not parked in needs_lane_review by the weak URL heuristic below.
    executionLane = 'general_operational';
    routeConfidence = 'high';
    routeReason.push(`task_type:${taskType}`);
  } else if (SERVICE_PAGE_TASK_TYPES.has(taskType)) {
    executionLane = 'general_operational';
    routeConfidence = 'high';
    routeReason.push(`task_type:${taskType}`);
  } else if (OPERATIONAL_TASK_TYPES.has(taskType)) {
    executionLane = 'general_operational';
    routeConfidence = 'high';
    routeReason.push(`task_type:${taskType}`);
  } else if (url.includes('/blog/')) {
    // URL is weak evidence only. It is not enough to route work to blog editing,
    // but it is also too ambiguous to auto-execute in the generic lane unless
    // another strong signal (monitor/ranking/task_type) is present.
    executionLane = 'needs_lane_review';
    routeConfidence = 'low';
    flags.push('blog_url_without_blog_intent');
    routeReason.push('blog_url_weak_signal');
  } else if (!taskType) {
    routeReason.push('blank_task_type');
  } else {
    routeReason.push(`task_type:${taskType}`);
  }

  let workflowBucket = bucketForTask(task, taskType, executionLane, context);
  if (flags.includes('approval_required_missing_approval')) workflowBucket = 'approval_needed';
  if (flags.includes('metadata_target_mismatch')) workflowBucket = 'needs_lane_review';
  if (flags.includes('invalid_metadata_json')) workflowBucket = 'needs_lane_review';
  if (flags.includes('no_go_switch_monster')) workflowBucket = 'blocked_no_go';
  // Park a same-lever change behind the research window, unless a harder gate
  // already claimed it (a blocked / approval / data-quality task never runs anyway).
  if (research.decision === 'hold'
      && !['approval_needed', 'needs_lane_review', 'blocked_no_go'].includes(workflowBucket)) {
    workflowBucket = 'research_hold';
    routeReason.push(`research_hold:${research.lever}`);
  }

  return {
    task_id: task.task_id,
    canonical_task_type: taskType || null,
    execution_lane: executionLane,
    workflow_bucket: workflowBucket,
    dedupe_key: dedupeKeyForTask(task, taskType),
    route_reason: routeReason,
    route_confidence: routeConfidence,
    data_quality_flags: flags,
    research_window: {
      decision: research.decision,
      reason: research.reason,
      lever: research.lever,
      lift_at: research.lift_at,
      confounding_experiments: research.confounds.map((e) => e.experiment_id).filter(Boolean),
    },
  };
}

function taskRequiresExplicitApproval(taskType, context = {}) {
  if (!taskType) return false;
  if (context.guardrails) {
    return requiresExplicitApproval(context.guardrails, taskType);
  }
  const loaded = loadGuardrails();
  return requiresExplicitApproval(loaded.config, taskType);
}

function bucketForTask(task, taskType, executionLane, context = {}) {
  if (executionLane === 'blog_content') {
    if (task.status === 'preview_ready' || task.status === 'preview_pushed') {
      const deploymentStatus = clean(context.deployment_status);
      if (deploymentStatus === 'running') return 'preview_build_pending';
      if (task.status === 'preview_pushed') return 'preview_pushed_verification';
      return 'preview_review_needed';
    }
    if (SERVICE_PAGE_CREATE_TYPES.has(taskType)) return 'service_page_draft_needed';
    if (BLOG_EDIT_TYPES.has(taskType) || PAGE_CONTENT_EDIT_TYPES.has(taskType)) return 'edit_refresh_needed';
    if (taskType === 'new_blog_post' || clean(task.title).startsWith('create blog:')) return 'draft_needed';
    return 'needs_lane_review';
  }

  if (executionLane === 'needs_lane_review') return 'needs_lane_review';

  if (task.status === 'monitored') return 'monitoring_watchlist';
  if (task.status === 'preview_ready' || task.status === 'preview_pushed') return 'preview_reconciliation_needed';
  if (task.status === 'candidate' || task.status === 'approved') return 'general_candidate_triage';
  return 'active_audit_only';
}

function isBlogContentTask(task) {
  const type = canonicalTaskType(task);
  return BLOG_CONTENT_TYPES.has(type) || clean(task.title).startsWith('create blog:');
}

function hasActiveTaskLock(task, locks = [], nowValue = null) {
  const now = nowValue ? new Date(nowValue) : new Date();
  return locks.some((lock) => {
    if (lock.status && lock.status !== 'active') return false;
    if (lock.expires_at && new Date(lock.expires_at) <= now) return false;
    return lock.task_id === task.task_id || lock.resource_id === task.task_id;
  });
}

function hasMetadataTargetMismatch(task, metadata = readMetadata(task)) {
  const evidence = metadata.evidence && typeof metadata.evidence === 'object' ? metadata.evidence : {};
  const brief = evidence.blog_brief && typeof evidence.blog_brief === 'object' ? evidence.blog_brief : {};
  const checks = [
    ['target_url', normalizeUrlForDedupe],
    ['target_file', normalizePath],
    ['target_keyword', normalizeKeyword],
  ];
  return checks.some(([key, normalizer]) => {
    if (!task[key] || !brief[key]) return false;
    return normalizer(task[key]) !== normalizer(brief[key]);
  });
}

function dedupeKeyForTask(task, taskType = canonicalTaskType(task)) {
  const sourceFamily = clean(task.source || 'unknown').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  const taskFamily = taskFamilyFor(task, taskType);
  const url = normalizeUrlForDedupe(task.target_url || task.target_file || 'no-target');
  const keyword = normalizeKeyword(task.target_keyword || task.title || 'no-keyword');
  return `${sourceFamily}|${taskFamily}|${url}|${keyword}`;
}

function taskFamilyFor(task, taskType) {
  if (BLOG_CONTENT_TYPES.has(taskType)) return `blog:${taskType}`;
  const title = clean(task.title);
  if (title.startsWith('monitor ')) return 'monitor';
  if (taskType) return taskType;
  return 'general';
}

function normalizeUrlForDedupe(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname.replace(/\/+/g, '/');
    pathname = pathname.replace(/\.html$/i, '');
    pathname = pathname.replace(/\/$/, '');
    if (!pathname) pathname = '/';
    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return normalizePath(raw).replace(/\.html$/i, '').replace(/\/$/, '');
  }
}

function normalizePath(value) {
  return String(value || '').trim().toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function normalizeKeyword(value) {
  return clean(value).replace(/\s+/g, ' ');
}

function clean(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  BLOG_CONTENT_TYPES,
  BLOG_EDIT_TYPES,
  SERVICE_PAGE_TASK_TYPES,
  PAGE_CONTENT_EDIT_TYPES,
  SERVICE_PAGE_CREATE_TYPES,
  canonicalTaskType,
  dedupeKeyForTask,
  hasActiveTaskLock,
  hasMetadataTargetMismatch,
  isBlogContentTask,
  normalizeKeyword,
  normalizePath,
  normalizeUrlForDedupe,
  routeTask,
};
