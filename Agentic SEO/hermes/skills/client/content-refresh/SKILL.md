---
name: client-content-refresh
description: Refresh and audit {{SITE_NAME}} blog content for SEO quality, ranking potential, and publish-readiness
version: 1.1.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Content, Refresh, QA]
    related_skills: [client-system-rules, client-preview-branch, client-safe-fix]
    requires_tools: [terminal]
    requires_python: true
---
# {{SITE_NAME}} Content Refresh & Blog QA

## When to Use
Use this skill when:
- **The blog pipeline worker invokes you for a `content_refresh` / `edit_refresh_needed` task** (cron, no human present) - follow **Autonomous Pipeline Mode** below end-to-end, including publishing.
- The user asks for content refresh, "QA the blogs," post quality hardening, or publish-readiness checks for newly added articles - interactive mode; the human gates apply.

## Scope
- Refreshing existing posts (title/meta/body/faq/schema/interlinking)
- Reviewing newly published posts for depth and competitiveness
- Salvaging over-templated city/cluster blogs without wasting already-written or deployed pages (see `references/city-blog-cluster-salvage.md`)
- Pre-flight checks before asking for deployment
- Post-change regression checks on `/blog/index.html`, article URLs, and `sitemap.xml`

## Autonomous Pipeline Mode (content_refresh tasks — NO human gate)

This is the remediation arm of the Outcome Loop: when a content-lever change confirms
a performance regression (or the planner queues a refresh), a `content_refresh` task
lands in the blog_content lane and the */19 blog pipeline starts you in a fresh
session. **There is no human in this loop.** Waiting for approval, stopping at a QA
report, or "recommending next steps" means the task is re-picked, burns its 3 worker
attempts, and parks in needs_review while the page keeps declining. You must finish:
read → re-optimize → QA → publish → record.

1. **Load the task** (the worker prompt gives you the task_id):
   `node cli/bin/v2.js db query --sql "SELECT * FROM tasks WHERE task_id = ?" --params '["<TASK_ID>"]' --json`
   Read `metadata_json.evidence` carefully — an Outcome-Loop refresh carries
   `baseline_clicks` / `current_clicks` / `position_deltas` telling you exactly what
   regressed and for which keywords.
2. **Recall memory first**: `brain summary` + `brain recall` for the topic/URL.
   Respect standing policy and no-go terms; do not repeat a tactic a prior lesson
   says failed for this page.
3. **Read the EXISTING published file** (task `target_file`/`target_url`) in full
   before touching it. NEVER change the slug/URL/canonical and NEVER create a new
   page — this is an in-place refresh.
