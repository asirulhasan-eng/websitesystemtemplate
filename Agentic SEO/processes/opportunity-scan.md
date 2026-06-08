---
id: opportunity-scan
name: "Deep Opportunity Scan"
version: 2
schedule: "0 14 */2 * *"
description: "Comprehensive GSC + SERP deep scan that runs every 2 days. More thorough than the daily workplan's quick scan â€” includes 28-day trend analysis, content gap detection, and competitive SERP review."
trigger:
  schedule: "0 14 */2 * *"
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
guardrails:
  max_tasks_created: 15
  max_risk_level: semi_safe
  require_human_review_for:
    - new_service_page
    - redirect_setup
  max_duration_minutes: 60
email_on_complete:
  enabled: true
  to: "{{ADMIN_EMAIL}}"
  include_summary: true
  include_decisions: true
---

# Deep Opportunity Scan

> A thorough bi-daily scan that goes deeper than the daily workplan.
> Analyzes 28-day trends, runs competitive SERP checks, detects content gaps, and identifies emerging opportunities.

## Step 1: System Check

```bash
v2 heartbeat start --job opportunity-scan --json
v2 monitor-check --heartbeats --locks --json
```

---

## Step 2: Gather Comprehensive GSC Data

```bash
# Fresh 28-day window (the workhorse dataset)
v2 gsc-fetch --days 28 --min-impressions 5 --json

# Also pull 7-day for trend comparison
v2 gsc-fetch --days 7 --min-impressions 3 --snapshot-tag "deep-scan-7d" --json

# Pull 90-day for long-term trend (lower threshold to catch emerging queries)
v2 gsc-history --days 90 --group-by keyword --aggregate avg --json

# Compare this week vs last week
v2 gsc-compare --current-days 7 --previous-days 7 --only-changes --threshold 1 --json

# Compare this month vs last month
v2 gsc-compare --current-days 28 --previous-days 28 --min-impressions 10 --json
```

---

## Step 3: Deep Analysis (AI Judgment)

### 3a: Emerging Keywords
Scan the GSC data for keywords that are **new or rapidly growing**:
- Keywords that didn't appear in 90-day history but now have 10+ impressions
- Keywords with impression growth > 50% week-over-week
- Keywords where position improved > 3 spots in 7 days

These are signals of growing search demand or content starting to rank. Act on them before competitors do.

> **Validate the spike before acting on it (impressions â‰  demand).**
> A GSC impression surge is not automatically real demand. It can be bot/crawler activity, Google
> testing a page against high-volume irrelevant queries (impressions with ~zero clicks), or a
> seasonal blip. Creating a task off a false spike wastes a content/optimization cycle. Classify
> every spike before it becomes a task:
>
> | Classification | Signals | Action |
> |---|---|---|
> | **True demand** | Relevant buyer/authority query, growth persists across **two** comparable windows (e.g. 7d and 14d), some clicks or improving position, SERP intent matches a page type we have/want | Create/update a task |
> | **Google testing** | Short-lived spike, ~0% CTR across all exposures, unstable/irrelevant landing page, query unrelated to our business | Log, do **not** create a task |
> | **Seasonal** | Recurring calendar/industry pattern, matches prior-year shape | Note for the monthly roadmap; act only if it recurs |
> | **Noise** | Low absolute impressions, mismatched intent, no persistence | Ignore |
>
> Rule of thumb: require persistence across **two** windows and a plausible intent match before a
> spike earns a task. A single-window surge with zero clicks is a hypothesis, not a trend.

### 3b: Declining Keywords
Identify keywords losing ground:
- Position worsened by > 2 spots in the last 14 days
- Impressions dropped > 20% month-over-month
- CTR declining while position is stable (might indicate SERP feature changes)

### 3c: Money Keyword Deep Dive
For each identified money keyword, analyze:

```bash
v2 keyword-trend --keyword "<money-keyword>" --days 90 --source both --json
```

Consider:
- Is this keyword trending up or down overall?
- What's the best position we've ever achieved?
- Are we trending back toward our best, or away from it?
- What content changes coincided with position changes?

