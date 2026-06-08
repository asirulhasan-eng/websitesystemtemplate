const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nowIso } = require("./dates");
const { assertTaskStatus } = require("./statuses");

const DEFAULT_GUARDRAILS_PATH = path.resolve(__dirname, "..", "..", "config", "guardrails.json");

const DAILY_LIMIT_CATEGORY_BY_TASK_TYPE = {
  new_blog_post: "blog_posts_published",
  blog_post: "blog_posts_published",
  blog_publisher: "blog_posts_published",
  service_page_update: "service_pages_modified",
  content_refresh: "service_pages_modified",
  new_service_page: "service_pages_modified",
  internal_linking: "internal_linking_changes",
  internal_linking_update: "internal_linking_changes",
  meta_fix: "meta_tag_changes",
  missing_title: "meta_tag_changes",
  missing_meta_description: "meta_tag_changes",
  title_update: "meta_tag_changes",
  meta_description_update: "meta_tag_changes",
  technical_fix: "technical_fixes",
  schema_markup: "technical_fixes",
  schema_removal: "technical_fixes",
  canonical_fix: "technical_fixes",
};

const SAFETY_LIMIT_CATEGORY_BY_TASK_TYPE = {
  delete_page: "max_pages_deleted_per_day",
  redirect_setup: "max_redirects_per_day",
};

const COUNTED_DAILY_STATUSES = new Set(["completed", "deployed", "deployed_to_production"]);

function loadGuardrails(options = {}) {
  const guardrailsPath = path.resolve(
    process.cwd(),
    options.path || process.env.CLIENT_GUARDRAILS_PATH || DEFAULT_GUARDRAILS_PATH,
  );
  if (!fs.existsSync(guardrailsPath)) {
    return { path: guardrailsPath, config: null };
  }
  return {
    path: guardrailsPath,
    config: JSON.parse(fs.readFileSync(guardrailsPath, "utf8")),
  };
}

function taskTypeFor(taskLike) {
  const metadata = safeJson(taskLike && taskLike.metadata_json);
  return (
    taskLike?.task_type ||
    taskLike?.type ||
    metadata.task_type ||
    metadata.type ||
    metadata.evidence?.type ||
    null
  );
}

function requiresExplicitApproval(guardrails, taskType) {
  if (!guardrails || !taskType) return false;
  return new Set(guardrails.require_explicit_approval || []).has(taskType);
}

function explicitApprovalStatus(guardrails) {
  return assertTaskStatus(guardrails?.explicit_approval_queue?.task_status || "waiting_for_approval");
}

function routeTaskCreationThroughGuardrails(taskDraft, options = {}) {
  const loaded = loadGuardrails(options);
  const guardrails = loaded.config;
  const taskType = taskDraft.taskType || taskTypeFor(taskDraft);
  if (!requiresExplicitApproval(guardrails, taskType)) {
    return { ...taskDraft, guardrails: loaded, explicitApprovalRequired: false };
  }

  const status = explicitApprovalStatus(guardrails);
  return {
    ...taskDraft,
    status,
    riskLevel: "high_risk",
    approvalRequired: 1,
    explicitApprovalRequired: true,
    guardrails: loaded,
    metadata: {
      ...(taskDraft.metadata || {}),
      guardrails: {
        ...(taskDraft.metadata?.guardrails || {}),
        explicit_approval_required: true,
        approval_status: status,
        task_type: taskType,
        source: loaded.path,
      },
    },
  };
}

function makeApprovalToken() {
  const token = crypto.randomBytes(18).toString("base64url");
  return {
    token,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
  };
}

function assertTaskExecutionAllowed(db, task, options = {}) {
  const loaded = loadGuardrails(options);
  const guardrails = loaded.config;
  if (!guardrails) return { enforced: false, guardrails_path: loaded.path };

  const taskType = taskTypeFor(task);
  if (requiresExplicitApproval(guardrails, taskType) && !hasExplicitApproval(db, task)) {
    throw new Error(
      `Task ${task.task_id} type '${taskType}' requires explicit approval by guardrails (${loaded.path}).`,
    );
  }

  const limit = options.checkDailyLimit ? assertDailyChangeLimit(db, guardrails, task) : null;
  return { enforced: true, guardrails_path: loaded.path, task_type: taskType, daily_limit: limit };
}

