---
id: industry-radar
name: "Industry Radar"
version: 2
type: intelligence_module
description: "Report-only scan of SEO / GBP / PPC / Google core-update / local-SEO / website-industry news. Translates newsworthy items into planner-ready blog ideas and saves them as an intelligence report for the Daily Planner."
trigger:
  schedule: "2 5 */2 * *"
  timezone: Asia/Dhaka
  can_run_manually: true
guardrails:
  max_duration_minutes: 20
  abort_on_error: false
  max_reported_ideas_per_run: 10
outputs:
  - name: "Industry radar intelligence report"
    type: report
    description: "Saved via v2 intelligence report; no tasks are created or approved"
metadata:
  hermes:
    tags: [SEO, Website Operations, News, Blog, Content, Intelligence]
    related_skills: [client-system-rules, client-operations]
    requires_tools: [terminal]
---

# Industry Radar

> Watch the outside world (Google + the website trade), turn what matters into
> planner-ready blog ideas, and save a report that the twice-daily Daily Planner can decide from.

## Scope (REPORT-ONLY — planner input)

You are an **intelligence module**. Your job is to discover outside-world news, translate it into
high-quality blog/content ideas, and save exactly one structured `v2 intelligence report`.

Planner-sole-producer contract:

- The **Daily Planner is the sole routine task producer**.
- Industry Radar does **not** create tasks.
- Industry Radar does **not** approve tasks or set task status.
- Industry Radar does **not** run executors (`safe-fix`, `semi-safe`, `high-risk`) or deploy.
- Industry Radar does **not** write blogs. If the planner later chooses an idea, the existing blog
  pipeline routes the resulting task through `processes/new-blog-creation.md`.
- A future Industry Radar cron tick must produce zero `industry_radar` task-source rows. Ideas are
  only allowed to become tasks when the workplan explicitly routes them from intelligence.

The CLI is at `/opt/website-agent/cli/bin/v2.js`; always pass `--db /opt/website-state/website-agent.db`.
In examples below, `V2` = `/opt/website-agent/cli/bin/v2.js` and `DB` = `--db /opt/website-state/website-agent.db`.

Runtime knobs are passed in by the orchestrator: `RADAR_MAX_IDEAS` (default 10, hard cap on ideas
to include in the report) and `RADAR_LOOKBACK_DAYS` (default 7, how fresh "news" must be).

---

## Step 1 — Memory & standing policy (read before deciding)

```bash
node $V2 brain summary --markdown
node $V2 brain recall --query "industry radar" --markdown
node $V2 brain recall --query "blog topics" --markdown
node $V2 intelligence search --module industry-radar --days 30 $DB --json
node $V2 intelligence latest --all $DB --json
```

Read policy/context files:
- `config/guardrails.json` — note `keyword_strategy.homepage_canonical_money_terms` (the 6 head
  money terms target the HOMEPAGE, never a new blog idea) and the opt-out approval model.
- `config/site.json` — brand, domain, services, locations, audience.
- `processes/new-blog-creation.md` — blog production lines and evidence expected if the planner
  later routes an idea into work.

Respect any prior decision / no-go you recall. Do not re-propose a topic memory says was rejected.

## Step 2 — Build the recent idea/task dedup set

Use intelligence reports and planner-routed blog tasks to avoid repetition. Do not treat this step
as permission to create or modify tasks.

```bash
node $V2 intelligence search --module industry-radar --days 30 $DB --json
node $V2 db query $DB --json --sql "SELECT title, target_keyword, source, created_at FROM tasks WHERE type='new_blog_post' AND created_at > datetime('now','-30 day') ORDER BY created_at DESC"
```

Hold this list. Any candidate that is a near-duplicate (same angle / keyword) of something here is
SKIPPED or recorded in `data.skipped`.

## Step 3 — Scan the beats (Serper news search, last ~`RADAR_LOOKBACK_DAYS` days)

Use the **Serper-backed `v2 news search`** command for discovery — do NOT rely on built-in web
search (it is unreliable; Serper is the source of truth here). For EACH beat run one or more
queries, e.g.:

```bash
node $V2 news search --q "google core update" --days ${RADAR_LOOKBACK_DAYS} --num 10 --json
node $V2 news search --q "google business profile update small business owners local" --days ${RADAR_LOOKBACK_DAYS} --json
```

Each result is `{ title, link, snippet, date, source }`. Cover all beats every run; you pick the
best across all in Step 5. Run a few well-chosen queries per beat:

| Beat key | What to watch | Example queries |
|----------|---------------|-----------------|
| `core_update` | Google core / algorithm / spam updates, ranking volatility | "google core update", "google algorithm update", "google ranking volatility" |
| `seo` | Organic SEO best-practice / feature / SERP changes (AI Overviews, schema) | "google search update", "AI overviews SEO", "SEO news" |
| `gbp` | Google Business Profile features, policy, ranking factors, reviews | "google business profile update", "google maps local pack update" |
| `ppc` | Google Ads / Local Services Ads (LSA) changes relevant to small business owners | "google ads update", "local services ads update", "google ads local" |
| `local_seo` | Local pack, citations, NAP, map ranking, LSA, near-me intent | "local seo update", "google local search ranking" |
| `small_business_seo_industry` | website trade news, codes/regulation, tech/breakthroughs, demand | "website industry news", "website code change", "website technology" |

