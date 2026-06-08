---
id: industry-radar
name: "Industry Radar"
version: 1
type: producer
description: "Daily scan of SEO / GBP / PPC / Google core-update / local-SEO / {{NICHE}}-industry news. Translates the newsworthy items into 'what this means for your {{NICHE}} business' blog topics and ENQUEUES them as new_blog_post tasks (status=approved). Producer â€” enqueue-only."
trigger:
  schedule: "2 5 */2 * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
guardrails:
  max_duration_minutes: 20
  abort_on_error: false
  max_tasks_per_run: 10
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, News, Blog, Content]
    related_skills: [client-system-rules, client-operations]
    requires_tools: [terminal]
---

# Industry Radar

> Daily: watch the outside world (Google + the {{NICHE}} trade), turn what matters into
> blog topics, and drop them straight into the blog writing queue.

## Scope (PRODUCER â€” enqueue-only)

You are a **producer**. Your job is to **discover topics and ENQUEUE `new_blog_post` tasks**
with `status=approved`. You do **NOT**:

- write the blog yourself â€” the `*/19` blog pipeline (`cron/run-blog-pipeline.sh`) picks up your
  approved tasks and writes them via the production skill at
  `/opt/client-site/tools/blog-production-skill.md` (routed through
  `processes/new-blog-creation.md`). One task per tick.
- touch any other task type, run executors (safe-fix / semi-safe / high-risk), or deploy.
- create tasks for the daily planner's beats (GSC/SERP/keyword gaps). Those are the planner's.

You are the **second enqueue-only producer** (the daily workplan is the first). Both only
enqueue; the consumer lanes execute. See `processes/dual-pipeline-plan.md`.

The CLI is at `/opt/client-agent/cli/bin/v2.js`; always pass `--db /opt/client-sqlite/seo-agent.db`.
In examples below, `V2` = `node /opt/client-agent/cli/bin/v2.js` and `DB` = `--db /opt/client-sqlite/seo-agent.db`.

Runtime knobs are passed in by the orchestrator: `RADAR_MAX_TOPICS` (default 10, the hard cap
on tasks you may create this run) and `RADAR_LOOKBACK_DAYS` (default 7, how fresh "news" must be).

---

## Step 1 â€” Memory & standing policy (read before deciding)

```bash
node $V2 brain summary --markdown
node $V2 brain recall --query "industry radar" --markdown
node $V2 brain recall --query "blog topics" --markdown
```

Read policy files:
- `config/guardrails.json` â€” note `keyword_strategy.homepage_canonical_money_terms` (the 6 head
  money terms target the HOMEPAGE, never a new blog) and the opt-out approval model.
- `config/site.json` â€” brand, domain, services, locations, audience.

Respect any prior decision / no-go you recall. Do not re-propose a topic memory says was rejected.

## Step 2 â€” Build the recent-topic dedup set (never repeat yourself)

```bash
node $V2 db query $DB --json --sql "SELECT title, target_keyword, created_at FROM tasks WHERE (source='industry_radar' OR metadata_json LIKE '%new_blog_post%') AND created_at > datetime('now','-30 day') ORDER BY created_at DESC"
```

Hold this list. Any candidate that is a near-duplicate (same angle / keyword) of something here
is SKIPPED in Step 5.

## Step 3 â€” Scan the beats (Serper news search, last ~`RADAR_LOOKBACK_DAYS` days)

Use the **Serper-backed `v2 news search`** command for discovery â€” do NOT rely on built-in web
search (it is unreliable; Serper is the source of truth here). For EACH beat run one or more
queries, e.g.:

```bash
node $V2 news search --q "google core update" --days ${RADAR_LOOKBACK_DAYS} --num 10 --json
node $V2 news search --q "google business profile update {{AUDIENCE}} local" --days ${RADAR_LOOKBACK_DAYS} --json
```

Each result is `{ title, link, snippet, date, source }`. Cover all beats every run; you pick the
best across all in Step 5. Run a few well-chosen queries per beat:

| Beat key | What to watch | Example queries |
|----------|---------------|-----------------|
| `core_update` | Google core / algorithm / spam updates, ranking volatility | "google core update", "google algorithm update", "google ranking volatility" |
| `seo` | Organic SEO best-practice / feature / SERP changes (AI Overviews, schema) | "google search update", "AI overviews SEO", "SEO news" |
| `gbp` | Google Business Profile features, policy, ranking factors, reviews | "google business profile update", "google maps local pack update" |
| `ppc` | Google Ads / Local Services Ads (LSA) changes relevant to {{AUDIENCE}} | "google ads update", "local services ads update", "google ads local" |
| `local_seo` | Local pack, citations, NAP, map ranking, LSA, near-me intent | "local seo update", "google local search ranking" |
| `{{NICHE}}_industry` | {{NICHE}} trade news, codes/regulation, tech/breakthroughs, demand | "{{NICHE}} industry news", "{{NICHE}} code change", "{{NICHE}} technology" |

For each item you keep, capture **title, source URL (`link`), publish date (`date`)** straight from
the Serper result. Only keep items inside the lookback window. If `v2 news search` errors (e.g.
`Missing SERPER_API_KEY`) or returns nothing across all beats, do NOT fabricate â€” log it and
enqueue nothing (fail soft).

## Step 4 â€” Translate each item into a {{NICHE}}-business blog topic

