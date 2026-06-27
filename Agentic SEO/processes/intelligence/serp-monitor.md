---
id: intel-serp-monitor
name: "SERP Monitor"
version: 1
type: intelligence_module
description: "Check live SERPs for tracked keywords; detect new competitors, SERP feature changes, and intent shifts. Morning only. Report-only."
schedule: "0 1 * * *"
trigger:
  schedule: "0 1 * * *"
  timezone: Asia/Dhaka
  can_run_manually: true
cadence:
  sessions: [morning]
guardrails:
  max_duration_minutes: 15
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# SERP Monitor

> Morning: look at the actual search results pages, not just our positions.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks.** Describe what
changed in the SERP landscape; the planner reacts.

## Data Gathering
```bash
V2="/opt/website-agent/cli/bin/v2.js"
DB="--db /opt/website-state/website-agent.db"

# Live SERP for tracked keywords + comparison to the last capture
node $V2 serp-check --from-tracked $DB --json
node $V2 serp-compare --days 7 $DB --json
node $V2 serp-history --days 14 $DB --json
```

## AI Analysis
For each tracked keyword's SERP:
- **New competitors** Ã¢â‚¬â€ domains newly appearing in the top 5/top 10 that weren't there before.
- **SERP feature changes** Ã¢â‚¬â€ new/removed featured snippet, People Also Ask, local pack, ads
  density, AI overview Ã¢â‚¬â€ anything that changes how much organic real estate is available.
- **Intent shifts** Ã¢â‚¬â€ is the result set tilting informational vs commercial? Does our page
  type (service vs blog) still match what Google is rewarding?
- **Volatility** Ã¢â‚¬â€ keywords whose top results are reshuffling a lot (unstable SERP).

Recall Brain memory for keywords with notable moves. Severity:
- `critical` Ã¢â‚¬â€ a strong new competitor seized a money-keyword top spot, or a feature change
  buried organic results.
- `warning` Ã¢â‚¬â€ meaningful landscape shift worth the planner's attention.
- `normal` Ã¢â‚¬â€ stable.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of SERP check results examined>",
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
  --module serp-monitor \
  --session morning \
  --severity "<normal|warning|critical>" \
  --headline "<e.g. 'New competitor in top 5 for website SEO; PAA added on 2 terms'>" \
  --report-json '{
    "threats":[{"type":"new_competitor","keyword":"...","current_position":4,"severity":"warning","recommendation":"Assess competitor page vs ours"}],
    "opportunities":[{"type":"competitive_gap","keyword":"...","business_value":"high","recommendation":"Featured-snippet opportunity opened up"}],
    "observations":["Local pack now shows on 3 money terms"],
    "recommendations":[{"priority":"medium","action":"Review SERP intent for <keyword>","evidence":"results shifted informational"}],
    "data":{"keywords_checked":N,"new_competitors":[],"feature_changes":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
