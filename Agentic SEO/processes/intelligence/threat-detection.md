---
id: intel-threat-detection
name: "Threat Detection"
version: 1
type: intelligence_module
description: "Compare 7d vs previous 7d for money keywords; flag drops >=3 positions and classify severity. Report-only."
schedule: "0 1,13 * * *"
trigger:
  schedule: "0 1,13 * * *"
  timezone: Asia/Dhaka
  can_run_manually: true
cadence:
  every_session: true
guardrails:
  max_duration_minutes: 12
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Threat Detection

> Every session: catch money-keyword ranking drops early, before they cost revenue.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks.** Flag threats;
the planner decides whether to spin up a `ranking-emergency` or a fix task.

## Data Gathering
```bash
V2="/opt/website-agent/cli/bin/v2.js"
DB="--db /opt/website-state/website-agent.db"

# This week vs last week
node $V2 gsc-compare --current-days 7 --previous-days 7 $DB --json

# Money keywords + their recent trend
node $V2 keyword list $DB --json
node $V2 keyword trend --days 28 $DB --json
```

## AI Analysis
For every **money/tracked** keyword, compute the position delta (current 7d avg Ã¢Ë†â€™ previous 7d avg):
- **drop Ã¢â€°Â¥ 3 positions** Ã¢â€ â€™ a threat. Classify severity:
  - `critical` Ã¢â‚¬â€ fell from page 1 (Ã¢â€°Â¤10) to page 2+ (>10), or clicks dropped Ã¢â€°Â¥50%.
  - `warning` Ã¢â‚¬â€ dropped Ã¢â€°Â¥3 positions but still on page 1.
- Cross-check whether multiple keywords on the **same page** dropped together (suggests a
  page-level or algorithmic cause rather than a single-keyword fluctuation).
- Recall Brain memory for each flagged keyword (`brain recall --query "<keyword>"`): was a
  recent change made to its page? Is this a known volatile term?

Set the report severity to the worst single threat. If nothing dropped Ã¢â€°Â¥3, severity `normal`
and headline "No money-keyword threats this session."

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of keywords and rankings examined>",
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
  --module threat-detection \
  --session "<morning|evening>" \
  --severity "<normal|warning|critical>" \
  --headline "<e.g. '1 critical drop: SEO for small business owners 3.1 -> 8.4'>" \
  --report-json '{
    "threats":[{"type":"ranking_drop","keyword":"...","current_position":8.4,"previous_position":3.1,"severity":"critical","recommendation":"Investigate immediately Ã¢â‚¬â€ possible page change or SERP shift"}],
    "observations":["3 money keywords on /services dropped together Ã¢â‚¬â€ likely page-level"],
    "recommendations":[{"priority":"high","action":"Open ranking-emergency for <keyword>","evidence":"clicks -73% WoW"}],
    "data":{"checked_keywords":N,"drops":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
