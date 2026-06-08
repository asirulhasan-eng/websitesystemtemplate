---
id: intel-content-gap-quick
name: "Content Gap Quick Scan"
version: 1
type: intelligence_module
description: "Light scan for wrong-page rankings, missing pages, and cannibalization signals. Every 2 days. Report-only."
schedule: "0 1 */2 * *"
trigger:
  schedule: "0 1 */2 * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  interval_hours: 48
guardrails:
  max_duration_minutes: 15
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Content Gap Quick Scan

> Every 2 days: a fast surface scan for content/mapping problems. This is the LIGHT
> version â€” the full investigation lives in `processes/content-gap-analysis.md`
> (standalone, creates tasks). Here you only flag signals for the planner.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks** and do NOT do
full redirect/content planning. Flag candidates; the planner may invoke the deep
content-gap-analysis process if warranted.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"
SITE="--site-root /opt/client-site"

node $V2 gsc-fetch --days 28 --min-impressions 3 --by-page $DB --json
node $V2 site-pages $SITE --json
node $V2 keyword list $DB --json
```

### Additional Data for Page-Fit Analysis
```bash
node $V2 keyword list --intent-tier money --json $DB
node $V2 content inventory --join-keywords --json $DB
node $V2 keyword cluster --from-gsc --days 28 --min-impressions 3 --json $DB
```

## AI Analysis

### Signal Detection (original scope)
Look for three quick signals:
- **Wrong-page rankings** â€” a query ranks via a page that isn't the best fit (e.g. a blog post
  ranking for a commercial term that a service page should own).
- **Missing pages** â€” clusters of impressions with no good landing page at all.
- **Cannibalization** â€” two+ site pages competing for the same query (split signals, neither
  ranks well).

For each, note the query, the URL(s) involved, and the impression volume (impact estimate).
Recall Brain memory before flagging (`brain recall --query "<topic>"`).

### Page-Fit Assessment (WS3 â€” for every money-keyword cluster)

For each money-keyword cluster from the clustering output, assess page fit:

1. **Get the ranking URL(s)** from the cluster data (the `ranking_urls` field)
2. **Get the expected page type** from the keyword registry (`target_page_type` field)
3. **Classify the ranking URL type** using the content inventory:
   - `/services/*` â†’ service page
   - `/blog/*` â†’ blog post
   - `/` or homepage â†’ homepage
   - Other â†’ utility/other
4. **Determine page_fit verdict:**
   - `canonical` â€” the ranking URL IS the expected page type (e.g., commercial keyword â†’ service page) âœ…
   - `wrong_page` â€” a commercial/money keyword ranks through a blog post or homepage, but should have a dedicated service page âš ï¸
   - `missing` â€” no page ranks for this cluster at all, or only ranks via unrelated pages ðŸ”´

**CRITICAL: Remove position bias.** A money cluster ranking via a blog at **ANY** position is a
wrong-page candidate. Weight by `total_impressions Ã— intent_tier`, NOT by position â‰¤ 15.

### Structured Wrong-Page Opportunities

For each `wrong_page` or `missing` verdict, emit a structured opportunity in the report:

```json
{
  "type": "wrong_page",
  "cluster": "seo-audit",
  "head_term": "{{NICHE}} website seo audit service",
  "current_url": "/blog/{{NICHE}}-seo-audit-process",
  "current_page_type": "blog",
  "recommended_url": "/services/seo-audit",
  "recommended_action": "create",
  "total_impressions": 95,
  "weighted_position": 37.2,
  "business_value": "high",
  "page_fit": "wrong_page"
}
```

For `missing` pages:
```json
{
  "type": "missing_page",
  "cluster": "seo-pricing",
  "head_term": "{{NICHE}} seo pricing",
  "current_url": null,
  "recommended_url": "/services/seo-pricing",
  "recommended_action": "create",
  "total_impressions": 45,
  "business_value": "high",
  "page_fit": "missing"
}
```

These structured opportunities feed directly into the `keyword-campaign` process.

Severity is usually `normal`/`warning` (this is a scan, not an emergency). Use `warning` when a
high-value commercial term is mapped to the wrong page or has no page.

## Report Output
```bash
node $V2 intelligence report \
  --module content-gap-quick \
  --session "<morning|evening>" \
  --severity "<normal|warning>" \
  --headline "<e.g. '3 wrong-page rankings; 1 missing service page'>" \
  --report-json '{
    "opportunities":[{
      "type":"wrong_page",
      "cluster":"seo-audit",
      "head_term":"{{NICHE}} website seo audit service",
      "current_url":"/blog/{{NICHE}}-seo-audit-process",
      "current_page_type":"blog",
      "recommended_url":"/services/seo-audit",
      "recommended_action":"create",
      "total_impressions":95,
      "weighted_position":37.2,
      "business_value":"high",
      "page_fit":"wrong_page"
    }],
    "observations":["2 pages cannibalizing 'emergency {{AUDIENCE}} seo'"],
    "recommendations":[{"priority":"high","action":"Planner: trigger keyword-campaign for seo-audit cluster","evidence":"95 impressions, wrong page (blog), commercial intent"}],
    "data":{"wrong_page":[],"missing":[],"cannibalization":[]},
    "coverage":{
      "scanned_count":"<number of clusters examined>",
      "surfaced_top":"<number of opportunities reported>",
      "floor_applied":"min_impressions >= 3",
      "deprioritized_reason":"<why some items were excluded>"
    }
  }' \
  $DB --json
```

