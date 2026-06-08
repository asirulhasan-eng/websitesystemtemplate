#!/usr/bin/env node
const crypto = require("node:crypto");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { openStateDb, makeId } = require("../lib/state_db");
const { assertTaskStatus } = require("../lib/statuses");

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const action = args._positional[0] || args.action || "list";
  const db = openStateDb(args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db");
  let output;

  if (action === "request") output = requestApproval(db, args);
  else if (action === "approve") output = decideApproval(db, args, "approved");
  else if (action === "reject") output = decideApproval(db, args, "rejected");
  else if (action === "list") output = listApprovals(db, args);
  else throw new Error(`Unknown approval action: ${action}`);

  db.close();
  console.log(JSON.stringify(output, null, 2));
}

function requestApproval(db, args) {
  const taskId = requireArg(args, "task");
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const now = nowIso();
  const waitingStatus = assertTaskStatus("waiting_for_approval");
  const approvalId = args["approval-id"] || makeId("APP");
  const token = args.token || crypto.randomBytes(18).toString("base64url");
  const tokenHash = hashToken(token);
  const payload = {
    approval_id: approvalId,
    task_id: taskId,
    task_title: task.title,
    source_email: args.email || null,
    approval_required: true,
  };

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      `
        INSERT INTO approvals (
          approval_id, task_id, status, approval_token_hash, requested_at,
          source_email, metadata_json
        ) VALUES (?, ?, 'waiting_for_approval', ?, ?, ?, ?)
      `,
    ).run(approvalId, taskId, tokenHash, now, args.email || null, JSON.stringify(payload));

    db.prepare("UPDATE tasks SET status = ?, approval_required = 1, updated_at = ? WHERE task_id = ?").run(
      waitingStatus,
      now,
      taskId,
    );

    insertEvent(db, "approval_requested", taskId, "approval", approvalId, task.status, waitingStatus, now, payload);
    insertOutbox(db, "send_approval_request_email", "approval", approvalId, { ...payload, approval_token: token }, now);
    insertOutbox(db, "update_obsidian_approval_note", "approval", approvalId, payload, now);

    db.exec("COMMIT");
    return { ok: true, approval_id: approvalId, task_id: taskId, status: waitingStatus, approval_token: token };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function decideApproval(db, args, decision) {
  const approvalId = args.id || null;
  const taskId = args.task || null;
  if (!approvalId && !taskId) throw new Error("Pass --id or --task.");

  const approval = approvalId
    ? db.prepare("SELECT * FROM approvals WHERE approval_id = ?").get(approvalId)
    : db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY requested_at DESC LIMIT 1").get(taskId);
  if (!approval) throw new Error("Approval not found.");

  // Prevent re-approval/re-rejection
  if (approval.status === 'approved' || approval.status === 'rejected') {
    throw new Error(`Approval ${approval.approval_id} has already been ${approval.status}. Cannot change decision.`);
  }

  // Validate token for ALL decisions (not just approvals)
  const token = requireArg(args, "token");
  if (approval.approval_token_hash && hashToken(token) !== approval.approval_token_hash) {
    throw new Error("Approval token does not match.");
  }

  const now = nowIso();
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(approval.task_id);
  const taskStatus = assertTaskStatus(decision === "approved" ? "approved" : "rejected");
  const payload = {
    approval_id: approval.approval_id,
    task_id: approval.task_id,
    decision,
    decided_by: args.by || args.email || null,
    note: args.note || null,
  };

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      `
        UPDATE approvals
        SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
            rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END,
            approved_by = ?, metadata_json = ?
        WHERE approval_id = ?
      `,
    ).run(decision, decision, now, decision, now, args.by || args.email || null, JSON.stringify(payload), approval.approval_id);

    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(taskStatus, now, approval.task_id);
    insertEvent(
      db,
      `approval_${decision}`,
      approval.task_id,
      "approval",
      approval.approval_id,
      approval.status,
      decision,
      now,
      payload,
    );
    insertOutbox(db, "update_obsidian_approval_note", "approval", approval.approval_id, payload, now);
    insertOutbox(db, "update_obsidian_task_note", "task", approval.task_id, payload, now);

    db.exec("COMMIT");
    return { ok: true, approval_id: approval.approval_id, task_id: approval.task_id, status: decision, task_status: taskStatus };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listApprovals(db, args) {
  const status = args.status || "waiting_for_approval";
  const rows = db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC LIMIT 100").all(status);
  return { ok: true, status, count: rows.length, approvals: rows };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function insertEvent(db, eventType, taskId, resourceType, resourceId, oldValue, newValue, createdAt, metadata) {
  db.prepare(
    `
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id, old_value,
        new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approval_manager', 'Approval Manager', ?, ?)
    `,
  ).run(makeId("EVT"), eventType, taskId, resourceType, resourceId, oldValue, newValue, createdAt, JSON.stringify(metadata || {}));
}

function insertOutbox(db, jobType, entityType, entityId, payload, createdAt) {
  db.prepare(
    `
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `,
  ).run(makeId("OUT"), jobType, entityType, entityId, JSON.stringify(payload || {}), createdAt);
}

function printHelp() {
  console.log(`
Usage:
  v2 task approve request --task CAND-2026-05-26-ABC12345 --email owner@example.com
  v2 task approve approve --id APP-2026-05-26-ABC12345 --token TOKEN --by owner@example.com
  v2 task approve reject --task CAND-2026-05-26-ABC12345 --note "Not now"
  v2 task approve list --status waiting_for_approval

Options:
  --db path     SQLite DB path.
  --task id     Task ID.
  --id id       Approval ID.
  --token x     Approval token for approve.
  --email x     Source or approver email.
`);
}

if (require.main === module) {
  main();
}

module.exports = main;
