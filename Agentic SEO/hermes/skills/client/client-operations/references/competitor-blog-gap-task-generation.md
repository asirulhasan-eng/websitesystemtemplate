# Competitor Blog Gap Task Generation

Use this when the user asks to cover all posts from another site's blog and add missing topics to the {{SITE_NAME}} task list.

## Risk lane
- **Safe** when limited to competitor inventory, coverage analysis, creating blog briefs, and inserting task candidates through project tooling.
- The resulting future blog-writing tasks are usually **semi-safe** because they should create preview branches and must not merge to production without approval.

## Workflow
1. State Safe risk classification before acting.
2. Check repo status for the four {{SITE_NAME}} repos. If `/opt/client-sqlite/seo-agent.db` becomes modified after task insertion, that is expected; report it clearly.
3. Build a competitor post inventory from more than just `/blog/` links:
   - Fetch `/blog/` and paginated `/blog/page/N/` pages when present.
   - Fetch `/sitemap.xml` and especially `post-sitemap.xml`; WordPress blogs may list posts under category paths such as `/seo/...`, `/web-design/...`, or `/web-development/...` instead of `/blog/...`.
   - For each competitor URL, extract URL, slug/path, `<title>`, `<h1>`, and meta description.
4. Build own coverage from `/opt/client-site/blog/*.html` excluding `blog/index.html` and archived posts unless archive comparison is explicitly needed. Extract filename, `<title>`, `<h1>`, and meta description.
5. Classify every competitor post as:
   - `covered` with the best matching own file and a short reason, or
   - `not_covered` when no dedicated or materially equivalent article exists.
   Treat subtopic coverage as partial: if existing posts only cover pieces of a competitor roundup, create a task only when a dedicated roundup would add a materially useful angle.
6. For each not-covered topic, create a concise blog brief with:
   - proposed title/H1,
   - primary keyword,
   - target URL and target file,
   - search intent,
   - competitor source URL,
   - differentiation angle,
   - outline,
   - FAQ targets,
   - internal-link/content requirements.
7. Save durable artifacts under `tools/out/competitor-blog-gaps/`:
   - a JSON report with `coverage` and `candidates`,
   - a Markdown human-readable brief report.
8. Insert tasks through the official generator, not raw SQLite:
   ```bash
   cd /opt/client-agent
   node tools/generate_task_candidates.js \
     --input /opt/client-agent/tools/out/competitor-blog-gaps/<gap-briefs>.json \
     --db /opt/client-sqlite/seo-agent.db \
     --out /opt/client-agent/tools/out/competitor-blog-gaps/<task-insert-output>.json \
     --json
   ```
9. Run Obsidian outbox sync so task notes are mirrored:
   ```bash
   cd /opt/client-agent
   seo-agent outbox-obsidian --db /opt/client-sqlite/seo-agent.db --limit 50 --json
   ```
10. Verify with:
   ```bash
   cd /opt/client-agent
   sqlite3 -json /opt/client-sqlite/seo-agent.db \
     "SELECT task_id, priority_score, risk_level, status, title, target_keyword, target_file FROM tasks WHERE source='<source_name>' ORDER BY priority_score DESC;"
   seo-agent export-tasks --db /opt/client-sqlite/seo-agent.db --status candidate --limit 50 --json
   ```

## Candidate conventions
- Use `source` like `competitor_blog_gap_<domain_slug>`.
- Use `task_type: new_blog_post`.
- Use `risk_level: semi_safe` for future blog creation tasks.
- Use deterministic candidate IDs compatible with `createTaskCandidate`: date + SHA1 of source/task type/target URL/keyword/title.
- Keep `approval_required: false` for preview-branch creation tasks, unless the brief implies high-risk production or brand/legal changes.
- Include competitor source and the full blog brief in `evidence.blog_brief`.

## Pitfalls
- Do not assume a site's `/blog/` URL means post URLs live under `/blog/`; WordPress category permalinks often appear in `post-sitemap.xml`.
- Do not mark a topic uncovered just because the exact title differs. Compare intent and existing H1s/descriptions.
- Do not create duplicate tasks for topics already represented in the candidate queue; export current candidates before insertion if collision risk is high.
- Do not edit production blog HTML during this planning workflow. The tasks should drive later semi-safe preview work.
- After inserting `task_type: new_blog_post` tasks, immediately verify one with `node tools/execute_safe_task.js --db /opt/client-sqlite/seo-agent.db --site-root /opt/client-site --task <TASK_ID> --json`; it must return at least one `write_file` action. If it returns `no_action` / `Task type new_blog_post is not a deterministic safe edit`, fix the executor before the semi-safe pipeline can move the task to `monitored` with `semi_safe_no_preview_required`.
