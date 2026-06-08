#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const { git, push: gitPush } = require("../lib/git");
const { assertTaskStatus } = require("../lib/statuses");

// ---------------------------------------------------------------------------
// Rollback Deployment
// Reverts a deployment by reverting the associated git commit and updating
// SQLite state (deployments, events, outbox, tasks, locks).
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const deploymentId = args["deployment-id"] || null;
  const dbPath = args.db || null;
  const siteRoot = args["site-root"] || process.cwd();
  const taskId = args.task || null;
  const now = nowIso();

  let commitSha = args["commit-sha"] || null;
  let deployment = null;

  // ── 1. Load deployment from SQLite ─────────────────────────────────────
  let db = null;
  if (dbPath) {
    db = openStateDb(dbPath);
  }

  if (db && deploymentId) {
    deployment = db
      .prepare("SELECT * FROM deployments WHERE deployment_id = ?")
      .get(deploymentId);
    if (!deployment) {
      if (db) db.close();
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
  }

  // ── 2. Resolve commit SHA ──────────────────────────────────────────────
  if (!commitSha && deployment) {
    commitSha = deployment.commit_sha;
  }
  if (!commitSha) {
    if (db) db.close();
    throw new Error(
      "No commit SHA available. Provide --commit-sha or ensure the deployment record has a commit_sha.",
    );
  }

  const resolvedTaskId = taskId || (deployment && deployment.task_id) || null;

  // ── 3. Git revert ─────────────────────────────────────────────────────
  let revertResult = null;
  let pushResult = null;

  if (args.apply) {
    try {
      revertResult = git(siteRoot, ["revert", "--no-edit", commitSha]);
    } catch (revertError) {
      const report = {
        ok: false,
        generated_at: now,
        tool: "rollback_deployment",
        deployment_id: deploymentId,
        commit_sha: commitSha,
        error: `Git revert failed: ${revertError.message}`,
      };
      if (db) db.close();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  // ── 4. Git push ────────────────────────────────────────────────────────
  if (args.apply && args.push) {
    try {
      pushResult = gitPush(siteRoot);
    } catch (pushError) {
      pushResult = `Push failed: ${pushError.message}`;
    }
  }

  // ── 5. SQLite recording ────────────────────────────────────────────────
  let dbRecorded = false;
  let dbError = null;

  if (db) {
    const ts = nowIso();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      // Update deployment status
      if (deploymentId) {
        db.prepare(
          "UPDATE deployments SET status = 'rolled_back', finished_at = ? WHERE deployment_id = ?",
        ).run(ts, deploymentId);
      }

      // Insert rollback event
      const payload = {
        deployment_id: deploymentId,
        task_id: resolvedTaskId,
        commit_sha: commitSha,
        applied: Boolean(args.apply),
        pushed: Boolean(args.push),
      };

      db.prepare(
        `
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'deployment_rollback', 'Deployment Rollback', ?, ?)
        `,
      ).run(
        makeId("EVT"),
        "deployment_rolled_back",
        resolvedTaskId,
        "deployment",
        deploymentId,
        deployment ? deployment.status : null,
        "rolled_back",
        ts,
        JSON.stringify(payload),
      );

      // Outbox for deployment note
      db.prepare(
        `
          INSERT INTO outbox_jobs (
            outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `,
      ).run(
        makeId("OUT"),
        "update_obsidian_deployment_note",
        "deployment",
        deploymentId,
        JSON.stringify(payload),
        ts,
      );

      // Update task status if available
      if (resolvedTaskId) {
        assertTaskStatus("rollback");
        db.prepare(
          "UPDATE tasks SET status = 'rollback', updated_at = ? WHERE task_id = ?",
        ).run(ts, resolvedTaskId);

        db.prepare(
          `
            INSERT INTO outbox_jobs (
              outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
          `,
        ).run(
          makeId("OUT"),
          "update_obsidian_task_note",
          "task",
          resolvedTaskId,
          JSON.stringify({
            task_id: resolvedTaskId,
            status: "rollback",
            deployment_id: deploymentId,
            source_of_truth: "SQLite",
          }),
          ts,
        );
      }

      db.exec("COMMIT");
      dbRecorded = true;
    } catch (error) {
      db.exec("ROLLBACK");
      dbError = error.message;
    }

    // ── 6. Release locks held by the task ────────────────────────────────
    if (resolvedTaskId) {
      try {
        const activeLocks = db
          .prepare(
            "SELECT lock_id FROM locks WHERE task_id = ? AND status = 'active'",
          )
          .all(resolvedTaskId);

        if (activeLocks.length > 0) {
          const relTs = nowIso();
          for (const lock of activeLocks) {
            db.prepare(
              "UPDATE locks SET status = 'released', released_at = ? WHERE lock_id = ?",
            ).run(relTs, lock.lock_id);
          }
        }
      } catch {
        // Lock release is best-effort
      }
    }

    db.close();
  }

  // ── 7. Output ──────────────────────────────────────────────────────────
  const report = {
    ok: true,
    generated_at: now,
    tool: "rollback_deployment",
    deployment_id: deploymentId,
    task_id: resolvedTaskId,
    commit_sha: commitSha,
    applied: Boolean(args.apply),
    pushed: Boolean(args.push),
    revert_output: revertResult || null,
    push_output: pushResult || null,
    db_recorded: dbRecorded,
    db_error: dbError,
  };

  const outPath =
    args.out ||
    path.join(
      process.cwd(),
      "tools",
      "out",
      "rollback",
      `rollback-${deploymentId || "manual"}-${Date.now()}.json`,
    );
  writeJson(outPath, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Rollback ${args.apply ? "applied" : "dry-run"}: ${commitSha}${args.push ? " (pushed)" : ""}`,
    );
    console.log(`Report: ${outPath}`);
  }
}

function printHelp() {
  console.log(`
Usage:
  node tools/rollback_deployment.js --deployment-id DEP-... --db tools/out/state/seo-agent.db --apply
  node tools/rollback_deployment.js --commit-sha abc1234 --site-root /path/to/site --apply --push

Options:
  --deployment-id id     Deployment record to rollback.
  --db path              SQLite DB path.
  --site-root path       Site root (git working directory).
  --commit-sha sha       Commit SHA to revert (overrides deployment record).
  --task id              Related task ID.
  --apply                Actually run git revert (dry-run without this flag).
  --push                 Push to origin after revert.
  --out path             JSON output path.
  --json                 Print full JSON to stdout.
  --help                 Show this help.

When --db is provided the tool will:
  - Update deployments.status to 'rolled_back'
  - Insert a deployment_rolled_back event
  - Insert outbox jobs for Obsidian notes
  - Update task status to 'rollback' if a task_id is available
  - Release any active locks held by the task
`);
}


if (require.main === module) {
  try {
    main();
  } catch (error) {
    exitWithError(error);
  }
}

module.exports = main;
