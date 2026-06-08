// Shared email parsing helpers used by fetch_gmail_approvals.js and check_email_approvals.js
// Extracted to eliminate code duplication between the two tools.

/**
 * Parse RFC-822 style headers from a raw email message.
 * Handles header continuation (folded lines).
 */
function parseHeaders(rawMessage) {
  const headerText = String(rawMessage).split(/\r?\n\r?\n/)[0] || "";
  const lines = headerText.split(/\r?\n/);
  const headers = {};
  let current = null;
  for (const line of lines) {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    current = match[1].toLowerCase();
    headers[current] = match[2].trim();
  }
  return headers;
}

/**
 * Extract all thread-related IDs from email headers
 * (Message-ID, In-Reply-To, References).
 */
function threadIdsFromHeaders(headers) {
  return [
    headers["message-id"],
    headers["in-reply-to"],
    ...(headers.references ? headers.references.split(/\s+/) : []),
  ]
    .filter(Boolean)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Normalize an email address from a From: header value.
 * Extracts the bare email from formats like "Name <email@example.com>".
 */
function normalizeEmail(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : String(value || "").trim().toLowerCase();
}

/**
 * Parse a comma-separated string into a trimmed, lowercased array.
 */
function emailListArg(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = {
  parseHeaders,
  threadIdsFromHeaders,
  normalizeEmail,
  emailListArg,
};
