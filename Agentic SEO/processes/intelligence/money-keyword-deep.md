---
id: intel-money-keyword-deep
name: "Money Keyword Deep Dive"
version: 1
type: intelligence_module
description: "Weekly 90-day trend analysis for money keywords: trajectory, best-ever positions, revenue impact. Report-only."
schedule: "0 1 * * 4"
trigger:
  schedule: "0 1 * * 4"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  weekdays: [4]
  sessions: [morning]
guardrails:
  max_duration_minutes: 15
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Money Keyword Deep Dive

> Thursday morning: zoom out to 90 days on the keywords that actually drive revenue.

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks.** Produce a
long-horizon read of money-keyword trajectory the planner can use for strategic bets.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

node $V2 gsc-fetch --days 90 --min-impressions 5 $DB --json
node $V2 gsc-history --days 90 $DB --json
node $V2 keyword list $DB --json
node $V2 keyword trend --days 90 $DB --json
```

## AI Analysis
For each money keyword, assess the 90-day arc:
- **Trajectory** â€” improving, flat, or eroding over the quarter (not just week-over-week noise).
- **Best-ever position** â€” the ceiling it has reached; how far it currently sits from that ceiling.
- **Stability** â€” is it volatile or holding? Consistent page-1 vs bouncing.
- **Revenue impact** â€” relative commercial value Ã— impression/click trend = where attention pays off.
- **Plateaus** â€” keywords stuck just off a meaningful threshold (e.g. parked at 4â€“6, never breaking top 3).

Recall Brain memory for each (`brain recall --query "<keyword>"`): what's been tried, what worked.

Severity is usually `normal`/`warning`; use `warning` for a money keyword in sustained decline.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of money keyword clusters examined>",
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
  --module money-keyword-deep \
  --session morning \
  --severity "<normal|warning>" \
  --headline "<e.g. '2 money keywords plateaued at #4-6 for 60d; 1 in slow decline'>" \
  --report-json '{
    "opportunities":[{"type":"quick_win","keyword":"...","current_position":5,"business_value":"high","recommendation":"Plateaued 60d at #5; a focused push could break top 3"}],
    "threats":[{"type":"ranking_drop","keyword":"...","severity":"warning","recommendation":"Slow 90d erosion â€” investigate root cause"}],
    "observations":["Best-ever for 'SEO for {{AUDIENCE}}' was #2 (Apr); now #4"],
    "recommendations":[{"priority":"high","action":"Prioritize <keyword> â€” high value, near a threshold","evidence":"90d trajectory + commercial intent"}],
    "data":{"trajectories":[],"plateaus":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
