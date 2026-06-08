# Task Executor 10-minute cadence but repo-gate blocked

## Symptom
- User observed: "tasks not being picked up / competing" with expected `*/10` trigger.
- Recent logs showed many task-executor invocations with no work, plus explicit dirty-repo aborts.

## Key evidence pattern
- `crontab`/scheduler evidence showed periodic ticks at 10-minute cadence for `run-task-executor.sh`.
- `logs/task-executor.log` alternated between:
  - `Task executor processed 0 tasks (safe: 0, semi_safe: 0, high_risk: 0)`
  - `Website repo is dirty; refusing to start task executor.`
- No `Task executor already running; skipping this tick` lock contention messages in task-executor logs.
- `cron_runs` rows were still being written for other jobs (and task wrapper itself) as `completed`, which means scheduler path was alive.

## Root cause observed
- The gating line in `tools/cron/run-task-executor.sh`:
  - `git -C "$SITE_ROOT" status --porcelain`
  - if non-empty -> exit with the dirty message
- `tools/cron/run-blog-publisher.sh` has the same guard and will also refuse to start on any site repo dirtiness.
- The blocking files were generated/untracked content in the site repo, e.g. generated blog assets and scaffold outputs.
- A common blog-publisher variant: the Hermes writer reaches its `--max-turns` / tool-iteration ceiling after creating article/assets but before index/sitemap/link-registry, validation, commit, PR, and `record_blog_preview_ready.js`. Subsequent 10-minute ticks then fail the dirty-repo preflight forever until the partial preview is either completed or discarded.

## Practical triage
1. Read the latest invocation logs around the period in question.
2. Confirm scheduler health from crontab/log timestamps and, if populated, `cron_runs`.
3. Immediately check `/opt/client-site` clean status (`git status --short`) from the scheduler host.
4. If dirty:
   - If the dirty files are an intentional semi-safe preview in progress, finish the preview workflow: complete blog index/sitemap/link-registry integration, run validation, commit/push the preview branch, create/verify the PR or preview URL, run `record_blog_preview_ready.js`, then return the shared worktree to clean production `master`.
   - If the dirty files are abandoned/incorrect generated outputs, discard them explicitly after preserving any needed evidence, then rerun one wrapper cycle.
   - If the dirtiness is only runtime logs/generated scratch output that should never be versioned, add the correct ignore rule in the owning repo.
5. Re-classify status:
   - if processing remains `0/0/0` after clean repo, inspect task availability / dry-run mode,
   - if non-zero appears, continue normal one-by-one autopilot verification.

## How to report to user
- Never report "not running" when scheduler rows and periodic wrapper traces show active ticks.
- State explicitly: "trigger is firing; executor is blocked by dirty repo gate."