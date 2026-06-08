---
id: intel-gsc-performance
name: "GSC Performance Snapshot"
version: 1
type: intelligence_module
description: "Fetch GSC data (7d + 28d), categorize keywords into buckets, and surface position/impression/CTR trends + top movers. Report-only."
schedule: "0 1,13 * * *"
trigger:
  schedule: "0 1,13 * * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  every_session: true
guardrails:
  max_duration_minutes: 15
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# GSC Performance Snapshot

> Every session: take a fresh read of Search Console and tell the planner what moved.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks.** Gather
data, analyze with judgment, and save ONE report. The daily planner decides what to
do with your findings.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

# Last 7 days vs the trailing 28-day baseline
node $V2 gsc-fetch --days 7  --min-impressions 5 $DB --json
node $V2 gsc-fetch --days 28 --min-impressions 5 $DB --json
node $V2 gsc-compare --current-days 7 --previous-days 7 $DB --json

# Known money/tracked keywords for context
node $V2 keyword list $DB --json
```

## AI Analysis
Categorize each meaningful query into a bucket and read the trend:
- **Money keywords** (tracked, high commercial intent) â€” position, impressions, CTR vs 28d.
- **Quick wins** â€” positions 4â€“15 with rising impressions (one optimization could lift them).
- **Emerging** â€” new queries gaining impressions that the site is not yet targeting well.
- **Declining** â€” losing impressions or position week-over-week.

Identify the **top movers** (biggest position/impression swings, up and down). Compute the
overall direction: total impressions and average CTR vs the prior period. Recall any prior
Brain memory for keywords you're about to flag so you don't repeat a known dead-end:
`node $V2 brain recall --query "<keyword>" --markdown`.

Pick a severity:
- `critical` â€” a money keyword fell off page 1, or total impressions dropped sharply.
- `warning` â€” notable money-keyword slippage or a clear negative trend.
- `normal` â€” stable or improving.

> Surface ranking DROPS lightly here (one line); deep drop triage is `threat-detection`'s job.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of queries and pages examined>",
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
  --module gsc-performance \
  --session "<morning|evening>" \
  --severity "<normal|warning|critical>" \
  --headline "<one line: e.g. '2 money keywords up, impressions +12% WoW'>" \
  --report-json '{
    "opportunities":[{"type":"quick_win","keyword":"...","current_position":7.2,"previous_position":8.5,"impressions_7d":340,"business_value":"high","recommendation":"..."}],
    "threats":[{"type":"ranking_drop","keyword":"...","current_position":8.4,"previous_position":3.1,"severity":"warning","recommendation":"flag to threat-detection"}],
    "observations":["Total impressions +12% WoW","CTR stable at 4.2%"],
    "recommendations":[{"priority":"medium","action":"...","evidence":"GSC 28d X -> 7d Y"}],
    "data":{"buckets":{"money":[],"quick_win":[],"emerging":[],"declining":[]},"top_movers":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
