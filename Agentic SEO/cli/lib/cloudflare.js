const { loadToolEnv } = require("./env");

function loadCloudflareConfig(args = {}) {
  const config = loadToolEnv({ envPath: args.env, cwd: args.cwd });
  return {
    accountId: args["account-id"] || config.require("CLOUDFLARE_ACCOUNT_ID"),
    projectName: args.project || config.require("CLOUDFLARE_PROJECT_NAME"),
    token: args.token || config.require("CLOUDFLARE_API_TOKEN"),
  };
}

async function listProjects({ accountId, token, limit = 10 }) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects?per_page=${clampLimit(limit)}`;
  const json = await cloudflareFetch(endpoint, token, "Cloudflare Pages project list");
  return (json.result || []).map((project) => ({
    name: project.name,
    subdomain: project.subdomain || null,
    domains: project.domains || [],
    production_branch: project.production_branch || null,
    created_on: project.created_on || null,
  }));
}

async function listDeployments({ accountId, projectName, token, limit = 10 }) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(
    projectName,
  )}/deployments?per_page=${clampLimit(limit)}`;
  const json = await cloudflareFetch(endpoint, token, "Cloudflare Pages deployment list");
  return json.result || [];
}

async function cloudflareFetch(endpoint, token, label) {
  const response = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  let json;
  try {
    json = await response.json();
  } catch {
    const text = await response.text().catch(() => '(unreadable body)');
    throw new Error(`${label} failed: HTTP ${response.status} — response is not JSON. Body: ${text.slice(0, 500)}`);
  }
  if (!response.ok || json.success === false) {
    const details = json.errors ? JSON.stringify(json.errors) : response.statusText;
    throw new Error(`${label} failed: ${details}`);
  }
  return json;
}

function compactDeployment(deployment) {
  const latestStage = Array.isArray(deployment.stages) ? deployment.stages[deployment.stages.length - 1] : null;
  return {
    id: deployment.id,
    project_name: deployment.project_name || null,
    environment: deployment.environment || null,
    branch: branchOf(deployment),
    commit_hash: deployment.deployment_trigger?.metadata?.commit_hash || null,
    commit_message: deployment.deployment_trigger?.metadata?.commit_message || null,
    url: deployment.url || null,
    aliases: deployment.aliases || [],
    alias_url: Array.isArray(deployment.aliases) ? deployment.aliases[0] || null : null,
    created_on: deployment.created_on || null,
    modified_on: deployment.modified_on || null,
    latest_stage_name: latestStage ? latestStage.name : null,
    latest_stage_status: latestStage ? latestStage.status : "unknown",
  };
}

function findDeploymentMatch(deployments, args = {}) {
  if (args["cloudflare-id"]) return deployments.find((deployment) => deployment.id === args["cloudflare-id"]) || null;
  if (args.branch) return deployments.find((deployment) => branchOf(deployment) === args.branch) || null;
  if (args.environment) return deployments.find((deployment) => deployment.environment === args.environment) || null;
  return deployments[0] || null;
}

function stageStatus(deployment) {
  const stages = Array.isArray(deployment?.stages) ? deployment.stages : [];
  const latest = stages[stages.length - 1];
  return latest ? latest.status : "unknown";
}

function isTerminalStageStatus(status) {
  return ["success", "failure", "canceled", "skipped"].includes(status);
}

function branchOf(deployment) {
  return deployment?.deployment_trigger?.metadata?.branch || null;
}

function clampLimit(value) {
  const n = Number(value || 10);
  return Math.max(1, Math.min(25, Number.isFinite(n) ? n : 10));
}

module.exports = {
  branchOf,
  compactDeployment,
  findDeploymentMatch,
  isTerminalStageStatus,
  listDeployments,
  listProjects,
  loadCloudflareConfig,
  stageStatus,
};
