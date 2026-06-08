# Stats blog skill pickup gate

Session-derived guardrail for {{SITE_NAME}} statistical/statistics/benchmark roundup blog tasks.

## Problem pattern

A batch of user-requested statistics blog tasks can have correct queue priority and corrected titles, but still be picked up by the scheduled blog worker through the generic blog-production path unless the task metadata, cron prompt, and preview-ready recorder all enforce the stats workflow.

This is especially risky when the preselect JSON snapshot is stale: the wrapper may initially show an old templated title such as `75+ Data Points`, while SQLite has already been corrected to a more natural varied-count title. Future workers must re-read SQLite and use the authoritative title/metadata.

## Durable fix pattern

1. Keep the normal blog workflow loaded, but require the stats workflow for statistics/data/benchmark roundups:
   - `/opt/client-site/tools/blog-production-skill.md`
   - `/opt/client-site/tools/stats-blog-production-skill.md`
2. For each stats task, ensure SQLite metadata includes:
   - `evidence.content_workflow = "stats_blog_production_skill"`
   - `evidence.required_site_skill = "/opt/client-site/tools/stats-blog-production-skill.md"`
   - `evidence.required_site_skills = [blog-production-skill.md, stats-blog-production-skill.md]`
   - `evidence.stats_blog_workflow_required = true`
   - `evidence.preview_ready_gate.stats_blog_skill_loaded_check = "checks.stats_blog_skill_loaded must be true in validation evidence"`
   - `evidence.blog_brief.proposed_title_h1` matching the corrected SQLite title
   - `evidence.blog_brief.stats_count_promise` matching the varied count in the title
3. The cron wrapper prompt should inject a visible stats gate when selected-task JSON/title/metadata indicates a stats roundup:
   - `## Statistics blog workflow gate`
   - `checks.stats_blog_skill_loaded: true`
   - required stats skill path
   - reminder to use the corrected title from SQLite when preselect JSON differs.
4. `tools/record_blog_preview_ready.js` should refuse to mark stats roundup tasks `preview_ready` unless validation evidence proves the stats skill was loaded:
   - `checks.stats_blog_skill_loaded = true`
   - stats skill path appears in `required_skills` or `commands`.
5. Add/update tests for both sides:
   - cron prompt includes stats workflow gate and corrected-title reminder
   - preview-ready helper rejects missing stats skill evidence and accepts valid stats evidence.

## Verification probes

Use concise proof, not broad log dumps:

```bash
bash -n tools/cron/run-blog-publisher.sh
node --check tools/record_blog_preview_ready.js
node --test test/blog-publisher-worker.test.js test/blog-preview-validation-gate.test.js
```

Then run a dry pickup after ensuring no active publisher lock blocks it:

```bash
CLIENT_BLOG_PUBLISHER_DRY_RUN=1 \
CLIENT_BLOG_PUBLISHER_PREVIEW_BACKLOG_LIMIT=200 \
tools/cron/run-blog-publisher.sh
```

Inspect the generated prompt for:

- corrected SQLite title (not stale preselect title)
- `/opt/client-site/tools/stats-blog-production-skill.md`
- `## Statistics blog workflow gate`
- `checks.stats_blog_skill_loaded: true`

## Operational notes

- If a previous publisher run completed work but the process hangs on an outbox/email/local-server child, verify task state and repo cleanliness first; then release stale locks through the project lock tooling rather than raw SQLite when possible.
- Commit/push durable SQLite state changes after metadata gates, lock releases, or dry-run evidence update the DB.
- Sync Obsidian outbox so mirrored task notes show required stats workflow metadata, but remember SQLite remains source of truth.
