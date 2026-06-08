# Scheduler cadence collision: task executor vs blog publisher

## When this applies
Use this reference when {{SITE_NAME}} blog drafts are not being written even though:
- the blog publisher cron is firing,
- eligible `blog_content` / `new_blog_post` candidates exist,
- the latest blog-publisher logs repeatedly say the site worktree is busy or the worker skipped without touching git.

## Durable lesson
The general task executor and blog publisher share the `/opt/client-site` worktree lock. If their cron cadences align, the general executor can repeatedly grab the worktree at exactly the minute the blog publisher starts. The blog publisher then correctly skips rather than stashing/touching git while the site worktree is busy.

A common collision pattern was:
- task executor: `*/5`
- blog publisher: `*/20`
- collisions at `:00`, `:20`, and `:40`

The durable fix is not to bypass the lock. Keep the lock guard and change the cadences so the blog publisher has non-colliding start windows.

## Correct remediation pattern
1. Confirm the blog queue is not empty before changing scheduler state.
2. Inspect recent `tools/out/logs/blog-publisher.log` and `tools/out/logs/task-executor.log` for same-minute worktree-lock collisions.
3. Change cron through `/opt/client-agent/tools/install_linux_scheduler.js`, not by only editing live crontab.
4. Update scheduler docs and scheduler tests alongside the installer.
5. Run validation:
   - `node --check tools/install_linux_scheduler.js`
   - scheduler dry run before apply
   - backup current crontab
   - apply scheduler with installer
   - idempotency dry run after apply
   - relevant `node --test` scheduler/worker tests
6. Verify live crontab with `crontab -l`.
7. Wait for the next blog-publisher tick and confirm it starts a selected blog task rather than logging another busy-worktree skip.
8. Commit and push the scheduler/source/test/doc changes in `/opt/client-agent`.

## Example verified outcome
A successful post-fix verification log line looks like:

```text
Starting Hermes blog publisher for task <task_id>. Prompt: <prompt-path>
```

This confirms the blog worker got past the shared worktree lock and began the scheduled blog-writing run. Do not claim the blog draft is complete from this line alone; it only proves the blocker was removed and the worker started.

## Pitfalls
- Do not disable or ignore the shared worktree lock.
- Do not hand-edit crontab without updating the installer source; future scheduler refreshes will revert it.
- Do not treat SMTP credential errors as blog-writing blockers unless the draft/preview itself failed. Bad SMTP credentials can block preview email delivery while blog writing still works.
- Do not summarize scheduler changes as complete until live cron, installer idempotency, tests, and at least one post-change tick have been checked.