For every newsworthy item, write the **"what this means for your {{NICHE}} business"** angle and
derive:
- **topic** â€” a concrete blog title idea (e.g. "What Google's March 2026 Core Update Means for
  {{NICHE}} Companies' Rankings").
- **target_keyword** â€” the primary phrase a {{NICHE}} business owner would search.
- **brief** â€” 2â€“4 sentences: the development + why a {{AUDIENCE}} should care + what action it implies.
- **production_line** â€” `standard` (editorial/how-to/explainer â€” the default) or `stats` (a data
  roundup with many cited statistics). See `processes/new-blog-creation.md` for the distinction.
- **beat** â€” one of the beat keys above.
- **priority** â€” 120â€“300, higher for higher business impact (a confirmed core update > a minor
  PPC UI tweak).

## Step 5 â€” Gate every candidate (HARD rules â€” all must pass)

1. **Dedup** â€” skip if it duplicates anything in the Step 2 set or another candidate this run.
2. **Homepage-canonical guard** â€” do NOT set `target_keyword` to any of the 6 head money terms
   (`{{NICHE}} seo`, `{{AUDIENCE}} seo`, `{{NICHE}} seo agency`, `{{AUDIENCE}} seo agency`,
   `{{NICHE}} seo services`, `seo for {{AUDIENCE}}`). Those support the homepage via internal links,
   not a new blog. Pick a longer-tail, topical keyword instead.
3. **Cannibalization check (REQUIRED â€” and the task-create gate enforces it):**
   ```bash
   node $V2 content blog-cannibalization --topic "<topic>" --target-keyword "<target_keyword>" --site-root /opt/client-site --json
   ```
   - The result is a flat JSON envelope with a **top-level `recommendation`** field (plus
     `risk`, `action`, `matched_blog_count`, `matches`, etc.) â€” there is no `.data` wrapper.
   - **Lean-autonomous gate** (the check now only blocks a genuine same-query collision):
     - `create_new_blog` â†’ **PROCEED** (no material overlap).
     - `differentiate_or_refresh` â†’ **PROCEED**, but sharpen the topic/brief so the new post
       covers a clearly distinct angle/audience from `matches[0]` (note it in the brief).
     - `refresh_existing_blog` â†’ **SKIP**. This now fires only on a true collision (an existing
       blog already targets the same primary query, exact keyword/heading hit). The planner
       owns refreshing that post â€” not your job.
   - Keep the returned result object; you embed it as `blog_cannibalization_check` below
     (it must carry the `recommendation` key â€” that is exactly what the task-create gate checks).

## Step 6 â€” Enqueue surviving candidates (cap at `RADAR_MAX_TOPICS`)

Rank survivors by priority and create up to `RADAR_MAX_TOPICS` tasks. Quiet days may produce 0 â€”
that is fine; never pad the queue. For each:

```bash
node $V2 task create \
  --type new_blog_post \
  --title "Create blog: <topic>" \
  --status approved \
  --risk-level high_risk \
  --source industry_radar \
  --priority <120-300> \
  --target-keyword "<target_keyword>" \
  --tags "industry-radar,<beat>" \
  --evidence '{
    "type":"new_blog_post",
    "beat":"<beat>",
    "news_angle":"<what this means for {{NICHE}} businesses, 1-2 sentences>",
    "brief":"<the 2-4 sentence brief>",
    "production_line":"standard|stats",
    "sources":[{"title":"<source title>","url":"<source url>","published":"YYYY-MM-DD"}],
    "blog_cannibalization_check": <PASTE the Step 5 result object, incl. its top-level "recommendation":"create_new_blog">
  }' \
  $DB --json
```

Notes:
- Title starts with `Create blog:` and `--type new_blog_post`, so routing sends it to the
  `blog_content` lane â†’ `draft_needed` bucket (`cli/lib/task_routing.js`). The `*/19` worker
  authors it via the production skill.
- `status=approved` is permitted because `new_blog_post` is NOT in
  `guardrails.require_explicit_approval`. This auto-approval is the owner's standing policy
  ("blogs approved by default") â€” the owner reviews the live site daily.
- The `blog_cannibalization_check` evidence is **mandatory**; `task create` rejects a
  `new_blog_post` without it.

## Step 7 â€” Record + report

1. **One Brain note** (decision) summarizing what you enqueued so tomorrow's run dedups:
   ```bash
   node $V2 brain note add --type decision \
     --title "Industry radar $(date +%Y-%m-%d): enqueued N blog topics" \
     --body "<beat: topic (keyword) â€” source>; one per line. Note anything notable you skipped." \
     --tags industry-radar,blog --session industry-radar
   ```
2. **Digest email** to the owner:
   ```bash
   node $V2 email send --to {{ADMIN_EMAIL}} \
     --subject "ðŸ“¡ Industry Radar â€” N blog topics enqueued ($(date +%Y-%m-%d))" \
     --body "<bulleted list: topic â€” beat â€” why it matters â€” source url â€” task_id>. If 0, say why (quiet day / all deduped / cannibalization)." \
     --json
   ```

## Hard limits (do not violate)

- Never create more than `RADAR_MAX_TOPICS` tasks in one run.
- Never create a task whose cannibalization check returned `refresh_existing_blog` (true
  same-query collision). `create_new_blog` and `differentiate_or_refresh` both proceed.
- Never target a homepage-canonical head money term with a new blog.
- Never fabricate news. No real, in-window, sourced development â†’ enqueue nothing.
- You are enqueue-only: never run safe-fix / semi-safe / high-risk, never deploy, never write
  the blog yourself.
