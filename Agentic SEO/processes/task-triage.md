---
id: task-triage
name: "Task Triage"
version: 1
description: "Review, prioritize, and manage the task queue."
trigger:
  schedule: "30 3 * * *"
  timezone: "UTC"
---

# Task Triage

> Review, prioritize, and manage the task queue to ensure the most impactful work gets done first.
> This is the brain's project management function â€” it decides what to work on and in what order.

## Trigger

- **Automatic:** After every Daily Opportunity Scan completes (if new tasks were created)
- **Scheduled:** Daily at 03:30 UTC (runs after the daily scan at 02:17 UTC)
- **Manual:** On-demand when the task queue needs rebalancing

## Pre-Flight Checks

1. Confirm the daily scan has completed (check heartbeat)
2. No other triage session is running

```bash
v2 heartbeat start --job task-triage --json
```

---

## Step 1: Load the Current Task Queue

```bash
# All open tasks, sorted by priority
v2 task list --status open --sort priority --json

# In-progress tasks
v2 task list --status in_progress --sort updated --json

# Recently completed (context for what's been done)
v2 task list --status completed --sort updated --json

# Full database snapshot for counts and overview
v2 db snapshot --json
```

### Build the Task Inventory

Create a mental model of the queue:

| Category | Count | Notes |
|----------|-------|-------|
| Critical priority | ? | Should be 0-2 at any time |
| High priority | ? | Should be 3-7 at any time |
| Medium priority | ? | Can grow larger, but review if >15 |
| Low priority | ? | Backlog â€” review monthly |
| In-progress | ? | Should be 1-3 at any time (bandwidth limited) |
| Stale (no update >7 days) | ? | Needs attention |
| Total open | ? | If >25, queue is overloaded |

---

## Step 2: Review Each Task

For every open task, evaluate using the **BIRD framework**:

### B â€” Business Impact

| Score | Criteria |
|-------|----------|
| 5 | Directly affects a money keyword in positions 1-10. Revenue impact is immediate. |
| 4 | Affects a money keyword in positions 11-20, or a high-value supporting keyword. |
| 3 | Supports money keywords indirectly (content authority, internal linking). |
| 2 | Improves site quality but limited direct revenue impact. |
| 1 | Nice to have. Cosmetic or very long-tail. |

### I â€” Implementation Effort

| Score | Criteria |
|-------|----------|
| 1 | Quick fix: meta tag change, internal link addition, minor content tweak. <30 min. |
| 2 | Moderate: content section rewrite, schema markup addition. 1-2 hours. |
| 3 | Significant: full page optimization, content expansion. 2-4 hours. |
| 4 | Major: new page creation, content strategy change. 4-8 hours. |
| 5 | Massive: site restructure, major technical change, multi-page project. 1+ days. |

### R â€” Risk Level

| Score | Criteria |
|-------|----------|
| 1 | No risk: adding content, new internal links, new pages. |
| 2 | Low risk: minor changes to existing ranking pages. |
| 3 | Medium risk: significant changes to pages ranking on page 1. |
| 4 | High risk: URL changes, redirects, major restructuring of ranking content. |
| 5 | Critical risk: changes to the site's primary money pages. Requires human approval. |

### D â€” Dependencies & Blockers

| Score | Criteria |
|-------|----------|
| 1 | No dependencies. Can start immediately. |
| 2 | Depends on data that's already available. Minor prep needed. |
| 3 | Depends on another task completing first. |
| 4 | Depends on external factor (e.g., client approval, API access). |
| 5 | Blocked â€” cannot proceed until blocker is resolved. |

### BIRD Composite Score

**Priority Score = (Business Ã— 0.40) + ((6 - Effort) Ã— 0.25) + ((6 - Risk) Ã— 0.20) + ((6 - Dependencies) Ã— 0.15)**

This produces a score from 1 to 5. Higher = do first.

---

## Step 3: Categorize Each Task

Based on the BIRD score and current context, place each task into one of these categories:

### Category 1: Execute Now (Queue for immediate processing)

**Criteria:**
- BIRD score â‰¥ 3.8
- OR: Critical priority tasks regardless of score
- OR: Quick wins (Business â‰¥ 3, Effort = 1, Risk â‰¤ 2, Dependencies = 1)

**Action:** Update task to `in_progress` if bandwidth allows (max 3 concurrent tasks), or keep at top of queue.

```bash
v2 task update --id <task-id> --priority 900 --note "Triage: Execute now. BIRD score 4.2. Quick win on money keyword." --json
```

### Category 2: Needs More Data

**Criteria:**
- The task was created with incomplete information
- Can't assess Business Impact accurately without more data
- SERP context is missing or outdated (>7 days old)

**Action:** Add a note describing what data is needed, keep task open but don't promote to in-progress.

```bash
v2 task update --id <task-id> --note "Triage: Needs fresh SERP data and competitor analysis before proceeding. Current data is 10 days old." --json
```

Then gather the needed data:

```bash
v2 serp-check --keywords "<relevant-keyword>" --domain {{DOMAIN}} --json
v2 gsc-fetch --days 7 --min-impressions 3 --json
```

### Category 3: Defer

**Criteria:**
- BIRD score < 2.5
- Low business impact and not time-sensitive
- Queue is overloaded and this isn't competitive
- Dependencies that won't resolve soon

**Action:** Lower priority and add a defer note with a review date.

