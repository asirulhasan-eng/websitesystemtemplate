# Scheduled new_blog_post preview workflow

Use this when a scheduled Hermes job is meant to pick up **one** {{SITE_NAME}} `new_blog_post` candidate and create a real preview branch using the blog-publisher workflow.

## Durable pattern

1. **Start with the scheduled-job notice if present.** If the job context says a required skill was missing (for example `client-system-rules`), include a short warning at the start of the final report.
2. **Select at most one task from the authoritative DB** `/opt/client-sqlite/seo-agent.db`:
   - `risk_level='semi_safe'`
   - candidate metadata indicates `task_type='new_blog_post'` or `evidence.type='new_blog_post'`
   - sort by `priority_score DESC, created_at ASC`
   - skip no-go topics such as `switch.monster`.
3. **Preflight before editing**:
   - show branch/status for `/opt/client-site` and `/opt/client-agent`
   - stop on unsafe uncommitted site changes.
4. **Write a real article, not the generic deterministic fallback**:
   - inspect existing `blog/*.html`, `blog/index.html`, `sitemap.xml`, CSS/JS, related-card and FAQ patterns
   - use the repo scaffold if available, otherwise clone the closest production pattern
   - include metadata, canonical, JSON-LD, FAQ, CTA, related posts, and index/sitemap updates.
5. **Create the preview branch from `master`** using a deterministic branch name like:
   - `agent/<task_id>-<slug>`
6. **Validate before pushing/reporting**. Minimum checks that worked well:
   - generated HTML exists
   - exactly one `<h1>`
   - all JSON-LD parses
   - visible FAQ count equals FAQPage schema count
   - no raw `<details>/<summary>` FAQ or unsupported component classes
   - related-card count is expected
   - local references/assets are reasonable
   - `blog/index.html` and `sitemap.xml` include exactly one canonical slug entry
   - local HTTP serves article and `/blog/` as `200`
   - if possible, browser-test the FAQ accordion and check console errors.
7. **Push/open PR but do not merge**:
   - push the branch
   - open a PR with `gh` when available/authenticated
   - discover/verify Cloudflare branch preview with real HTTP checks.
8. **Record preview state through project helpers/scripts, not raw SQLite writes**:
   - mark the task `preview_ready`
   - store branch, PR URL, preview URL, validation summary, and deployment row
   - process Obsidian/task-note outbox if tooling supports it
   - if the scheduled cron final response is the delivery channel, avoid duplicate preview-email delivery/outbox noise when project tooling provides a safe cancellation path.
9. **Commit/push durable state repos** when the DB/Obsidian mirror changed:
   - `/opt/client-sqlite`
   - `/opt/client-obsidian`
10. **Final report should be concise evidence, not a narrative**:
    - task id/title
    - branch, commit, PR, preview URL
    - files changed
    - validation commands/results
    - SQLite/Obsidian state updates
    - explicit statement that production remained untouched.

## Pitfalls

- Do not run or edit cron configuration from inside this scheduled pickup job.
- Do not let the generic deterministic new-blog fallback satisfy this task; users expect a rich article from this skill.
- Keep delivery-channel semantics in mind: if the final Hermes response is the configured delivery mechanism, separate preview-email outbox messages may be duplicative.
- Kill any temporary local HTTP server/background process before finalizing if it is no longer needed.
