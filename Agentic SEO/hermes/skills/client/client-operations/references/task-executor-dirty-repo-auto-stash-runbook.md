# Task executor dirty-worktree recovery runbook (10-minute cron)

Use this when `/opt/client-site` has local changes and task-executor picks are repeatedly blocked.

## Current project behavior (committed)
- `CLIENT_TASK_EXECUTOR_ALLOW_DIRTY` defaults to `1` in `tools/cron/run-task-executor.sh`.
- `CLIENT_TASK_EXECUTOR_STASH_DIRTY` defaults to `1`.
- Dirty-worktree flow:
  1. Log `Website repo is dirty; proceeding with guarded fallback flow.`
  2. If `STASH_DIRTY=1`, create `git stash push -u` with a timestamped name.
  3. Switch to clean production branch + `git pull --ff-only` only when stash succeeded.
  4. Run backfill + `node tools/run_task_executor.js` with dynamic args.
  5. Exit with normal executor summary (`Task executor processed ...`).
  6. `trap` restores stashed content on exit with `stash pop --index`.

## Default operator checks
1. Confirm this is the correct gating point:
   - `grep -n "CLIENT_TASK_EXECUTOR_ALLOW_DIRTY\|Website repo is dirty" /opt/client-agent/tools/cron/run-task-executor.sh`
   - `grep -n "Website repo is dirty; refusing" /opt/client-agent/logs/task-executor.log`
2. If dirty repeats for expected assets but tasks should keep running, check these env/flags:
   - `CLIENT_TASK_EXECUTOR_ALLOW_DIRTY` (should be `1`)
   - `CLIENT_TASK_EXECUTOR_STASH_DIRTY` (should be `1` unless stash behavior is intentionally disabled)
3. Run a controlled single-cycle proof:
   - `cd /opt/client-agent && ./tools/cron/run-task-executor.sh`
   - expect non-error exit and non-freeze output, plus a fresh `task-executor-*.json` artifact.
4. If still blocked, inspect for DB lock/parallel-run issues in `logs/task-executor.log` and `logs/outbox.log`.
5. After proof, classify:
   - `processed > 0` => lane issue resolved
   - `processed == 0` with clean repo and non-dirty gating => candidate availability/autopilot/flags issue

## Safety notes
- Keep this path limited to scheduler control; keep content mutations in normal lane workflows.
- Never force-delete uncommitted work as a normal fix if it may include intentional preview assets; use this runbook to preserve restore state and review afterward.