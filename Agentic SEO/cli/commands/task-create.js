#!/usr/bin/env node
/**
 * task-create.js â€” Create a task in the {{SITE_NAME}} SQLite state DB.
 *
 * Atomically inserts: task row â†’ event row â†’ outbox job in one transaction.
 * Supports all task fields including JSON evidence, metadata, locks, and tags.
 *
 * Usage:
 *   node task-create.js --title "Fix meta descriptions" [options]
 */

const { parseArgs, requireArg, numberArg, boolArg, listArg, jsonArg, resolveDbPath, exitWithError, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso, nowPlusDaysIso } = require('../lib/dates');
const { assertTaskStatus } = require('../lib/statuses');
const { routeTaskCreationThroughGuardrails, makeApprovalToken } = require('../lib/guardrails');

const HELP = `
task-create â€” Create a new task in the SQLite state database.

USAGE
  node task-create.js --title "Fix meta descriptions" [options]

REQUIRED
  --title <text>            Task title (required)

OPTIONAL â€” Task Fields
  --type <type>             Task type (e.g. meta_fix, new_page, content_refresh)
  --priority <1-1000>       Priority score (default: 100)
  --risk-level <level>      Risk level: safe | semi_safe | high_risk (default: semi_safe)
  --status <status>         Initial status (default: candidate)
  --source <source>         Source identifier (e.g. gsc_analysis, crawler, manual)
  --target-url <url>        Target URL for the task
  --target-file <path>      Target file path
  --target-keyword <kw>     Target keyword
  --description <text>      Task description

OPTIONAL â€” Structured Data
  --evidence <json>         Evidence JSON object (merged into metadata)
  --metadata <json>         Additional metadata JSON object
  --locks <json>            Lock requirements as JSON array
                            e.g. '[{"lock_type":"file_lock","resource_id":"index.html"}]'
  --parent-task <id>        Parent task ID (stored in metadata)
  --tags <list>             Comma-separated tags (stored in metadata)

OPTIONAL â€” Scheduling (deferred follow-ups)
  --scheduled-for <iso>     Do not let workers pick this task until this UTC time.
  --scheduled-in-days <n>   Defer eligibility by N days from now (e.g. 14).
                            A deferred task is still created status='approved';
                            it just stays invisible to the picker until due.

OPTIONAL â€” Behavior
  --no-event                Skip inserting the event row
  --no-outbox               Skip inserting the outbox job
  --allow-missing-blog-cannibalization-check
                            Emergency/legacy bypass for new_blog_post evidence gate
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without touching the database

EXAMPLES
  node task-create.js --title "Add schema markup to /{{AUDIENCE}}" \\
    --type schema_markup --priority 500 --risk-level safe \\
    --target-url "https://client.com/{{AUDIENCE}}" \\
    --source manual --tags "schema,quick-win"

  node task-create.js --title "Refresh drain cleaning page" \\
    --type content_refresh --priority 750 --risk-level semi_safe \\
    --target-url "https://client.com/drain-cleaning" \\
    --evidence '{"current_position":12,"impressions":450}' \\
    --db ./state.db
`.trim();

const VALID_RISK_LEVELS = new Set(['safe', 'semi_safe', 'high_risk']);

