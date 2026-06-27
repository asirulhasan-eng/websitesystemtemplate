const TASK_STATUSES = Object.freeze([
  "candidate",
  "pending",
  "approved",
  "waiting_for_approval",
  "needs_review",
  "queued",
  "in_progress",
  "preview_ready",
  "preview_pushed",
  "preview_validated",
  "executed",
  "monitored",
  "completed",
  "deployed",
  "deployed_to_production",
  "blocked",
  "failed",
  "skipped",
  "rejected",
  "deferred",
  "cancelled",
  "rollback",
]);

const TASK_STATUS_SET = new Set(TASK_STATUSES);
const COMPLETED_TASK_STATUSES = new Set([
  "completed",
  "deployed",
  "deployed_to_production",
  "failed",
  "skipped",
  "rejected",
  "cancelled",
  "rollback",
]);

// Must cover every status updateTaskState writes, plus worker-side terminal/review
// statuses that should wake the feedback analyst.
const FEEDBACK_ACTIVITY_STATUSES = Object.freeze([
  "preview_ready",
  "preview_pushed",
  "preview_validated",
  "executed",
  "deployed",
  "deployed_to_production",
  "completed",
  "failed",
  "needs_review",
  "skipped",
  "cancelled",
  "rollback",
  "monitored",
]);

function isTaskStatus(status) {
  return TASK_STATUS_SET.has(status);
}

function assertTaskStatus(status, label = "status") {
  if (!isTaskStatus(status)) {
    throw new Error(`${label} must be one of: ${TASK_STATUSES.join(", ")}`);
  }
  return status;
}

function isCompletedTaskStatus(status) {
  return COMPLETED_TASK_STATUSES.has(status);
}

module.exports = {
  TASK_STATUSES,
  TASK_STATUS_SET,
  COMPLETED_TASK_STATUSES,
  FEEDBACK_ACTIVITY_STATUSES,
  isTaskStatus,
  assertTaskStatus,
  isCompletedTaskStatus,
};
