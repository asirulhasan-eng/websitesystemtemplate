---
id: intel-internal-linking
name: "Internal Linking Audit"
version: 1
type: intelligence_module
description: "Monthly link-topology analysis: orphans, under-linked service pages, hub opportunities, anchor diversity. Report-only."
schedule: "0 1 1 * *"
trigger:
  schedule: "0 1 1 * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  monthly_day: 1
  sessions: [morning]
guardrails:
  max_duration_minutes: 20
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Internal Linking Audit

> 1st of the month: map the internal link graph and find where link equity is leaking.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks** and do NOT edit
any links. Report topology problems and ranked link opportunities for the planner. The
deeper architecture playbook is `processes/internal-linking-architecture.md`.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"
SITE="--site-root /opt/client-site"

node $V2 site-links $SITE --json
node $V2 site-links --orphans $SITE --json
node $V2 site-pages $SITE --json
node $V2 link-check --internal $SITE --json
```

## AI Analysis
- **Orphans** â€” pages with zero/near-zero internal inlinks (especially money/service pages).
- **Under-linked priority pages** â€” high-value pages with too few internal links pointing to them.
- **Hub opportunities** â€” strong pages that should link out to related service pages to pass equity.
- **Anchor diversity** â€” over-optimized or repetitive anchor text; missing descriptive anchors.
- **Broken internal links** â€” from `link-check`.

Rank by impact (value of the page Ã— severity of the gap). Recall Brain memory for prior
linking decisions (`brain recall --query "internal linking"`).

Severity:
- `warning` â€” a money/service page is orphaned or badly under-linked, or broken internal links exist.
- `normal` â€” minor tidy-ups only.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of pages and links examined>",
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
  --module internal-linking \
  --session morning \
  --severity "<normal|warning>" \
  --headline "<e.g. '2 service pages orphaned; 5 hub-link opportunities'>" \
  --report-json '{
    "opportunities":[{"type":"content_gap","keyword":"/services/<page>","business_value":"high","recommendation":"Add internal links from <hub pages> with descriptive anchors"}],
    "threats":[{"type":"serp_change","keyword":"/services/<page>","severity":"warning","recommendation":"Orphaned money page â€” add inlinks"}],
    "observations":["3 broken internal links found","Anchor text for /pricing is repetitive"],
    "recommendations":[{"priority":"high","action":"Planner: queue internal-linking fixes for orphaned service pages","evidence":"0 inlinks"}],
    "data":{"orphans":[],"under_linked":[],"hub_opportunities":[],"broken_links":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
