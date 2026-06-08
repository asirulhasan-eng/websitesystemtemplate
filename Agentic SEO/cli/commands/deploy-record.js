#!/usr/bin/env node
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { openStateDb, makeId } = require("../lib/state_db");
const { routeTask } = require("../lib/task_routing");
const { assertTaskStatus } = require("../lib/statuses");
const { assertTaskExecutionAllowed } = require("../lib/guardrails");

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const action = args._positional[0] || args.action || "list";
  const db = openStateDb(args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db");
  let output;

  try {
    if (action === "start") output = startDeployment(db, args);
    else if (action === "finish") output = finishDeployment(db, args, args.status || "deployed");
    else if (action === "fail") output = finishDeployment(db, args, "failed");
    else if (action === "list") output = listDeployments(db, args);
    else throw new Error(`Unknown deployment action: ${action}`);
  } finally {
    db.close();
  }

  console.log(JSON.stringify(output, null, 2));
}

function startDeployment(db, args) {
  const taskId = args.task || null;
  const deploymentType = args.type || "preview";
  const deploymentId = args.id || makeId("DEP");
  const now = nowIso();
  const payload = {
    deployment_id: deploymentId,
    task_id: taskId,
    deployment_type: deploymentType,
    branch_name: args.branch || null,
    preview_url: args.preview || null,
    production_url: args.production || null,
  };

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      `
        INSERT INTO deployments (
          deployment_id, task_id, branch_name, commit_sha, deployment_type,
          cloudflare_deployment_id, preview_url, production_url, status,
          started_at, validation_status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
      `,
    ).run(
      deploymentId,
      taskId,
      args.branch || null,
      args.commit || null,
      deploymentType,
      args["cloudflare-id"] || null,
      args.preview || null,
      args.production || null,
      now,
      args["validation-status"] || null,
      JSON.stringify(payload),
    );

    insertEvent(db, "deployment_started", taskId, "deployment", deploymentId, null, "running", now, payload);
    insertOutbox(db, "update_obsidian_deployment_note", "deployment", deploymentId, payload, now);
    db.exec("COMMIT");
    return { ok: true, deployment_id: deploymentId, status: "running" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function finishDeployment(db, args, status) {
  const deploymentId = requireArg(args, "id");
  const deployment = db.prepare("SELECT * FROM deployments WHERE deployment_id = ?").get(deploymentId);
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);

  const now = nowIso();
  const task = deployment.task_id ? db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(deployment.task_id) : null;
  if (status === "preview_ready" && task && isBlogContentDeploymentTask(task)) {
    throw new Error(
      "Blog content preview_ready must be recorded with tools/record_blog_preview_ready.js and passed validation evidence; " +
      "record_deployment.js cannot bypass that validation gate.",
    );
  }
  if (task && (status === "deployed" || status === "preview_ready")) {
    assertTaskExecutionAllowed(db, task, { checkDailyLimit: status === "deployed" });
  }
  const payload = {
    deployment_id: deploymentId,
    task_id: deployment.task_id,
    status,
    preview_url: args.preview || deployment.preview_url,
    production_url: args.production || deployment.production_url,
    validation_status: args["validation-status"] || deployment.validation_status,
    error: args.error || null,
  };

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      `
        UPDATE deployments
        SET status = ?, finished_at = ?, preview_url = ?, production_url = ?,
            validation_status = ?, metadata_json = ?
        WHERE deployment_id = ?
      `,
    ).run(
      status,
      now,
      args.preview || deployment.preview_url,
      args.production || deployment.production_url,
      args["validation-status"] || deployment.validation_status,
      JSON.stringify(payload),
      deploymentId,
    );

    if (deployment.task_id && (status === "deployed" || status === "preview_ready")) {
      assertTaskStatus(status);
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(status, now, deployment.task_id);
    }

    insertEvent(db, `deployment_${status}`, deployment.task_id, "deployment", deploymentId, deployment.status, status, now, payload);
    insertOutbox(db, "update_obsidian_deployment_note", "deployment", deploymentId, payload, now);
    if (deployment.task_id) insertOutbox(db, "update_obsidian_task_note", "task", deployment.task_id, payload, now);

    db.exec("COMMIT");
    return { ok: true, deployment_id: deploymentId, status };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listDeployments(db, args) {
  const status = args.status || "running";
  const rows = db.prepare("SELECT * FROM deployments WHERE status = ? ORDER BY started_at DESC LIMIT 100").all(status);
  return { ok: true, status, count: rows.length, deployments: rows };
}

function isBlogContentDeploymentTask(task) {
  const route = routeTask(task, { has_approved_approval: true });
  return route.execution_lane === "blog_content";
}

function insertEvent(db, eventType, taskId, resourceType, resourceId, oldValue, newValue, createdAt, metadata) {
  db.prepare(
    `
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id, old_value,
        new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'deployment_recorder', 'Deployment Recorder', ?, ?)
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
  node tools/record_deployment.js start --task CAND-2026-05-26-ABC12345 --type preview --branch agent/task
  node tools/record_deployment.js finish --id DEP-2026-05-26-ABC12345 --status preview_ready --preview https://preview.example
  node tools/record_deployment.js fail --id DEP-2026-05-26-ABC12345 --error "Cloudflare failed"
  node tools/record_deployment.js list --status running

Options:
  --db path                 SQLite DB path.
  --task id                 Related task ID.
  --type preview|production Deployment type.
  --branch name             Git branch name.
  --commit sha              Commit SHA.
  --cloudflare-id id        Cloudflare deployment ID.
  --preview url             Preview URL.
  --production url          Production URL.
`);
}


if (require.main === module) {
  main();
}
module.exports = main;
