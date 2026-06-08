#!/usr/bin/env node
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const {
  compactDeployment,
  listDeployments,
  listProjects,
  loadCloudflareConfig,
} = require("../lib/cloudflare");

const TOOL = "deploy-status";

const HELP = `
deploy-status - Check deployment status from SQLite or live Cloudflare Pages

USAGE
  v2 deploy status --db <path> [options]
  v2 deploy status --live --project <name> [options]

DB OPTIONS
  --db <path>           SQLite database path.
  --deployment-id <id>  Query a specific deployment row.
  --latest              Show the latest DB deployment.
  --branch <name>       Filter DB rows by branch.
  --status <status>     Filter DB rows by deployment status.

CLOUDFLARE OPTIONS
  --live                Query Cloudflare Pages API.
  --project <name>      Cloudflare Pages project. Defaults to CLOUDFLARE_PROJECT_NAME.
  --account-id <id>     Cloudflare account ID. Defaults to CLOUDFLARE_ACCOUNT_ID.
  --list-projects       List Cloudflare Pages projects.
  --environment <name>  Filter live deployments by environment.
  --cloudflare-id <id>  Filter live deployments by Cloudflare deployment ID.

COMMON
  --limit <N>           Max rows. Default: 20 for DB, 10 for live.
  --json                JSON output.
  --table               Table output.
  --csv                 CSV output.
  --sample              Return sample data without DB/API interaction.
  --help                Show help.
`.trim();

module.exports = async function deployStatus() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      source: boolArg(args, "live") ? "cloudflare" : "db",
      rows: [{
        deployment_id: "DEP-2026-06-03-SAMPLE1",
        task_id: "TSK-2026-06-03-AB12CD34",
        branch_name: "agent/seo-update",
        cloudflare_deployment_id: "cf-dep-12345",
        preview_url: "https://sample.client.pages.dev",
        status: "live",
        validation_status: "passed",
      }],
      count: 1,
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    if (shouldUseCloudflare(args)) {
      await printCloudflareStatus(args);
    } else {
      printDbStatus(args);
    }
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function shouldUseCloudflare(args) {
  return boolArg(args, "live")
    || boolArg(args, "list-projects")
    || Boolean(args.project || args["account-id"] || args["cloudflare-id"] || args.environment);
}

async function printCloudflareStatus(args) {
  const limit = numberArg(args, "limit", 10);
  const { accountId, projectName, token } = loadCloudflareConfig(args);

  if (boolArg(args, "list-projects")) {
    const projects = await listProjects({ accountId, token, limit });
    printOutput(envelope({
      source: "cloudflare",
      mode: "list_projects",
      count: projects.length,
      projects,
      rows: projects,
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  let rows = (await listDeployments({ accountId, projectName, token, limit }))
    .map(compactDeployment);

  if (args.branch) rows = rows.filter((row) => row.branch === args.branch);
  if (args.environment) rows = rows.filter((row) => row.environment === args.environment);
  if (args["cloudflare-id"]) rows = rows.filter((row) => row.id === args["cloudflare-id"]);

  const output = {
    source: "cloudflare",
    project_name: projectName,
    count: rows.length,
    latest: rows[0] || null,
    rows,
  };

  if (boolArg(args, "latest") && rows[0]) {
    printOutput(envelope({ source: "cloudflare", project_name: projectName, ...rows[0] }, { tool: TOOL }), getOutputFormat(args));
    return;
  }
  printOutput(envelope(output, { tool: TOOL }), getOutputFormat(args));
}

function printDbStatus(args) {
  const dbPath = resolveDbPath(args);
  const db = openStateDb(dbPath);
  const limit = numberArg(args, "limit", 20);
  try {
    if (args["deployment-id"]) {
      const row = db.prepare("SELECT * FROM deployments WHERE deployment_id = ?").get(args["deployment-id"]);
      if (!row) throw new Error(`Deployment not found: ${args["deployment-id"]}`);
      printOutput(envelope({ source: "db", ...row }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    const conditions = [];
    const params = [];
    if (args.branch) {
      conditions.push("branch_name = ?");
      params.push(args.branch);
    }
    if (args.status) {
      conditions.push("status = ?");
      params.push(args.status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = boolArg(args, "latest") ? "LIMIT 1" : `LIMIT ${limit}`;
    const rows = db.prepare(`
      SELECT deployment_id, task_id, branch_name, commit_sha, deployment_type,
             cloudflare_deployment_id, preview_url, production_url, status,
             started_at, finished_at, validation_status
      FROM deployments
      ${whereClause}
      ORDER BY started_at DESC
      ${limitClause}
    `).all(...params);

    if (boolArg(args, "latest") && rows.length === 1) {
      printOutput(envelope({ source: "db", ...rows[0] }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    printOutput(envelope({ source: "db", rows, count: rows.length }, { tool: TOOL }), getOutputFormat(args));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  module.exports();
}
