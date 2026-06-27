#!/usr/bin/env node
const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { loadToolEnv } = require("../lib/env");
const {
  compactDeployment,
  listDeployments,
  listProjects,
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
  --domain <domain>     Custom domain used to resolve the Pages project if --project/env is stale.
  --strict-domain       Fail instead of falling back to a single verified status-path candidate when domain mapping is absent.
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
  const access = loadCloudflareAccess(args);

  if (boolArg(args, "list-projects")) {
    const projects = await listProjects({ accountId: access.accountId, token: access.token, limit });
    printOutput(envelope({
      source: "cloudflare",
      mode: "list_projects",
      count: projects.length,
      projects,
      rows: projects,
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  const initialProject = access.projectName;
  let resolution = initialProject
    ? configuredProjectResolution(initialProject, access.domain)
    : null;
  if (!resolution) resolution = await resolveProjectByDomain({ ...access, limit });

  let rows;
  try {
    rows = (await listDeployments({
      accountId: access.accountId,
      projectName: resolution.projectName,
      token: access.token,
      limit,
    })).map(compactDeployment);
  } catch (error) {
    if (!isProjectNotFoundError(error) || !access.domain) throw error;
    const fallback = await resolveProjectByDomain({
      ...access,
      requestedProjectName: resolution.projectName,
      limit,
      cause: error,
      allowSingleCandidate: !boolArg(args, "strict-domain"),
    });
    rows = (await listDeployments({
      accountId: access.accountId,
      projectName: fallback.projectName,
      token: access.token,
      limit,
    })).map(compactDeployment);
    resolution = fallback;
  }

  if (args.branch) rows = rows.filter((row) => row.branch === args.branch);
  if (args.environment) rows = rows.filter((row) => row.environment === args.environment);
  if (args["cloudflare-id"]) rows = rows.filter((row) => row.id === args["cloudflare-id"]);

  const output = {
    source: "cloudflare",
    project_name: resolution.projectName,
    project_resolution: resolution.output,
    count: rows.length,
    latest: rows[0] || null,
    rows,
  };

  if (boolArg(args, "latest") && rows[0]) {
    printOutput(envelope({
      source: "cloudflare",
      project_name: resolution.projectName,
      project_resolution: resolution.output,
      ...rows[0],
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }
  printOutput(envelope(output, { tool: TOOL }), getOutputFormat(args));
}

function loadCloudflareAccess(args) {
  const config = loadToolEnv({ envPath: args.env, cwd: args.cwd });
  const domain = normalizeDomain(
    args.domain
      || args["site-domain"]
      || domainFromUrl(args.url || args["production-url"])
      || domainFromUrl(config.get("GSC_SITE_URL"))
      || "example.com",
  );
  return {
    accountId: args["account-id"] || config.require("CLOUDFLARE_ACCOUNT_ID"),
    projectName: args.project || config.get("CLOUDFLARE_PROJECT_NAME"),
    token: args.token || config.require("CLOUDFLARE_API_TOKEN"),
    domain,
  };
}

function configuredProjectResolution(projectName, domain) {
  return {
    projectName,
    output: {
      requested_project_name: projectName,
      resolved_project_name: projectName,
      resolved_by: "configured",
      domain: domain || null,
    },
  };
}

async function resolveProjectByDomain({
  accountId,
  token,
  domain,
  requestedProjectName = null,
  limit = 25,
  cause = null,
  allowSingleCandidate = true,
}) {
  if (!domain) {
    throw new Error("Cloudflare Pages project could not be resolved: provide --project or --domain.");
  }
  const projects = await listProjects({ accountId, token, limit: Math.min(Math.max(limit, 10), 20) });
  const match = projects.find((project) => projectMatchesDomain(project, domain));
  if (match) {
    return {
      projectName: match.name,
      output: {
        requested_project_name: requestedProjectName,
        resolved_project_name: match.name,
        resolved_by: "domain",
        domain,
        domain_verified: true,
        status_path_verified: true,
        matched_project: match,
        prior_error: cause ? cause.message : null,
      },
    };
  }

  if (allowSingleCandidate && projects.length === 1) {
    const only = projects[0];
    return {
      projectName: only.name,
      output: {
        requested_project_name: requestedProjectName,
        resolved_project_name: only.name,
        resolved_by: "single_candidate_status_path",
        domain,
        domain_verified: false,
        status_path_verified: true,
        matched_project: only,
        prior_error: cause ? cause.message : null,
        human_action: `Cloudflare listed only one accessible Pages project (${only.name}) but did not expose ${domain} in its custom domains. Verify this is the example.com Pages project, then update CLOUDFLARE_PROJECT_NAME or Cloudflare custom-domain/API-token access so future checks can verify the domain mapping directly.`,
      },
    };
  }

  const candidates = projects.map(projectEvidence).join("; ") || "no projects returned";
  const causeText = cause ? ` Prior project lookup failed: ${cause.message}.` : "";
  throw new Error(
    `Cloudflare Pages project could not be resolved for domain ${domain}.${causeText} `
    + `Requested project: ${requestedProjectName || "(none)"}. Candidate projects: ${candidates}. `
    + `Human action: set CLOUDFLARE_PROJECT_NAME to the actual Pages project for ${domain}, `
    + `or grant the Cloudflare API token/account access to list that project and its custom domains/deployments.`,
  );
}

function projectMatchesDomain(project, domain) {
  const wanted = normalizeDomain(domain);
  if (!wanted) return false;
  const candidates = [project.subdomain, ...(project.domains || [])]
    .map(normalizeDomain)
    .filter(Boolean);
  return candidates.includes(wanted);
}

function normalizeDomain(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

function domainFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function projectEvidence(project) {
  const domains = [project.subdomain, ...(project.domains || [])].filter(Boolean).join(", ") || "no domains";
  return `${project.name} [${domains}] production_branch=${project.production_branch || "unknown"}`;
}

function isProjectNotFoundError(error) {
  return /Project not found|8000007|not found/i.test(error?.message || "");
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