// Collapse runs of whitespace to a single space and trim. Producers sometimes
// derive a keyword/title from a competitor H1 with punctuation stripped, which
// leaves double spaces (e.g. "ppc marketing for {{AUDIENCE}} 2026  guide ..."); that
// pollutes keyword tracking/SERP checks and dedupe. Normalize at the write edge.
function normalizeWhitespace(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sampleId = 'TSK-2026-06-03-A1B2C3D4';
    const sample = {
      task: {
        task_id: sampleId,
        title: 'Add schema markup to /{{AUDIENCE}}',
        description: 'Add LocalBusiness + {{AUDIENCE}} schema to the {{AUDIENCE}} service page',
        status: 'candidate',
        risk_level: 'safe',
        priority_score: 500,
        source: 'manual',
        target_url: 'https://client.com/{{AUDIENCE}}',
        target_file: '{{AUDIENCE}}/index.html',
        target_keyword: '{{AUDIENCE}} near me',
        created_at: nowIso(),
        updated_at: nowIso(),
        metadata_json: JSON.stringify({
          task_type: 'schema_markup',
          tags: ['schema', 'quick-win'],
          evidence: { current_position: 12, impressions: 450 },
          locks: [{ lock_type: 'file_lock', resource_id: '{{AUDIENCE}}/index.html' }],
        }),
      },
      event_id: 'EVT-2026-06-03-E1F2G3H4',
      outbox_id: 'OUT-2026-06-03-I1J2K3L4',
    };
    printOutput(envelope(sample, { tool: 'task-create' }), getOutputFormat(args));
    return;
  }

  try {
    // â”€â”€ Validate inputs â”€â”€
    const title = normalizeWhitespace(requireArg(args, 'title', 'Missing required argument: --title'));

    const taskType = args.type || null;
    const priority = numberArg(args, 'priority', 100);
    if (priority < 1 || priority > 1000) {
      throw new Error('--priority must be between 1 and 1000');
    }

    let riskLevel = args['risk-level'] || 'semi_safe';
    if (!VALID_RISK_LEVELS.has(riskLevel)) {
      throw new Error(`--risk-level must be one of: ${[...VALID_RISK_LEVELS].join(', ')}`);
    }

    let status = args.status || 'candidate';
    assertTaskStatus(status, '--status');

    const source = args.source || 'cli';
    const targetUrl = args['target-url'] || null;
    const targetFile = args['target-file'] || null;
    const targetKeyword = normalizeWhitespace(args['target-keyword']);
    const description = args.description || null;
    const parentTask = args['parent-task'] || null;

    const evidence = jsonArg(args, 'evidence', {});
    const extraMetadata = jsonArg(args, 'metadata', {});
    const locks = jsonArg(args, 'locks', []);
    const tags = listArg(args, 'tags', []);

    const skipEvent = boolArg(args, 'no-event', false);
    const skipOutbox = boolArg(args, 'no-outbox', false);
    const allowMissingBlogCannibalizationCheck = boolArg(args, 'allow-missing-blog-cannibalization-check', false);

    // Deferral: a task with a future scheduled_for is created normally but stays
    // invisible to `task next` until the due time passes (see task-next.js). This
    // is how a follow-up enqueued now (e.g. status='approved') runs in ~14 days.
    const scheduledFor = resolveScheduledFor(args);

    assertNewBlogCannibalizationEvidence({
      title,
      taskType,
      evidence,
      allowMissing: allowMissingBlogCannibalizationCheck,
    });

    // â”€â”€ Build metadata â”€â”€
    let metadata = {
      ...extraMetadata,
      task_type: taskType,
      tags: tags.length > 0 ? tags : (extraMetadata.tags || []),
      evidence,
      locks,
      generated_by: 'task-create-cli',
    };
    if (parentTask) {
      metadata.parent_task_id = parentTask;
    }

    let approvalRequired = riskLevel === 'high_risk' ? 1 : 0;
    const guardrailRoute = routeTaskCreationThroughGuardrails({
      taskType,
      status,
      riskLevel,
      approvalRequired,
      metadata,
    });
    status = guardrailRoute.status;
    riskLevel = guardrailRoute.riskLevel;
    approvalRequired = guardrailRoute.approvalRequired;
    metadata = guardrailRoute.metadata;

    // â”€â”€ Open DB and insert atomically â”€â”€
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    const now = nowIso();
    const taskId = makeId('TSK');
    let eventId = null;
    let outboxId = null;
    let approvalId = null;
    let approvalToken = null;
    let approvalEventId = null;
    const approvalOutboxIds = [];

    if (guardrailRoute.explicitApprovalRequired) {
      approvalId = makeId('APP');
      const approvalTokenData = makeApprovalToken();
      approvalToken = approvalTokenData.token;
      metadata.guardrails.approval_id = approvalId;
      metadata.guardrails.approval_token_hash = approvalTokenData.tokenHash;
    }

    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 1. Insert task
      db.prepare(`
        INSERT INTO tasks (
          task_id, title, description, status, risk_level, priority_score, source,
          target_url, target_file, target_keyword, approval_required, scheduled_for,
          created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId, title, description, status, riskLevel, priority,
        source, targetUrl, targetFile, targetKeyword, approvalRequired, scheduledFor,
        now, now, JSON.stringify(metadata)
      );

      if (guardrailRoute.explicitApprovalRequired) {
        db.prepare(`
          INSERT INTO approvals (
            approval_id, task_id, status, approval_token_hash, requested_at,
            source_email, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          approvalId, taskId, status, metadata.guardrails.approval_token_hash,
          now, null, JSON.stringify({
            approval_id: approvalId,
            task_id: taskId,
            task_title: title,
            task_type: taskType,
            source_email: null,
            approval_required: true,
            guardrails_path: guardrailRoute.guardrails.path,
          })
        );
      }

      // 2. Insert event (unless --no-event)
      if (!skipEvent) {
        eventId = makeId('EVT');
        db.prepare(`
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, 'task_created', taskId, 'task', taskId,
          null, status, source, 'task-create-cli', now,
          JSON.stringify({ title, risk_level: riskLevel, priority_score: priority })
        );
        if (guardrailRoute.explicitApprovalRequired) {
          approvalEventId = makeId('EVT');
          db.prepare(`
            INSERT INTO events (
              event_id, event_type, task_id, resource_type, resource_id,
              old_value, new_value, source, agent_name, created_at, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            approvalEventId, 'approval_requested', taskId, 'approval', approvalId,
            null, status, 'guardrails', 'task-create-cli', now,
            JSON.stringify({
              approval_id: approvalId,
              task_type: taskType,
              guardrails_path: guardrailRoute.guardrails.path,
            })
          );
        }
      }

      // 3. Insert outbox job (unless --no-outbox)
      if (!skipOutbox) {
        outboxId = makeId('OUT');
        db.prepare(`
          INSERT INTO outbox_jobs (
            outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          outboxId, 'update_obsidian_task_note', 'task', taskId,
          JSON.stringify({
            task_id: taskId,
            status,
            risk_level: riskLevel,
            priority_score: priority,
            source_of_truth: 'SQLite',
          }),
          'pending', now
        );
        if (guardrailRoute.explicitApprovalRequired) {
          const approvalRequestOutboxId = makeId('OUT');
          approvalOutboxIds.push(approvalRequestOutboxId);
          db.prepare(`
            INSERT INTO outbox_jobs (
              outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            approvalRequestOutboxId, 'send_approval_request_email', 'approval', approvalId,
            JSON.stringify({
              approval_id: approvalId,
              task_id: taskId,
              task_title: title,
              task_type: taskType,
              approval_token: approvalToken,
              approval_required: true,
              guardrails_path: guardrailRoute.guardrails.path,
            }),
            'pending', now
          );

          const approvalNoteOutboxId = makeId('OUT');
          approvalOutboxIds.push(approvalNoteOutboxId);
          db.prepare(`
            INSERT INTO outbox_jobs (
              outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            approvalNoteOutboxId, 'update_obsidian_approval_note', 'approval', approvalId,
            JSON.stringify({
              approval_id: approvalId,
              task_id: taskId,
              task_title: title,
              task_type: taskType,
              guardrails_path: guardrailRoute.guardrails.path,
            }),
            'pending', now
          );
        }
      }

      db.exec('COMMIT');
    } catch (txError) {
      db.exec('ROLLBACK');
      throw txError;
    }

    // â”€â”€ Fetch the created task back â”€â”€
    const created = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
    db.close();

    const result = {
      task: created,
      event_id: eventId,
      outbox_id: outboxId,
      approval_id: approvalId,
      approval_event_id: approvalEventId,
      approval_outbox_ids: approvalOutboxIds,
      approval_token: approvalToken,
    };

    printOutput(envelope(result, { tool: 'task-create' }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'task-create' }), 'json');
    process.exitCode = 1;
  }
}

// Resolve an optional deferral timestamp from either an explicit ISO value
// (--scheduled-for) or a relative window in days (--scheduled-in-days). Returns
// null when neither is supplied (task is immediately eligible).
function resolveScheduledFor(args) {
  const explicit = args['scheduled-for'];
  if (explicit) {
    const date = new Date(String(explicit));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`--scheduled-for must be a valid date/time (got "${explicit}")`);
    }
    return date.toISOString();
  }
  if (args['scheduled-in-days'] !== undefined) {
    const days = Number(args['scheduled-in-days']);
    if (!Number.isFinite(days) || days < 0) {
      throw new Error('--scheduled-in-days must be a non-negative number');
    }
    return nowPlusDaysIso(days);
  }
  return null;
}

function assertNewBlogCannibalizationEvidence({ title, taskType, evidence, allowMissing }) {
  const isNewBlog = taskType === 'new_blog_post' || /^create blog:/i.test(String(title || ''));
  if (!isNewBlog || allowMissing) return;

  const check = evidence && typeof evidence === 'object' ? evidence.blog_cannibalization_check : null;
  const recommendation = check && typeof check === 'object' ? check.recommendation : null;
  if (recommendation) return;

  throw new Error(
    'new_blog_post tasks require --evidence with blog_cannibalization_check. ' +
    'Run `v2 content blog-cannibalization --topic "<topic>" --target-keyword "<keyword>" --support-url "<url>" --site-root <site>` first, ' +
    'or pass --allow-missing-blog-cannibalization-check only for an intentional legacy/recovery import.'
  );
}

if (require.main === module) {
  main();
}

module.exports = main;
