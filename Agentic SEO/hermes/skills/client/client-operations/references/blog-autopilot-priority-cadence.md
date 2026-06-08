# Blog Autopilot Priority Cadence

> Superseded current-state note: this records older 15-minute/30-minute publisher cadence history. The active split-lane Linux cron now uses `run-blog-publisher.sh` at `*/12 * * * *` with `CLIENT_BLOG_PUBLISHER_PREVIEW_BACKLOG_LIMIT=200`; verify via `tools/install_linux_scheduler.js` / `crontab -l` instead of older `7-59/15` or `7,37` lines.

Use this when the user asks for all {{SITE_NAME}} blog candidate tasks to be picked and completed one-by-one by priority on a frequent schedule.

## Durable lesson
`run_task_executor.js` intentionally excludes `new_blog_post` candidates by default. Do **not** make the generic deterministic executor write blog posts with `--include-new-blog-posts` for normal autopilot; that path can produce thin placeholder content and bypass the site tools blog-writing skill. Blog candidates must be handled by the skill-based blog publisher worker.

## Expected safe/semi-safe behavior
- Treat the scheduler change as semi-safe operational automation: it can create/push preview branches and send review details, but must not merge production without approval.
- Use one blog task per tick.
- Sort/pick order should be priority order from the authoritative DB (`/opt/client-sqlite/seo-agent.db`).
- Semi-safe blog completion means `preview_ready` with branch/review details, not production deployment.
- The writer must read and follow `/opt/client-site/tools/blog-production-skill.md` (and `/opt/client-site/tools/stats-blog-production-skill.md` for statistics topics).

## Cron wrapper pattern
Keep `/opt/client-agent/tools/cron/run-task-executor.sh` for non-blog tasks and omit `--include-new-blog-posts`. Use the separate skill-based blog worker:

```bash
*/12 * * * * cd /opt/client-agent && CLIENT_BLOG_PUBLISHER_ALLOW_DIRTY=1 CLIENT_BLOG_PUBLISHER_STASH_DIRTY=1 CLIENT_BLOG_PUBLISHER_PREVIEW_BACKLOG_LIMIT=200 ./tools/cron/run-blog-publisher.sh >> tools/out/logs/blog-publisher.log 2>&1
```

The blog worker should preselect the highest-priority eligible `new_blog_post`, call `hermes chat --skills client-blog-publisher`, require the site tools blog production skill, and mark `preview_ready` through `node tools/record_blog_preview_ready.js` after the preview branch is validated and pushed.

Before each task, reset the site repo to the production branch so a new preview branch never starts from the previous preview branch:

```bash
git -C "$SITE_ROOT" checkout "$PRODUCTION_BRANCH"
git -C "$SITE_ROOT" pull --ff-only origin "$PRODUCTION_BRANCH"
```

## Verification
- Syntax check the wrapper: `bash -n tools/cron/run-task-executor.sh`.
- Run relevant Node tests for autopilot lanes/cron worker behavior.
- Verify live crontab contains the 15-minute wrapper line.
- Export tasks from the authoritative DB and confirm the next expected blog candidate is the highest-priority remaining `new_blog_post` candidate.
- Keep production status separate from preview status in the report.
