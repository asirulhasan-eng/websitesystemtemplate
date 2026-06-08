#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, listArg, boolArg, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { compactDateTime, nowIso } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const git = require("../lib/git");

const TOOL = "backup-push";

const HELP = `
backup-push - Commit and optionally push backup/state repositories

USAGE
  v2 backup push --repos <repo1,repo2> [options]

OPTIONS
  --repos <list>       Comma-separated repo paths.
  --message <text>     Commit message. Default: SEO agent backup <timestamp>.
  --apply              Actually commit changes. Without this, dry-run only.
  --push               Push after committing. Requires --apply.
  --remote <name>      Git remote. Default: origin.
  --db <path>          Optional SQLite DB for backup events.
  --out <path>         Optional JSON report path.
  --json               JSON output.
  --table              Table output.
  --sample             Return sample data without touching git.
  --help               Show help.
`.trim();

module.exports = function backupPush() {
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
      mode: "dry-run",
      repos: [{ repo: "/opt/client-sqlite", dirty: true, committed: false, pushed: false }],
    }, getOutputFormat(args));
    return;
  }

  try {
    const repos = listArg(args, "repos", []);
    if (!repos.length) throw new Error("Missing --repos repo1,repo2");

    const apply = boolArg(args, "apply");
    const push = boolArg(args, "push");
    const remote = args.remote || "origin";
    const message = args.message || `SEO agent backup ${new Date().toISOString()}`;
    const results = [];

    for (const repo of repos) {
      results.push(handleRepo({
        repoPath: path.resolve(process.cwd(), repo),
        apply,
        push,
        remote,
        message,
      }));
    }

    const output = {
      ok: results.every((result) => result.ok),
      generated_at: nowIso(),
      tool: TOOL,
      mode: apply ? "apply" : "dry-run",
      pushed: apply && push,
      repos: results,
    };

    if (args.db) recordBackupPushEvents(args.db, output);
    const outPath = args.out || path.join(process.cwd(), "tools", "out", "github", `backup-push-${compactDateTime()}.json`);
    writeJson(outPath, output);
    output.report_path = outPath;

    printOutput(output, getOutputFormat(args));
    if (!output.ok) process.exitCode = 1;
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function handleRepo({ repoPath, apply, push, remote, message }) {
  const result = {
    ok: true,
    repo: repoPath,
    is_git_repo: false,
    dirty: false,
    committed: false,
    pushed: false,
    status: "",
  };
  try {
    result.is_git_repo = git.isGitRepo(repoPath);
    if (!result.is_git_repo) {
      return { ...result, ok: false, error: "Not a git repository." };
    }

    result.branch = git.currentBranch(repoPath);
    result.status = git.statusPorcelain(repoPath);
    result.dirty = result.status.trim().length > 0;
    if (!result.dirty) return result;

    if (apply) {
      git.add(repoPath, ["."]);
      git.commit(repoPath, message);
      result.committed = true;
      result.commit_sha = git.shortHead(repoPath);
      if (push) {
        git.push(repoPath, remote, result.branch, false);
        result.pushed = true;
      }
    }
    return result;
  } catch (error) {
    return { ...result, ok: false, error: error.message };
  }
}

function recordBackupPushEvents(dbPath, output) {
  const db = openStateDb(dbPath);
  const now = nowIso();
  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    for (const repo of output.repos) {
      const eventType = repo.ok ? "backup_repo_checked" : "backup_repo_push_failed";
      db.prepare(`
        INSERT INTO events (
          event_id, event_type, task_id, resource_type, resource_id,
          old_value, new_value, source, agent_name, created_at, metadata_json
        ) VALUES (?, ?, NULL, 'backup', ?, NULL, ?, 'backup-push', 'Backup Repo Publisher', ?, ?)
      `).run(
        makeId("EVT"),
        repo.committed || repo.pushed ? "backup_repo_pushed" : eventType,
        repo.repo,
        repo.pushed ? "pushed" : repo.committed ? "committed" : repo.dirty ? "dirty" : "clean",
        now,
        JSON.stringify(repo),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  module.exports();
}
