#!/usr/bin/env node
/**
 * task-update.js â€” Update task(s) in the {{SITE_NAME}} SQLite state DB.
 *
 * Supports single task update, multi-ID batch, and WHERE-based bulk updates.
 * Atomically: BEGIN â†’ UPDATE task â†’ INSERT event â†’ INSERT outbox â†’ COMMIT.
 *
 * Usage:
 *   node task-update.js --id TSK-xxx --status approved [options]
 */

const { parseArgs, requireArg, numberArg, boolArg, listArg, jsonArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');
const { assertTaskStatus } = require('../lib/statuses');
const { assertExplicitApprovalTransitionAllowed } = require('../lib/guardrails');

const HELP = `
task-update â€” Update one or more tasks in the SQLite state database.

USAGE
  node task-update.js --id <task_id> [updates]
  node task-update.js --ids <id1,id2,...> [updates]
  node task-update.js --where-status <status> [--where-type <type>] [updates]

TARGET SELECTION (pick one)
  --id <task_id>            Update a single task by ID
  --ids <list>              Comma-separated list of task IDs
  --where-status <status>   Batch: match tasks with this status
  --where-type <type>       Batch: match tasks with this task_type (metadata)
  --where-stale-days <n>    Batch: match tasks not updated in N days

UPDATES
  --status <status>         New status
  --priority <1-1000>       New priority score
  --risk-level <level>      New risk level (safe|semi_safe|high_risk)
  --note <text>             Timestamped note appended to metadata_json.notes[]
  --evidence <json>         Evidence JSON merged into metadata_json.evidence
  --add-tag <tag>           Add a tag to metadata_json.tags[]
  --remove-tag <tag>        Remove a tag from metadata_json.tags[]
  --assign <agent>          Assign task to an agent (stored in metadata)
  --token <token>           Approval token required for explicit-approval tasks

BEHAVIOR
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --csv                     Output as CSV
  --sample                  Show sample output without touching the database

EXAMPLES
  node task-update.js --id TSK-2026-06-03-A1B2C3D4 --status approved
  node task-update.js --ids TSK-001,TSK-002 --priority 800 --add-tag urgent
  node task-update.js --where-status candidate --where-stale-days 14 --status deferred
  node task-update.js --id TSK-001 --note "Reviewed, looks good" --evidence '{"reviewed":true}'
`.trim();

const VALID_RISK_LEVELS = new Set(['safe', 'semi_safe', 'high_risk']);

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = {
      results: [
        {
          task_id: 'TSK-2026-06-03-A1B2C3D4',
          title: 'Add schema markup to /{{AUDIENCE}}',
          status: 'approved',
          priority_score: 500,
          updated_at: nowIso(),
        },
      ],
      total_updated: 1,
      event_ids: ['EVT-2026-06-03-E1F2G3H4'],
      outbox_ids: ['OUT-2026-06-03-I1J2K3L4'],
    };
    printOutput(envelope(sample, { tool: 'task-update' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    // â”€â”€ Resolve target task IDs â”€â”€
    let taskIds = [];

    if (args.id) {
      taskIds = [args.id];
    } else if (args.ids) {
      taskIds = listArg(args, 'ids');
    } else if (args['where-status'] || args['where-type'] || args['where-stale-days']) {
      // Build WHERE query to find matching task IDs
      const conditions = [];
      const params = [];

      if (args['where-status']) {
        conditions.push('status = ?');
        params.push(args['where-status']);
      }
      if (args['where-type']) {
        conditions.push(`json_extract(metadata_json, '$.task_type') = ?`);
        params.push(args['where-type']);
      }
      if (args['where-stale-days']) {
        const cutoff = new Date(Date.now() - Number(args['where-stale-days']) * 86400000).toISOString();
        conditions.push('updated_at < ?');
        params.push(cutoff);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT task_id FROM tasks ${whereClause}`).all(...params);
      taskIds = rows.map(r => r.task_id);

      if (taskIds.length === 0) {
        db.close();
        printOutput(envelope({ updated: [], total_updated: 0, message: 'No tasks matched the WHERE criteria' }, { tool: 'task-update' }), getOutputFormat(args));
        return;
      }
    } else {
      throw new Error('Specify a target: --id, --ids, or --where-status/--where-type/--where-stale-days');
    }

    // â”€â”€ Validate update values â”€â”€
    const newStatus = args.status || null;
    if (newStatus) assertTaskStatus(newStatus, '--status');

    const newPriority = args.priority !== undefined ? numberArg(args, 'priority') : null;
    if (newPriority !== null && (newPriority < 1 || newPriority > 1000)) {
      throw new Error('--priority must be between 1 and 1000');
    }

    const newRiskLevel = args['risk-level'] || null;
    if (newRiskLevel && !VALID_RISK_LEVELS.has(newRiskLevel)) {
      throw new Error(`--risk-level must be one of: ${[...VALID_RISK_LEVELS].join(', ')}`);
    }

    const note = args.note || null;
    const newEvidence = jsonArg(args, 'evidence', null);
    const addTag = args['add-tag'] || null;
    const removeTag = args['remove-tag'] || null;
    const assign = args.assign || null;

    if (!newStatus && newPriority === null && !newRiskLevel && !note && !newEvidence && !addTag && !removeTag && !assign) {
      throw new Error('No updates specified. Use --status, --priority, --risk-level, --note, --evidence, --add-tag, --remove-tag, or --assign');
    }

    const now = nowIso();
    const eventIds = [];
    const outboxIds = [];
    const updatedTasks = [];

    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const taskId of taskIds) {
        // Fetch current task
        const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
        if (!task) {
          continue; // Skip non-existent tasks
        }

        // â”€â”€ Build SET clause dynamically â”€â”€
        const approvalTransition = newStatus === 'approved'
          ? assertExplicitApprovalTransitionAllowed(db, task, { token: args.token || args['approval-token'] })
          : null;

        const setClauses = ['updated_at = ?'];
        const setParams = [now];
        const changes = {};

        if (newStatus) {
          setClauses.push('status = ?');
          setParams.push(newStatus);
          changes.status = { old: task.status, new: newStatus };

          // If completing, set completed_at
          if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'skipped') {
            setClauses.push('completed_at = ?');
            setParams.push(now);
          }
        }

        if (newPriority !== null) {
          setClauses.push('priority_score = ?');
          setParams.push(newPriority);
          changes.priority_score = { old: task.priority_score, new: newPriority };
        }

        if (newRiskLevel) {
          setClauses.push('risk_level = ?');
          setParams.push(newRiskLevel);
          changes.risk_level = { old: task.risk_level, new: newRiskLevel };
        }

        // â”€â”€ Metadata mutations â”€â”€
        let metadata = {};
        try { metadata = JSON.parse(task.metadata_json || '{}'); } catch { metadata = {}; }

        let metadataChanged = false;

        if (note) {
          if (!Array.isArray(metadata.notes)) metadata.notes = [];
          metadata.notes.push({ text: note, added_at: now, source: 'task-update-cli' });
          metadataChanged = true;
        }

        if (newEvidence) {
          metadata.evidence = { ...(metadata.evidence || {}), ...newEvidence };
          metadataChanged = true;
        }

        if (addTag) {
          if (!Array.isArray(metadata.tags)) metadata.tags = [];
          if (!metadata.tags.includes(addTag)) {
            metadata.tags.push(addTag);
            metadataChanged = true;
          }
        }

        if (removeTag) {
          if (Array.isArray(metadata.tags)) {
            const idx = metadata.tags.indexOf(removeTag);
            if (idx !== -1) {
              metadata.tags.splice(idx, 1);
              metadataChanged = true;
            }
          }
        }

        if (assign) {
          // Capture the previous assignee before overwriting, otherwise the
          // event records old === new.
          changes.assigned_to = { old: metadata.assigned_to || null, new: assign };
          metadata.assigned_to = assign;
          metadataChanged = true;
        }

        if (metadataChanged) {
          setClauses.push('metadata_json = ?');
          setParams.push(JSON.stringify(metadata));
        }

        // â”€â”€ Execute UPDATE â”€â”€
        setParams.push(taskId);
        db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE task_id = ?`).run(...setParams);

        if (approvalTransition && approvalTransition.token_valid && approvalTransition.approval) {
          const approval = approvalTransition.approval;
          const approvedBy = args.by || args.email || 'task-update-cli';
          const approvalPayload = {
            ...safeJson(approval.metadata_json),
            approval_id: approval.approval_id,
            task_id: taskId,
            decision: 'approved',
            decided_by: approvedBy,
            source: 'task-update-cli',
          };
          db.prepare(`
            UPDATE approvals
            SET status = 'approved', approved_at = ?, approved_by = ?, metadata_json = ?
            WHERE approval_id = ?
          `).run(now, approvedBy, JSON.stringify(approvalPayload), approval.approval_id);

          const approvalEventId = makeId('EVT');
          eventIds.push(approvalEventId);
          db.prepare(`
            INSERT INTO events (
              event_id, event_type, task_id, resource_type, resource_id,
              old_value, new_value, source, agent_name, created_at, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            approvalEventId, 'approval_approved', taskId, 'approval', approval.approval_id,
            approval.status, 'approved',
            'cli', 'task-update-cli', now,
            JSON.stringify(approvalPayload)
          );

          const approvalOutboxId = makeId('OUT');
          outboxIds.push(approvalOutboxId);
          db.prepare(`
            INSERT INTO outbox_jobs (
              outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            approvalOutboxId, 'update_obsidian_approval_note', 'approval', approval.approval_id,
            JSON.stringify(approvalPayload),
            'pending', now
          );

          changes.approval = { approval_id: approval.approval_id, token_used: true };
        }

        // â”€â”€ Insert event â”€â”€
        const eventId = makeId('EVT');
        eventIds.push(eventId);

        const eventType = newStatus ? 'task_status_changed' : 'task_updated';
        db.prepare(`
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, eventType, taskId, 'task', taskId,
          newStatus ? task.status : null,
          newStatus || null,
          'cli', 'task-update-cli', now,
          JSON.stringify(changes)
        );

        // â”€â”€ Insert outbox job â”€â”€
        const outboxId = makeId('OUT');
        outboxIds.push(outboxId);
        db.prepare(`
          INSERT INTO outbox_jobs (
            outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          outboxId, 'update_obsidian_task_note', 'task', taskId,
          JSON.stringify({ task_id: taskId, status: newStatus || task.status, source_of_truth: 'SQLite' }),
          'pending', now
        );

        // Fetch updated task
        const updated = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
        updatedTasks.push(updated);
      }

      db.exec('COMMIT');
    } catch (txError) {
      db.exec('ROLLBACK');
      throw txError;
    }

    db.close();

    const result = {
      results: updatedTasks,
      total_updated: updatedTasks.length,
      event_ids: eventIds,
      outbox_ids: outboxIds,
    };

    printOutput(envelope(result, { tool: 'task-update' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'task-update' }), 'json');
    process.exitCode = 1;
  }
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