### 3d: Content Gap Detection
Cross-reference GSC queries against site pages:

```bash
v2 site-pages --type service --json
v2 site-pages --type blog --json
v2 gsc-fetch --days 28 --min-impressions 20 --sort position --json
```

Look for:
- Queries with significant impressions but no dedicated page
- Queries ranking on the wrong page (blog ranking for commercial query)
- Service-related queries with no service page coverage
- Clusters of related queries that could be targeted by a single new page

### 3e: Internal Link Opportunities

```bash
v2 site-links --orphans --json
v2 site-links --least-linked --limit 10 --json
```

Identify **candidates** (a low link count is a starting point, not a reason to link):
- Service pages with < 3 incoming internal links
- Recently published content that hasn't been linked from relevant pages
- Blog posts that should link to service pages but don't

> **Gate every candidate on semantic relevance â€” do not link by count alone.**
> Inserting links just because a page has fewer than 3 incoming links dilutes page authority and
> can blur topical signals. A link must connect two pages that are genuinely about related topics
> and must help the reader. Before creating an internal-link task, confirm contextual overlap
> between source and destination:
>
> ```bash
> # Score topical overlap between the proposed source and destination pages
> v2 semantic-match --source-url "<source>" --target-url "<target>" --json
> ```
> Use the `score`, `recommendation`, and `shared_terms` fields as evidence, then still confirm with
> a reader-first review: does the source page's topic naturally lead a reader to the destination?
>
> Only create an internal-link task when **all** of these hold:
> - Source and destination share meaningful topical overlap.
> - The link is a natural next step for the reader.
> - The anchor can be contextual and varied (not forced exact-match â€” see `content-gap-analysis.md`
>   and `internal-linking-architecture.md`).
>
> Defer detailed link architecture work (orphans, anchor variation, hub structure) to
> `internal-linking-architecture.md`; this scan only surfaces and validates candidates.

---

## Step 4: Comprehensive SERP Check

```bash
# Check all tracked keywords
v2 serp-check --from-tracked --include-features --include-paa --json

# Check any newly identified opportunities from Step 3
v2 serp-check --keywords "<new-opportunity-keywords>" --top 20 --json

# Historical comparison
v2 serp-compare --all-tracked --days-ago 14 --json
```

### AI Analysis â€” SERP Landscape

For each keyword cluster:
1. **Featured snippets**: Can we capture any? What format do they use?
2. **People Also Ask**: What questions are being asked? Do we answer them?
3. **New competitors**: Has anyone new entered the top 10?
4. **SERP intent**: Has the type of content ranking changed? (e.g., from service pages to guides)

---

## Step 5: Create/Update Tasks

Based on the deep analysis:

```bash
# High-priority opportunities
v2 task create --title "<Opportunity>" --type <type> --priority <800-1000> \
  --risk-level <level> --target-keyword "<kw>" --description "<rationale>" \
  --evidence '<json-data>' --json

# Check for duplicates before creating
v2 task search --query "<keyword>" --status candidate,active --json

# Update existing tasks with fresh data
v2 task update --id <task-id> --note "Deep scan $(date +%Y-%m-%d): <new data point>" --json
```

---

## Step 6: Generate Deep Scan Report

```bash
v2 report format --template custom --data '{
  "report_type": "deep_opportunity_scan",
  "date": "YYYY-MM-DD",
  "gsc_queries_analyzed": N,
  "emerging_keywords": [...],
  "declining_keywords": [...],
  "content_gaps_found": N,
  "serp_changes": [...],
  "tasks_created": N,
  "tasks_updated": N,
  "key_insights": [...]
}' --json
```

---

## Step 7: Finish

```bash
v2 heartbeat finish --job opportunity-scan --json

# Send summary email
v2 email send --to {{ADMIN_EMAIL}} \
  --subject "ðŸ” Deep Scan Report â€” $(date +%Y-%m-%d)" \
  --body "<AI-generated summary of findings, actions taken, and recommendations>" \
  --json
```
