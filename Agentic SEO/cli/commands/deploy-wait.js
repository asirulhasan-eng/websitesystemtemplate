#!/usr/bin/env node
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { openStateDb, makeId } = require("../lib/state_db");
const {
  compactDeployment,
  findDeploymentMatch,
  isTerminalStageStatus,
  listDeployments,
  loadCloudflareConfig,
  stageStatus,
} = require("../lib/cloudflare");
const { nowIso } = require("../lib/dates");

const TOOL = "deploy-wait";
const DB_TERMINAL_STATES = new Set(["live", "failed", "cancelled", "error", "completed", "preview_ready", "deployed"]);

const HELP = `
deploy-wait - Wait for deployment completion from SQLite or live Cloudflare Pages

USAGE
  v2 deploy wait --db <path> (--deployment-id <id> | --branch <name>)
  v2 deploy wait --live --branch <name> --project <name>

DB OPTIONS
  --db <path>                  SQLite database path.
  --deployment-id <id>         Deployment row to watch.
  --branch <name>              Latest DB deployment for branch.

CLOUDFLARE OPTIONS
  --live                       Query Cloudflare Pages API.
  --project <name>             Cloudflare Pages project.
  --account-id <id>            Cloudflare account ID.
  --cloudflare-id <id>         Match exact Cloudflare deployment ID.
  --environment <name>         Match environment.
  --state-deployment-id <id>   Update this SQLite deployment row from live Cloudflare.
  --once                       Check once and return.

COMMON
  --timeout-seconds <N>        Max wait time. Default: 180.
  --poll-interval <N>          Seconds between polls. Default: 10.
  --interval-seconds <N>       Alias for --poll-interval.
  --json                      JSON output.
  --sample                    Return sample data without DB/API interaction.
  --help                      Show help.
`.trim();