```bash
v2 task update --id <task-id> --priority 200 --note "Triage: Deferred. Low business impact (score 2.1). Will review in 14 days. If keyword impressions grow, reconsider." --json
```

### Category 4: Cancel

**Criteria:**
- Task is no longer relevant (keyword dropped to zero impressions, page was already updated by another task)
- Duplicate of another task
- The opportunity no longer exists (competitor took it, SERP changed dramatically)
- Task has been open for >30 days with no progress and is no longer timely

**Action:** Close the task with explanation.

```bash
v2 task update --id <task-id> --status cancelled --note "Triage: Cancelled. Keyword '{{AUDIENCE}} SEO tips' has dropped to <5 impressions/week. Original opportunity no longer exists. Created task #45 for the replacement keyword '{{AUDIENCE}} SEO strategy' instead." --json
```

---

## Step 4: Handle Staleness

Any task that hasn't been updated in >7 days needs attention.

```bash
# Find stale tasks
v2 db query --sql "SELECT id, title, priority, status, updated_at FROM tasks WHERE status IN ('open', 'in_progress') AND updated_at < datetime('now', '-7 days') ORDER BY priority DESC" --json
```

### AI Analysis â€” Stale Task Review

For each stale task:

1. **Is it stuck?** Check if there's a lock or dependency preventing progress.
2. **Is it still relevant?** Re-check the underlying data (GSC position, impressions) to see if the opportunity is still valid.
3. **Was it forgotten?** Some tasks fall through the cracks. If still valid, bump the priority and add a note.

```bash
# Check if the opportunity is still valid
v2 gsc-fetch --days 7 --min-impressions 3 --json
v2 gsc-history --keyword "<task-keyword>" --days 30 --json
```

**If still valid and not blocked:**
```bash
v2 task update --id <task-id> --note "Triage: Stale for 10 days. Opportunity still valid â€” keyword at position 8 with 150 imp/week. Bumping priority for next execution cycle." --json
```

**If no longer valid:**
```bash
v2 task update --id <task-id> --status cancelled --note "Triage: Stale for 15 days. Re-checked data â€” keyword has dropped to position 35 with 8 imp/week. Opportunity no longer viable." --json
```

---

## Step 5: Balance the Queue

After categorizing, verify the queue is healthy:

### Queue Health Rules

| Rule | Threshold | Action if Violated |
|------|-----------|-------------------|
| In-progress tasks | Max 3 | Don't start new work until something completes |
| Critical priority tasks | Max 2 | If >2 critical, something is wrong â€” are we over-reacting? |
| Total open tasks | Max 25 | Start aggressively deferring/cancelling low-value tasks |
| New tasks per day | Avg 2-4 | If consistently >5/day, daily scan thresholds are too loose |
| Task completion rate | â‰¥1/day avg | If not completing tasks, investigate bottleneck |

### Priority Collision Resolution

When multiple tasks have similar BIRD scores, use these tiebreakers:

1. **Money keyword > supporting keyword** â€” Always prioritize direct revenue keywords
2. **Defense > offense** â€” Protecting a position 3 ranking is more urgent than trying to move from position 8 to position 5
3. **Quick win > long project** â€” If two tasks have similar impact, do the faster one first
4. **Trending up > stable** â€” Help the keyword that's already gaining momentum
5. **Service page > blog post** â€” Service pages convert directly; blog posts are supporting
6. **Existing content fix > new content** â€” Fixing existing content is less risky and often faster

---

## Step 6: Generate Triage Report

### AI Analysis â€” Compose Triage Summary

```bash
v2 report format --template task-triage --data '{"date":"2026-06-03","total_open":18,"execute_now":3,"needs_data":2,"deferred":4,"cancelled":1,"stale_resolved":2,"top_3_next":[...]}' --json
```

Summary should include:

1. **Queue Status:** Total open, by priority breakdown
2. **Actions Taken:** Tasks promoted, deferred, cancelled, updated
3. **Next 3 Tasks to Execute:** In recommended order with rationale
4. **Concerns:** Any systemic issues (too many tasks, too many stale items, etc.)

---

## Post-Flight

```bash
v2 heartbeat finish --job task-triage --json
```

### Escalation Triggers

Send an email alert if:
- More than 5 critical/high priority tasks are open simultaneously
- A money keyword task has been stale for >14 days
- The queue has grown by >10 tasks in a single week

```bash
v2 email send \
  --to {{ADMIN_EMAIL}} \
  --subject "Task Queue Alert: [REASON]" \
  --body "The task triage process has flagged a concern: [DETAILS]. Current queue: [COUNT] open tasks, [CRITICAL_COUNT] critical. Please review." \
  --json
```

---

## Decision Quick-Reference

| Situation | Decision |
|-----------|----------|
| Money keyword dropping + easy fix | Execute NOW, highest priority |
| Money keyword opportunity + hard fix | Execute soon, but plan carefully |
| Supporting keyword + easy fix | Execute when bandwidth allows |
| Supporting keyword + hard fix | Defer unless it supports an active money keyword strategy |
| Technical issue affecting rankings | Execute NOW if affecting money pages |
| New blog post idea | Queue at medium priority unless it fills a critical content gap |
| Old task never started | Cancel if >30 days old and data has changed |
| Duplicate tasks | Keep the one with more context, cancel the other |
| Dependencies between tasks | Execute dependencies first, even if lower individual priority |
