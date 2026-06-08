---
id: intel-new-page-opportunities
name: "New Service Page Suggestions"
version: 1
type: intelligence_module
description: "Weekly clustering of emerging GSC queries into potential new service pages, with estimated business value. Report-only."
schedule: "0 1 * * 1"
trigger:
  schedule: "0 1 * * 1"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  weekdays: [1]
  sessions: [morning]
guardrails:
  max_duration_minutes: 15
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# New Service Page Suggestions

> Monday morning: where is demand showing up that we don't yet have a page for?

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks** and do NOT write
any page. Cluster demand and hand the planner ranked new-page candidates.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"
SITE="--site-root /opt/client-site"

node $V2 gsc-fetch --days 28 --min-impressions 8 $DB --json
node $V2 site-pages $SITE --json
node $V2 keyword list $DB --json
```

## AI Analysis
- **Cluster** emerging queries (gaining impressions over 28d) into coherent topics.
- For each cluster, check whether an existing page already serves it well (use `site-pages`).
  Skip clusters already covered; keep clusters with **no good page**.
- If the suggested page type is `supporting blog`, run the existing-blog cannibalization gate before
  surfacing it:
  ```bash
  node $V2 content blog-cannibalization \
    --topic "<working title or angle>" \
    --target-keyword "<cluster head term>" \
    --support-url "<homepage or service page this blog supports>" \
    $SITE --json
  ```
  Skip or convert to a refresh/internal-link recommendation when the gate returns
  `refresh_existing_blog`. Only keep a new supporting-blog opportunity when it returns
  `create_new_blog`, or when `differentiate_or_refresh` has a documented distinct intent split.
- Estimate **business value** per cluster: commercial intent Ã— demand (impressions/trend) Ã—
  fit with the {{NICHE}}-SEO service line.
- Suggest a **page type** (new service page vs supporting blog) and a working title/angle.
- Recall Brain memory (`brain recall --query "<cluster topic>"`) â€” was this proposed/rejected before?

Severity is `normal` (these are opportunities, not threats). Headline = count of strong candidates.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of pages and queries examined>",
    "surfaced_top": "<number of items included in opportunities/threats>",
    "floor_applied": "<description of any min-impression or position filter>",
    "deprioritized_reason": "<why some items were excluded, if any>"
  }
}
```
A thin report with coverage data is distinguishable from an empty market. Never omit this block.

## Report Output
```bash
node $V2 intelligence report \
  --module new-page-opportunities \
  --session morning \
  --severity normal \
  --headline "<e.g. '2 strong new service-page candidates from emerging demand'>" \
  --report-json '{
    "opportunities":[{"type":"emerging","keyword":"<cluster head term>","impressions_7d":120,"business_value":"high","recommendation":"New service page: <title/angle>"}],
    "observations":["Emerging cluster around <topic> has no landing page"],
    "recommendations":[{"priority":"medium","action":"Planner: create new-service-page task for <cluster>","evidence":"28d demand + no existing page"}],
    "data":{"clusters":[{"head":"...","queries":[],"existing_page":null,"page_type":"service","est_value":"high","blog_cannibalization_check":null}]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