function assertDailyChangeLimit(db, guardrails, task) {
  const taskType = taskTypeFor(task);
  const category = DAILY_LIMIT_CATEGORY_BY_TASK_TYPE[taskType];
  const safetyCategory = SAFETY_LIMIT_CATEGORY_BY_TASK_TYPE[taskType];
  const max = category
    ? guardrails?.max_changes_per_day?.[category]
    : guardrails?.safety_limits?.[safetyCategory];
  const limitKey = category || safetyCategory;
  if (!limitKey || max === undefined || max === null) return null;

  const now = new Date();
  const { localDateOnly } = require("./dates");
  const localToday = localDateOnly(now);
  const dayStart = new Date(now.getTime() - 48 * 3600 * 1000).toISOString(); // fetch last 48h to be safe
  
  const rows = db
    .prepare("SELECT task_id, status, metadata_json, updated_at FROM tasks WHERE updated_at >= ?")
    .all(dayStart);
  
  const used = rows.filter((row) => {
    // Check if task updated_at falls on the same local date
    const rowDate = new Date(row.updated_at.endsWith('Z') ? row.updated_at : row.updated_at + 'Z');
    if (localDateOnly(rowDate) !== localToday) return false;
    
    if (row.task_id === task.task_id || !COUNTED_DAILY_STATUSES.has(row.status)) return false;
    const rowType = taskTypeFor(row);
    return (category && DAILY_LIMIT_CATEGORY_BY_TASK_TYPE[rowType] === category) ||
      (safetyCategory && SAFETY_LIMIT_CATEGORY_BY_TASK_TYPE[rowType] === safetyCategory);
  }).length;

  if (used >= Number(max)) {
    throw new Error(`Guardrail daily limit reached for ${limitKey}: ${used}/${max} already used today.`);
  }
  return { key: limitKey, used, max: Number(max) };
}

function hasExplicitApproval(db, task) {
  if (task.status === "approved") return true;
  if (!db || !task.task_id) return false;
  const row = db
    .prepare("SELECT approval_id FROM approvals WHERE task_id = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1")
    .get(task.task_id);
  return Boolean(row);
}

function assertExplicitApprovalTransitionAllowed(db, task, options = {}) {
  const loaded = loadGuardrails(options);
  const guardrails = loaded.config;
  const taskType = taskTypeFor(task);
  if (!requiresExplicitApproval(guardrails, taskType)) {
    return { required: false, guardrails_path: loaded.path, task_type: taskType };
  }
  if (!db || !task.task_id) {
    throw new Error(`Task ${task?.task_id || "(unknown)"} type '${taskType}' requires explicit approval by guardrails (${loaded.path}).`);
  }

  const approved = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1")
    .get(task.task_id);
  if (approved) {
    return {
      required: true,
      approved: true,
      approval_id: approved.approval_id,
      guardrails_path: loaded.path,
      task_type: taskType,
    };
  }

  const token = options.token || options.approvalToken || null;
  if (token) {
    const pending = db
      .prepare("SELECT * FROM approvals WHERE task_id = ? AND status IN ('waiting_for_approval', 'pending') ORDER BY requested_at DESC LIMIT 1")
      .get(task.task_id);
    if (pending && pending.approval_token_hash && hashApprovalToken(token) === pending.approval_token_hash) {
      return {
        required: true,
        approved: false,
        token_valid: true,
        approval_id: pending.approval_id,
        approval: pending,
        guardrails_path: loaded.path,
        task_type: taskType,
      };
    }
  }

  throw new Error(
    `Task ${task.task_id} type '${taskType}' requires an approved approval row or a valid --token before status can be set to approved.`,
  );
}

function hashApprovalToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

module.exports = {
  loadGuardrails,
  routeTaskCreationThroughGuardrails,
  makeApprovalToken,
  assertTaskExecutionAllowed,
  assertDailyChangeLimit,
  requiresExplicitApproval,
  assertExplicitApprovalTransitionAllowed,
  taskTypeFor,
};
