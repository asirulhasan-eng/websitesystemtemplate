const OUTBOX_ACTIVE = Object.freeze(["pending", "retrying", "processing"]);
const OUTBOX_RETRYABLE = Object.freeze(["pending", "retrying"]);
const OUTBOX_RESOLVED = Object.freeze(["resolved"]);
const OUTBOX_TERMINAL = Object.freeze(["completed", "sent", "failed", "dead_letter", ...OUTBOX_RESOLVED]);
const OUTBOX_EMAIL_JOB_TYPES = Object.freeze([
  "send_approval_request_email",
  "send_monitor_alert",
  "send_daily_email_summary",
  "send_preview_email",
]);

function sqlList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(",");
}

function isSmtpAuthFailure(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  const authFailure = text.includes("authentication failed")
    || text.includes("auth failed")
    || text.includes("invalid login")
    || text.includes("535")
    || text.includes("5.7.8");
  return text.includes("smtp") && authFailure;
}

module.exports = {
  OUTBOX_ACTIVE,
  OUTBOX_RETRYABLE,
  OUTBOX_RESOLVED,
  OUTBOX_TERMINAL,
  OUTBOX_EMAIL_JOB_TYPES,
  isSmtpAuthFailure,
  sqlList,
};
