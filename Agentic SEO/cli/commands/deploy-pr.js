#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, requireArg, boolArg, exitWithError } = require("../lib/cli");
const { loadToolEnv } = require("../lib/env");
const { compactDateTime, nowIso } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const git = require("../lib/git");

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadToolEnv({ envPath: args.env });
  const siteRoot = path.resolve(process.cwd(), args["site-root"] || "D:\\Projects\\{{NICHE}} SEO Agency");
  const remote = args.remote || "origin";
  const repo = args.repo ? parseRepo(args.repo) : git.githubRepo(siteRoot, remote);
  const branch = args.head || git.currentBranch(siteRoot);
  const base = args.base || config.get("GITHUB_PR_BASE") || config.get("CLOUDFLARE_PRODUCTION_BRANCH", "main");
  const task = args.task && args.db ? loadTask(args.db, args.task) : null;
  const title = args.title || (task ? `${task.task_id}: ${task.title}` : `SEO agent preview: ${branch}`);
  const body = args.body || makeBody(task, siteRoot, branch);
  const payload = {
    title,
    head: args["head-owner"] ? `${args["head-owner"]}:${branch}` : branch,
    base,
    body,
    draft: args["no-draft"] !== undefined ? false : boolArg(args, "draft", true),
    maintainer_can_modify: true,
  };

  const output = {
    generated_at: nowIso(),
    tool: "create_github_pr",
    dry_run: !args.apply,
    repo,
    site_root: siteRoot,
    remote,
    branch,
    payload,
  };

  if (args.push && args.apply) {
    output.push_output = git.push(siteRoot, remote, branch);
  }

  if (args.apply) {
    const token = config.require("GITHUB_TOKEN");
    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`;
    let response;
    let lastError;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "content-type": "application/json",
            "user-agent": "client-agent",
          },
          body: JSON.stringify(payload),
        });
        if (response.ok || response.status === 422) break; // 422 = PR already exists, not retriable
        if (attempt < maxRetries) {
          const delayMs = attempt * 2000;
          console.error(`[GitHub API] Attempt ${attempt}/${maxRetries} got ${response.status}. Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) throw error;
        const delayMs = attempt * 2000;
        console.error(`[GitHub API] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    const json = await response.json();
    output.github_status = response.status;
    output.github_response = json;
    output.ok = response.ok;
    if (!response.ok) output.error = json.message || response.statusText;

    if (args.db && args.task && response.ok) recordPrEvent(args.db, args.task, output);
  } else {
    output.ok = true;
    output.message = "Dry run only. Pass --apply to create the PR.";
  }

  const outPath = args.out || path.join(process.cwd(), "tools", "out", "github", `github-pr-${compactDateTime()}.json`);
  writeJson(outPath, output);

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`GitHub PR ${output.ok ? (args.apply ? "created" : "planned") : "failed"}: ${outPath}`);
    if (output.github_response?.html_url) console.log(output.github_response.html_url);
    if (output.error) console.log(`Error: ${output.error}`);
  }
  if (!output.ok && args["fail-on-error"]) process.exitCode = 1;
}

function loadTask(dbPath, taskId) {
  const db = openStateDb(dbPath);
  try {
    return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  } finally {
    db.close();
  }
}

function makeBody(task, siteRoot, branch) {
  const status = safe(() => git.statusPorcelain(siteRoot), "");
  if (!task) {
    return [`Automated preview branch: \`${branch}\``, "", "## Changed Files", "```", status || "No local status available.", "```"].join("\n");
  }
  return [
    `Task: \`${task.task_id}\``,
    "",
    task.description || task.title,
    "",
    "## Risk",
    task.risk_level || "",
    "",
    "## Target",
    `- URL: ${task.target_url || ""}`,
    `- File: ${task.target_file || ""}`,
    `- Keyword: ${task.target_keyword || ""}`,
    "",
    "## Local Git Status",
    "```",
    status || "Clean at PR creation time.",
    "```",
    "",
    "SQLite remains the source of truth.",
  ].join("\n");
}

function recordPrEvent(dbPath, taskId, output) {
  const db = openStateDb(dbPath);
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(
      "INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?, 'github_pr_created', ?, 'github_pr', ?, NULL, ?, 'github_pr_creator', 'GitHub PR Creator', ?, ?)",
    ).run(
      makeId("EVT"),
      taskId,
      String(output.github_response.number),
      output.github_response.html_url,
      now,
      JSON.stringify(output.github_response),
    );
    db.prepare(
      "INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at) VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)",
    ).run(makeId("OUT"), taskId, JSON.stringify({ github_pr: output.github_response.html_url }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function parseRepo(value) {
  const [owner, repo] = String(value).split("/");
  if (!owner || !repo) throw new Error("--repo must look like owner/repo");
  return { owner, repo };
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function printHelp() {
  console.log(`
Usage:
  v2 deploy pr --site-root "D:\\Projects\\{{NICHE}} SEO Agency" --head agent/task --base main
  v2 deploy pr --task CAND-... --db tools/out/state/seo-agent.db --apply --push

Options:
  --site-root path   GitHub repo path.
  --repo owner/name  Override owner/repo.
  --remote origin    Git remote to inspect/push.
  --head branch      PR head branch. Defaults current branch.
  --base branch      PR base branch.
  --task id          Optional task ID for title/body/event.
  --db path          SQLite DB path for task lookup/event.
  --title text       PR title override.
  --body text        PR body override.
  --draft            Create draft PR. Default true.
  --no-draft         Create ready-for-review PR.
  --push             Push branch before creating PR when --apply is used.
  --apply            Actually create the PR. Without this, dry-run only.
`);
}

if (require.main === module) {
  main().catch(exitWithError);
}

module.exports = main;
