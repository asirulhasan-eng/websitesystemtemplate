# Blog publisher duplicate-run prevention (semi-safe scheduled autopilot)

## Signal
- Repeated scheduled `run-blog-publisher.sh` executions can start the same semi-safe `new_blog_post` task multiple times if the task is not moved out of `candidate`.
- This commonly happens when a run is interrupted after claiming but before it records a terminal state transition (`preview_ready`, `deployed`, etc.) in SQLite.

## Root cause observed
- `run-task-executor.sh` intentionally skips `new_blog_post` tasks, so publishing is driven by:
  - `tools/cron/run-blog-publisher.sh`.
- That worker selected:
  - `risk_level='semi_safe'`
  - `status='candidate'`
  - `new_blog_post` in metadata.
- If processing is blocked/aborted and status remains `candidate`, the next cron tick re-picks the same task.

## Guard introduced (and now standard)
- Add task-level claim lock in `locks` table (`lock_type='blog_publisher_task'`) before long-running work.
  - Insert with unique `lock_id` for the selected `TASK_ID`.
  - If active lock already exists for same `resource_id` and not expired, skip the run.
  - Release lock on exit/cleanup (including cleanup trap).
- This prevents duplicate concurrent or immediately repeated work for the same task.

### SQL checks used
```sql
SELECT lock_id,status,owner_agent,resource_id,task_id,created_at,expires_at
FROM locks
WHERE reason='claim for scheduled blog publisher run'
ORDER BY created_at DESC;
```

```sql
SELECT lock_id,resource_id,status,owner_agent,created_at,expires_at,released_at
FROM locks
WHERE lock_type='blog_publisher_task'
ORDER BY created_at DESC LIMIT 20;
```

### Recovery verification after fix
1. Run with dry-run env vars to avoid real edits:
   - `CLIENT_BLOG_PUBLISHER_ALLOW_DIRTY=1`
   - `CLIENT_BLOG_PUBLISHER_STASH_DIRTY=1`
   - `CLIENT_BLOG_PUBLISHER_DRY_RUN=1`
2. Confirm only one eligible candidate is selected and no duplicate start logs for same `TASK_ID`.
3. Confirm lock row is created (`active` during run, `released` after exit).
4. Confirm candidate remains unchanged unless state transition is expected; if unchanged, next tick should skip because lock is either present/just released with fresh duplicate guard.

### Queue starvation recovery playbook
When "no new blogs in recent windows" is reported, check for this exact pattern:
- same `TASK_ID` appears repeatedly in `Starting Hermes blog publisher for task ...` lines;
- logs show stash/apply markers (`Could not re-apply stash automatically` / `Could not create auto-stash`), or `blog/index.html: needs merge`;
- `tasks` still shows the same `task_id` as `candidate`.

Recovery steps:
1. Pause/stop the same stale candidate by confirming lock rows and ensuring the task is not actively running.
2. Inspect and reconcile `/opt/client-site` state:
   - identify the latest stash entry for this run,
   - resolve merge conflicts if any (`blog/index.html` merge state is common),
   - or keep user-approved draft files and restore clean state before proceeding.
3. Restore the repo to a clean mergeable branch and rerun with guard env vars.
4. If the task should continue, manually trigger next run and verify it advances to `preview_ready`/`deployed`.
5. If no advancement after multiple runs, escalate as blocked and do not switch to a different task automatically.

## Script fragment
Keep this pattern in the cron wrapper:
- `claim_task_lock`
- trap to call `release_task_lock` + existing cleanup

## Related hardening notes
- Keep shell file lock (`flock`) and DB task lock together:
  - file lock prevents multiple script processes.
  - DB lock prevents same task being worked twice across process windows.
- Always run lock cleanup in `EXIT` trap so it happens on success or error.

## What to include in post-incident notes
- candidate task id, cron behavior, whether status transitioned, and lock id.
- log excerpt showing either claimed/skip path.
- SQL evidence from the queries above.