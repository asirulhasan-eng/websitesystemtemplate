---
id: intel-competitor-watch
name: "Competitor Watch"
version: 1
type: intelligence_module
description: "Weekly SERP landscape scan for competitor movements on money keywords. Light version of competitor-analysis. Report-only."
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

# Competitor Watch

> Monday morning: who's moving on our money keywords? This is the LIGHT weekly scan â€”
> the full competitive teardown lives in `processes/competitor-analysis.md` (standalone,
> creates tasks).

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks** and do NOT do a
full content audit. Flag competitor movements and defensive priorities for the planner.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

node $V2 serp-check --from-tracked $DB --json
node $V2 serp-history --days 30 $DB --json
node $V2 keyword list $DB --json
```

## AI Analysis
Across money keywords, identify:
- **New / rising competitors** â€” domains gaining top-10 presence over the last weeks.
- **Where they out-rank us** â€” money terms where a competitor sits above us and is climbing.
- **Visible content gaps** â€” what those competitor pages appear to cover that ours don't
  (from the SERP title/snippet level; do NOT do a full crawl here).
- **Defensive priorities** â€” which 1â€“3 keywords are most at risk and worth defending first.

Recall Brain memory for prior competitor observations (`brain recall --query "competitor"`).

Severity:
- `warning` â€” a competitor overtook us on a money term or is clearly closing in.
- `normal` â€” landscape stable.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of competitor pages and keywords examined>",
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
  --module competitor-watch \
  --session morning \
  --severity "<normal|warning|critical>" \
  --headline "<e.g. 'New competitor top-3 on 2 money terms; defend pricing page'>" \
  --report-json '{
    "threats":[{"type":"new_competitor","keyword":"{{NICHE}} SEO","current_position":3,"severity":"warning","recommendation":"Defend â€” competitor climbing"}],
    "opportunities":[{"type":"competitive_gap","keyword":"...","business_value":"medium","recommendation":"Competitor covers X; we do not"}],
    "observations":["competitorX.com entered top 10 on 4 tracked terms"],
    "recommendations":[{"priority":"medium","action":"Planner: consider competitor-analysis deep-dive","evidence":"3 money terms now contested"}],
    "data":{"new_competitors":[],"defensive_priorities":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
