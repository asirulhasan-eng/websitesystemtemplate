---
id: intel-task-queue-health
name: "Task Queue Health"
version: 1
type: intelligence_module
description: "Assess the task queue: size, staleness, backlog, stuck tasks, and completion velocity. Report-only."
schedule: "0 1,13 * * *"
trigger:
  schedule: "0 1,13 * * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  every_session: true
guardrails:
  max_duration_minutes: 10
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Task Queue Health

> Every session: is the production line healthy, or is work piling up / getting stuck?

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks.** This module
replaces the old work plan's "system health" + "task cross-reference" steps. Report the
state of the queue so the planner can decide what to promote, defer, or unblock.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

node $V2 task stats --all $DB --json
node $V2 task stats --backlog $DB --json
node $V2 task audit $DB --json
node $V2 task list --status in_progress $DB --json
node $V2 task list --status approved $DB --json

# System health + worker heartbeats
node $V2 monitor-check --json
node $V2 heartbeat status $DB --json
```

## AI Analysis
Read the operational picture:
- **Queue size & mix** â€” how many candidate / approved / in_progress, by lane (ops vs blog).
- **Backlog pressure** â€” is the approved queue larger than the workers can clear before the
  next session (ops ~1 task / 7 min, blog ~1 / 19 min)?
- **Staleness** â€” candidate tasks aging without action; approved tasks not picked up.
- **Stuck / in_progress** â€” tasks `in_progress` far longer than expected, or repeated failures
  in `events` (workers erroring on the same task).
- **Velocity** â€” completed-per-day trend; is throughput keeping up with creation?
- **Duplicates** â€” flag likely duplicate active tasks (planner will dedupe).

Severity:
- `critical` â€” workers stalled (heartbeat stale / repeated executor failures) or a hard backlog.
- `warning` â€” growing backlog, stale approvals, or a stuck task.
- `normal` â€” healthy flow.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of tasks and queue metrics examined>",
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
  --module task-queue-health \
  --session "<morning|evening>" \
  --severity "<normal|warning|critical>" \
  --headline "<e.g. '12 approved / 3 in_progress; 1 ops task stuck 6h'>" \
  --report-json '{
    "threats":[{"type":"stuck_task","keyword":"TSK-...","severity":"warning","recommendation":"Planner: investigate or cancel"}],
    "observations":["Approved backlog: 12 (ops 9 / blog 3)","Throughput 4/day last week"],
    "recommendations":[{"priority":"high","action":"Defer low-value approved tasks; backlog exceeds session capacity","evidence":"9 ops approved vs ~10 ticks/session"}],
    "data":{"by_status":{},"backlog":{},"stuck":[],"duplicates":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
