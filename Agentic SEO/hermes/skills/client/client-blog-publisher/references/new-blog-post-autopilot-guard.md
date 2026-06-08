# New blog post autopilot guard

Session learning: competitor-gap blog tasks with `task_type: new_blog_post` should not be allowed to pass through the generic deterministic safe-task executor as thin template drafts.

## Durable workflow rule

- Treat `new_blog_post` tasks as blog-writing work, not generic safe/semi-safe deterministic edits.
- Before moving a blog task to `preview_ready`, run the full `client-blog-publisher` workflow: research/brief review, scaffold or existing-post pattern selection, article writing, FAQ/schema, related posts, blog index/sitemap checks, and preview validation.
- The generic deterministic executor may be useful as a fallback scaffold only when explicitly requested, but it must not be the default publishing path for blog content.

## Pitfall observed

A deterministic `new_blog_post` implementation can create technically valid HTML from a brief, but the result may be a thin draft rather than a publishable {{SITE_NAME}} article. That is not enough for user expectations around blog-writing quality.

## Guard pattern

If maintaining the automation:

- Exclude `new_blog_post` tasks from normal `run_task_executor.js` semi-safe autopilot selection by default.
- Use an explicit override flag such as `--include-new-blog-posts` only for controlled tests or emergency fallback.
- Regression-test that normal cron/autopilot skips blog-writing tasks unless the blog-publisher workflow is intentionally invoked.
- For true automatic pickup, schedule a separate Hermes cron/job that loads `client-system-rules`, `client-operations`, and `client-blog-publisher`; have it select at most one eligible `new_blog_post` candidate every 15 minutes, write the article through this skill, create/push a semi-safe preview branch/PR, update the task to `preview_ready`, and never merge production.
- Keep the Hermes cron prompt self-contained: include authoritative DB path, site repo path/default branch, risk lane, switch.monster no-go rule, validation requirements, and the rule that the job must not recursively create/modify cron jobs.
- If an accidental deterministic preview is created, roll it back cleanly: return the site repo to the default branch, delete the local preview branch if local-only, requeue the task in SQLite, cancel stale preview/outbox jobs, and verify the task is back to `candidate`.

## Evidence commands from the session

```bash
cd /opt/client-agent
node --test test/autopilot-lanes.test.js test/task-executor-cron-worker.test.js test/semi-safe-preview-branch-policy.test.js
```

Expected signal: tests cover that `new_blog_post` tasks are reserved for the publisher workflow by default while deterministic preview behavior remains available only through explicit override.