For each item you keep, capture **title, source URL (`link`), publish date (`date`)** straight from
the Serper result. Only keep items inside the lookback window. If `v2 news search` errors (e.g.
`Missing SERPER_API_KEY`) or returns nothing across all beats, do NOT fabricate — save a quiet-day
report explaining the failure/empty result.

## Step 4 — Translate each item into a website-business blog idea

For every newsworthy item, write the **"what this means for your website owner"** angle and
derive:

- **topic** — a concrete blog title idea (e.g. "What Google's March 2026 Core Update Means for
  website Companies' Rankings").
- **target_keyword** — the primary phrase a website owner owner would search.
- **brief** — 2-4 sentences: the development + why small business owners should care + what action it implies.
- **production_line** — `standard` (editorial/how-to/explainer — the default) or `stats` (a data
  roundup with many cited statistics). See `processes/new-blog-creation.md` for the distinction.
- **beat** — one of the beat keys above.
- **priority** — 120-300, higher for higher business impact (a confirmed core update > a minor
  PPC UI tweak). This is advisory for the planner, not approval.

## Step 5 — Gate every candidate (all must pass to be reported as an opportunity)

1. **Dedup** — skip if it duplicates anything in the Step 2 set or another candidate this run.
2. **Homepage-canonical guard** — do NOT set `target_keyword` to any of the 6 head money terms
   (`website seo`, `small business owners seo`, `website seo agency`, `small business owners seo agency`,
   `website seo services`, `seo for small business owners`). Those support the homepage via internal links,
   not a new blog idea. Pick a longer-tail, topical keyword instead.
3. **Cannibalization check (REQUIRED for each reported opportunity):**
   ```bash
   node $V2 content blog-cannibalization --topic "<topic>" --target-keyword "<target_keyword>" --site-root /opt/website-site --json
   ```
   - The result is a flat JSON envelope with a **top-level `recommendation`** field (plus
     `risk`, `action`, `matched_blog_count`, `matches`, etc.) — there is no `.data` wrapper.
   - Planner-input gate:
     - `create_new_blog` → report as an opportunity.
     - `differentiate_or_refresh` → report only if the topic/brief is sharpened to a clearly
       distinct angle/audience from `matches[0]`.
     - `refresh_existing_blog` → do not report as a new-blog opportunity; record as skipped data.
   - Keep the returned result object in the opportunity's `blog_cannibalization_check` field.

## Step 6 — Save the intelligence report (cap at `RADAR_MAX_IDEAS`)

Rank surviving ideas by advisory priority and include up to `RADAR_MAX_IDEAS`. Quiet days may
produce 0 ideas — that is fine; never pad the report. Save one report:

```bash
REPORT_JSON=$(mktemp)
# Write a JSON object to $REPORT_JSON with opportunities/threats/observations/recommendations/data.
node $V2 intelligence report \
  --module industry-radar \
  --session manual \
  --severity "<normal|warning>" \
  --headline "<e.g. '4 planner-ready news-led blog ideas found; no tasks created'>" \
  --report-json-file "$REPORT_JSON" \
  --reports-root /opt/website-agent \
  $DB --json
```

Report JSON shape:

```json
{
  "opportunities": [
    {
      "type": "news_led_blog_idea",
      "topic": "<topic>",
      "target_keyword": "<target_keyword>",
      "brief": "<2-4 sentence planner-ready brief>",
      "production_line": "standard|stats",
      "beat": "<beat>",
      "priority": 120,
      "sources": [{"title":"<source title>","url":"<source url>","published":"YYYY-MM-DD"}],
      "blog_cannibalization_check": {"recommendation":"create_new_blog"},
      "planner_action": "Planner: consider whether to enqueue through the workplan."
    }
  ],
  "observations": ["Quiet day: all viable stories were duplicates."],
  "recommendations": [
    {"priority":"medium","action":"Planner: review industry-radar opportunities before the next blog batch.","evidence":"Fresh sourced industry news found."}
  ],
  "data": {
    "coverage": {
      "scanned_beats": ["core_update", "seo", "gbp", "ppc", "local_seo", "small_business_seo_industry"],
      "search_queries": [],
      "news_items_considered": 0,
      "ideas_reported": 0,
      "ideas_skipped": 0,
      "lookback_days": "${RADAR_LOOKBACK_DAYS}"
    },
    "skipped": []
  }
}
```

## Step 7 — Digest email

Email the owner a digest of what was **reported for planner review** (or why there were zero ideas).
Do not call reported items approved work.

```bash
node $V2 email send --to owner@example.com \
  --subject "Industry Radar — N planner ideas reported ($(date +%Y-%m-%d))" \
  --body "<bulleted list: topic — beat — why it matters — source url. State that the Daily Planner will decide whether to enqueue.>" \
  --json
```

## Hard limits (do not violate)

- Never create, update, or approve tasks.
- Never set task status.
- Never report more than `RADAR_MAX_IDEAS` opportunities in one run.
- Never report a new-blog opportunity whose cannibalization check returned `refresh_existing_blog`
  (true same-query collision); record it under skipped data instead.
- Never target a homepage-canonical head money term with a new-blog idea.
- Never fabricate news. No real, in-window, sourced development → quiet report.
- Never run safe-fix / semi-safe / high-risk, never deploy, never write the blog yourself.