4. **Re-optimize against the Quality Targets below**: sharpen title/meta/H1 for the
   regressed keywords (keep intent, don't keyword-stuff), deepen thin sections,
   update stale stats/years/prices, expand the FAQ, fix schema, strengthen internal
   links (hub/spoke + money pages), and improve image alts. Make the page better
   than the SERP competition for the target query, not just different.
5. **QA before publishing** — run the Mandatory Verification Sequence and the
   `scripts/qa-published-blogs.py` rubric on the changed file. Do not publish a C/D
   grade result; fix it first.
6. **Publish straight to main** (no preview gate) via the v2 deploy commands the
   worker prompt specifies, wait for the production build, and confirm the live URL
   returns 200 with your changes present.
7. **Record state**: `task update --status deployed_to_production`, send the owner
   email, and write ONE Brain note (lesson if this was an Outcome-Loop remediation:
   what regressed, what you changed, what to watch). The deploy itself re-opens a
   content-lever measurement window automatically — do not also create follow-up
   tasks by hand.

The "keep the repo untouched until the user approves" rule in the queue-insertion
workflow below applies ONLY to interactive candidate creation — it does NOT apply
here. In pipeline mode the approval already happened when the task was marked
`approved`; executing it is the sanctioned autonomous path.

## Risk Classification (for this task class)
- **Safe**: typo fixes, alt-text tweaks, metadata edits, non-structural wording edits
- **Semi-safe**: section additions/reframing, FAQ expansion, adding internal links, content structure changes (`H2/H3` additions), image count/quality updates
- **High-risk**: removing sections, changing canonical links, changing slug/URL, deleting old content, or altering sitemap/index ordering

## Core Quality Targets (internet-best posture)
Each target blog should aim for:
- `2500+` words for flagship strategy/â€œhow-toâ€ posts (minimum acceptable around `2200+`)
- `10+` meaningful `H2` sections (or equivalent logical sections)
- FAQ section with `>= 6` questions for long-form guides
- Image support: at least `5` total images with descriptive `alt` (hero + 3+ supporting visuals)
- Internal links that are resolvable in repo paths
- Schema + OG tags still valid after edits (BlogPosting, FAQPage, Organization where exist)

## Priority rewrite/task creation workflow (SQLite queue-driven)
Use this path when user asks for â€œrewrite these specific posts,â€ â€œrefresh these articles,â€ or asks for high-priority task insertion:

1. Build a small candidate JSON file with these keys per item:
   - `title`
   - `description`
   - `status` (use `candidate`)
   - `risk_level`
   - `priority` (use `>= 800` for requested high-priority rewrites)
   - `source`
   - `target_url`
   - `target_file`
   - `target_keyword`
   - `approval_required`
   - `metadata.task_type` (prefer `content_refresh`)
   - `metadata.evidence.recommendation` (must mention Serper workflow before rewrite)
2. Run:
```bash
cd /opt/client-agent
node tools/generate_task_candidates.js --input /tmp/serper_content_rewrite_tasks.json --db /opt/client-sqlite/seo-agent.db --json
```
3. Verify insertion:
```bash
node tools/export_task_queue.js --status candidate --json | jq '.tasks[] | select(.status=="candidate") | {task_id,title,priority_score,task_type,target_file,target_url,risk_level,approval_required}'
```
4. Confirm candidates are truly queued in `/opt/client-sqlite/seo-agent.db` before touching content files.
5. Keep the repo untouched until the user approves execution flow for a specific candidate. (Interactive mode only — in Autonomous Pipeline Mode the task is already `approved` and you MUST execute and publish; see above.)

## One-By-One QA Checklist (for blogs published today)
Run these checks for each article, then summarize blockers:

1. **Identify the dayâ€™s set**
   - Parse `blog/index.html` and filter cards by date/meta text matching publish date.
   - Confirm count matches user expectation.
2. **Route checks**
   - Fetch each slug page: `https://{{DOMAIN}}/blog/<slug>.html`
   - Require HTTP 200 for all.
3. **Depth checks (per article)**
   - Word count
   - H2 count
   - FAQ JSON-LD count
   - Image count and lazy-loading ratio
   - CTA presence (`contact`, `book`, `call`, `audit`, `quote`, `schedule`, `consult` wording)
4. **Quality scoring**
   - Score A/B/C/D using script rubric (A strongest)
   - Flag each with 1-3 concrete next edits
5. **Integrity checks**
   - Verify `canonical`, `og:` tags, and `author` schema present
   - Verify no unresolved internal links are introduced by edits
6. **Set-level integrity**
   - Validate `blog/index.html` and `sitemap.xml` include every target slug once
   - Verify index order + card meta values parse consistently

## Mandatory Verification Sequence
After any local content changes, validate in sequence:
1. `curl` `https://{{DOMAIN}}/blog/`
2. `curl` `https://{{DOMAIN}}/blog/index.html`
3. `curl` `https://{{DOMAIN}}/sitemap.xml`
4. Run the local parser audit script on current repo state
5. Run the same script on the live snapshot and compare slug parity (local vs live)
6. Re-run only the changed slug URLs on live

## Script + Reference Hooks
- Reusable script: `scripts/qa-published-blogs.py`
  - Produces per-post metrics and A/B/C/D depth grade
  - Supports optional comparison of local vs live parity checks
- Reference: `references/blog-qa-checklist.md`
  - Rubric, thresholds, and common failure patterns observed during recent runs
- Reference: `references/city-cluster-salvage-from-templated-posts.md`
  - How to salvage already-written city posts that came from adjacent competitor-gap roundups and were over-templated into repeated â€œlocal pack teardownâ€ titles.

## Pitfalls and Fixes
- **False-negative parsing bugs are common** if regex is too strict for card date/meta patterns. Prefer structured HTML parsing first and fallback only when necessary.
- **Cloudflare cache headers are noisy**: `cf-cache-status: HIT` can appear even with cache-control `no-cache`; do not use cache header alone as freshness proof.
- **Local-only commit drift** can show extra slugs in local index that are not live yet. Always compare `blog/index.html` local hash vs origin/live and only report â€œmissing in prodâ€ when parity is computed explicitly.
- If one pass shows â€œall HTTP 200 but quality is low,â€ do not mark publish-ready; route for second-pass content expansion.
- **Over-templated city clusters are salvageable**: when city posts share the same title formula because an editorial cleanup re-angled competitor-gap tasks, do not jump to delete/noindex. First trace source and angle changes in SQLite `tasks`/`events`, use Obsidian only as a mirror clue, preserve URLs, vary title/H1/meta, add city-specific differentiation blocks, build hub/spoke internal links, and add rank tracking. See `references/city-cluster-salvage-from-templated-posts.md`.

## Output Contract
When reporting, include:
- Risk classification
- Published slug list + count
- Per-post grade + blockers
- Top blockers first (C/D first)
- Suggested next actions in execution order (not generic recommendations)

## Command Template
```bash
cd /opt/client-site
python3 scripts/qa-published-blogs.py \
  --index blog/index.html \
  --source-root . \
  --date 'June 1, 2026'
```

For live parity checks, pass live HTML snapshots or run the optional `--live-url` flag in the script (see references).

## Why this skill exists
This process ensures that â€œmany new postsâ€ actually means meaningful, searchable, and competitive guides rather than thin pages with superficial edits.
