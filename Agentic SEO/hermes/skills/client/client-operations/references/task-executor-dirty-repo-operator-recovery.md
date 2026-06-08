# Dirty-Repo Operator Recovery (Task Executor)

Use this when `./tools/cron/run-task-executor.sh` hits a dirty `/opt/client-site` tree.

## Standard recovery pattern
1. Preserve current worktree state before forcing scheduler behavior:
   - `git -C /opt/client-site status --short --untracked-files=all`
   - `git -C /opt/client-site stash push -u -m "temp-clean-for-task-executor-<YYYYMMDD>"`
2. Verify stash creation (expect `Saved working directory and index state ...`).
3. Run the exact scheduler wrapper:
   - `cd /opt/client-agent && ./tools/cron/run-task-executor.sh`
4. Confirm wrapper logs:
   - `Website repo is dirty; proceeding with guarded fallback flow.`
   - `Task executor restored stashed local changes from ...`
5. Confirm worktree restored:
   - `git -C /opt/client-site status --short`
6. If restored changes are not for immediate follow-up, either:
   - reconcile them now, or
   - keep a stash note and restore later (`git stash list`, `git stash pop`).

## Why
Default behavior is guard-rail non-blocking (`CLIENT_TASK_EXECUTOR_ALLOW_DIRTY=1`, `CLIENT_TASK_EXECUTOR_STASH_DIRTY=1`) to avoid scheduler freezes.

## Note
Do not discard/clean stash entries that contain generated drafts or audit-relevant files until reviewed, unless the user explicitly authorizes cleanup.