module.exports = async function deployWait() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput({
      ok: true,
      generated_at: nowIso(),
      tool: TOOL,
      source: boolArg(args, "live") ? "cloudflare" : "db",
      deployment_id: "DEP-2026-06-03-SAMPLE1",
      branch_name: "agent/seo-update",
      status: "success",
      matched: {
        id: "cf-dep-sample",
        branch: "agent/seo-update",
        url: "https://sample.client.pages.dev",
        latest_stage_status: "success",
      },
      waited_seconds: 15,
      polls: 2,
    }, getOutputFormat(args));
    return;
  }

  try {
    const output = shouldUseCloudflare(args)
      ? await waitForCloudflare(args)
      : await waitForDb(args);
    printOutput(output, getOutputFormat(args));
    if (!output.ok) process.exitCode = 1;
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function shouldUseCloudflare(args) {
  return boolArg(args, "live")
    || Boolean(args["state-deployment-id"] || args.project || args["account-id"] || args["cloudflare-id"] || args.environment);
}

async function waitForCloudflare(args) {
  const { accountId, projectName, token } = loadCloudflareConfig(args);
  const timeoutSec = numberArg(args, "timeout-seconds", 180);
  const pollSec = numberArg(args, "poll-interval", numberArg(args, "interval-seconds", 10));
  const limit = numberArg(args, "limit", 10);
  const startMs = Date.now();
  const attempts = [];
  let matched = null;

  do {
    const deployments = await listDeployments({ accountId, projectName, token, limit });
    matched = findDeploymentMatch(deployments, args);
    attempts.push({
      checked_at: nowIso(),
      found: Boolean(matched),
      matched: matched ? compactDeployment(matched) : null,
      latest: deployments[0] ? compactDeployment(deployments[0]) : null,
    });

    if (matched && isTerminalStageStatus(stageStatus(matched))) break;
    if (boolArg(args, "once")) break;
    await sleep(pollSec * 1000);
  } while ((Date.now() - startMs) / 1000 < timeoutSec);

  const status = matched ? stageStatus(matched) : "not_found";
  const ok = status === "success";
  const output = {
    ok,
    generated_at: nowIso(),
    tool: TOOL,
    source: "cloudflare",
    project_name: projectName,
    status,
    matched: matched ? compactDeployment(matched) : null,
    attempts,
    waited_seconds: Math.round((Date.now() - startMs) / 1000),
    polls: attempts.length,
  };

  if (args.db && args["state-deployment-id"] && matched) {
    recordCloudflareDeployment(args, output);
    output.db_recorded = true;
  }
  return output;
}

async function waitForDb(args) {
  const deploymentId = args["deployment-id"];
  const branch = args.branch;
  if (!deploymentId && !branch) throw new Error("Provide either --deployment-id or --branch, or use --live for Cloudflare.");

  const dbPath = resolveDbPath(args);
  const db = openStateDb(dbPath);
  const timeoutSec = numberArg(args, "timeout-seconds", 180);
  const pollSec = numberArg(args, "poll-interval", numberArg(args, "interval-seconds", 10));
  const startMs = Date.now();
  const deadline = startMs + timeoutSec * 1000;
  let polls = 0;
  try {
    while (Date.now() < deadline) {
      polls += 1;
      const row = deploymentId
        ? db.prepare("SELECT * FROM deployments WHERE deployment_id = ?").get(deploymentId)
        : db.prepare("SELECT * FROM deployments WHERE branch_name = ? ORDER BY started_at DESC LIMIT 1").get(branch);

      if (row && DB_TERMINAL_STATES.has(row.status)) {
        const success = ["live", "completed", "preview_ready", "deployed"].includes(row.status);
        return {
          ok: success,
          generated_at: nowIso(),
          tool: TOOL,
          source: "db",
          ...row,
          waited_seconds: Math.round((Date.now() - startMs) / 1000),
          polls,
          message: success ? `Deployment reached ${row.status}.` : `Deployment ended with ${row.status}.`,
        };
      }

      if (boolArg(args, "once")) break;
      if (Date.now() + pollSec * 1000 < deadline) await sleep(pollSec * 1000);
    }

    return {
      ok: false,
      generated_at: nowIso(),
      tool: TOOL,
      source: "db",
      status: "timeout",
      waited_seconds: Math.round((Date.now() - startMs) / 1000),
      polls,
      message: "Deployment did not reach a terminal state before timeout.",
    };
  } finally {
    db.close();
  }
}

function recordCloudflareDeployment(args, output) {
  const db = openStateDb(args.db);
  const now = nowIso();
  const deploymentId = args["state-deployment-id"];
  const matched = output.matched;
  const status = output.ok ? (matched.environment === "production" ? "deployed" : "preview_ready") : "failed";
  const url = matched.url || matched.alias_url || null;
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const current = db.prepare("SELECT * FROM deployments WHERE deployment_id = ?").get(deploymentId);
    if (current) {
      db.prepare(`
        UPDATE deployments
        SET status = ?, cloudflare_deployment_id = ?,
            preview_url = COALESCE(?, preview_url),
            production_url = COALESCE(?, production_url),
            finished_at = ?, validation_status = ?, metadata_json = ?
        WHERE deployment_id = ?
      `).run(
        status,
        matched.id,
        matched.environment === "production" ? null : url,
        matched.environment === "production" ? url : null,
        now,
        output.ok ? "cloudflare_success" : "cloudflare_failed",
        JSON.stringify(output),
        deploymentId,
      );
      if (current.task_id && output.ok) {
        db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(status, now, current.task_id);
      }
    }

    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, ?, ?, 'deployment', ?, NULL, ?, 'cloudflare_waiter', 'Cloudflare Deployment Waiter', ?, ?)
    `).run(
      makeId("EVT"),
      output.ok ? "cloudflare_deployment_ready" : "cloudflare_deployment_failed",
      current ? current.task_id : null,
      deploymentId,
      status,
      now,
      JSON.stringify(output),
    );

    db.prepare(`
      INSERT INTO outbox_jobs (
        outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
      ) VALUES (?, 'update_obsidian_deployment_note', 'deployment', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), deploymentId, JSON.stringify(output), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  module.exports();
}
