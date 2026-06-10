---
id: weekly-review
name: "Weekly Review"
version: 1
description: "Analyze past week performance and plan next week priorities."
trigger:
  schedule: "0 6 * * 1"
  timezone: "UTC"
---

# Weekly Review

> Analyze the past week's performance, evaluate strategy effectiveness, and plan next week's priorities.
> This is where we step back from daily tactics and ask "are we moving in the right direction?"

## Trigger

- **Schedule:** Every Monday at 06:00 UTC (cron: `0 6 * * 1`)
- **Manual:** Can be triggered on-demand

## Pre-Flight Checks

1. Confirm at least 5 of 7 daily scans completed successfully this week
2. Confirm GSC data is available for the full 7-day window

```bash
v2 heartbeat start --job weekly-review --json

# Check work-plan heartbeats (morning + evening) for the past week
v2 db query --sql "SELECT job, started_at, finished_at FROM heartbeats WHERE job LIKE 'workplan-%' AND started_at > datetime('now', '-7 days') ORDER BY started_at DESC" --json
```

---

## Step 1: Gather the Week's Data

### 1a: GSC Performance Data

```bash
# This week's data
v2 gsc-fetch --days 7 --min-impressions 5 --json

# Last week's data (for comparison)
v2 gsc-fetch --days 14 --min-impressions 5 --json

# Month-to-date trend
v2 gsc-fetch --days 28 --min-impressions 10 --json
```

### 1b: SERP Tracking for Money Keywords

```bash
# Check current positions for all money keywords
v2 serp-check --keywords "{{NICHE}} SEO,SEO for {{AUDIENCE}},{{AUDIENCE}} SEO services,local SEO for {{AUDIENCE}},{{NICHE}} SEO pricing,{{AUDIENCE}} marketing,{{NICHE}} company SEO,{{NICHE}} digital marketing,{{AUDIENCE}} website SEO,{{AUDIENCE}} Google ranking" --domain {{DOMAIN}} --json

# Get historical SERP data
v2 serp-history --keyword "{{NICHE}} SEO" --days 30 --json
v2 serp-history --keyword "SEO for {{AUDIENCE}}" --days 30 --json
v2 serp-history --keyword "local SEO for {{AUDIENCE}}" --days 30 --json
```

### 1c: Task Activity

```bash
# Tasks completed this week
v2 db query --sql "SELECT * FROM tasks WHERE status = 'completed' AND updated_at > datetime('now', '-7 days') ORDER BY updated_at DESC" --json

# Tasks created this week
v2 db query --sql "SELECT * FROM tasks WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC" --json

# Current open task queue
v2 task list --status open --sort priority --json

# In-progress tasks
v2 task list --status in_progress --sort updated --json
```

### 1d: System Health

```bash
v2 db snapshot --json
v2 deploy status --json
```

---

## Step 2: Analyze Performance Trends

### AI Analysis â€” Weekly Performance

#### Key Metrics That Matter for This Business

The metrics below are in order of business importance:

1. **Money Keyword Positions (Most Important)**
   - Track average position for each money keyword
   - Week-over-week change
   - Trend direction (3+ weeks of data)
   
   > For {{SITE_NAME}}.agency, a 1-position improvement on "{{NICHE}} SEO" from position 5 to 4 is worth more than moving "{{AUDIENCE}} marketing tips" from position 20 to position 10.

2. **Clicks from Money Keywords**
   - Total clicks from Bucket 1 keywords
   - Week-over-week change
   - Which keywords are driving the most clicks?

3. **Total Organic Clicks**
   - Overall click trend
   - Are clicks growing even if positions are flat? (could mean more queries ranking)

4. **Impressions (Leading Indicator)**
   - Growing impressions = growing visibility
   - New queries appearing = content is getting indexed and recognized
   - Impressions without clicks = potential CTR problem or ranking too low

5. **Click-Through Rate**
   - Overall CTR trend
   - Per-keyword CTR compared to expected CTR for position
   - Low CTR on high-position keywords = meta title/description needs work

6. **Content Coverage**
   - How many total queries are we appearing for?
   - Is this number growing week-over-week?
   - Are new queries relevant or irrelevant?

#### Build the Weekly Scorecard

| Metric | Last Week | This Week | Change | Trend (4-week) | Status |
|--------|-----------|-----------|--------|----------------|--------|
| "{{NICHE}} SEO" position | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| "SEO for {{AUDIENCE}}" position | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| "local SEO for {{AUDIENCE}}" position | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| "{{NICHE}} SEO pricing" position | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| Total money keyword clicks | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| Total organic clicks | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| Total impressions | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| Average CTR | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |
| Total queries ranking | ? | ? | ? | ? | ðŸŸ¢/ðŸŸ¡/ðŸ”´ |

**Status definitions:**
- ðŸŸ¢ Green: Improving or at target
- ðŸŸ¡ Yellow: Flat or minor decline (within normal variance)
- ðŸ”´ Red: Declining meaningfully or significantly below target

---

## Step 3: Evaluate Task Execution

### AI Analysis â€” Operational Effectiveness

1. **Task Throughput:**
   - How many tasks were completed this week?
   - How does this compare to the weekly average?
   - Is the completion rate keeping pace with creation rate?

2. **Task Quality:**
   - For completed content optimization tasks: did the target keyword improve?
   - For completed content creation tasks: has the new content been indexed?
   - For completed technical fix tasks: has the issue been verified as resolved?

3. **Pipeline Health:**
   - How many tasks are open? Is the backlog growing or shrinking?
   - Are there stale tasks that need attention?
   - Are the right tasks being prioritized?

4. **Completed Task Impact Assessment:**

For each task completed this week, check if the expected outcome materialized:

```bash
# For each completed task, check the keyword's current performance
v2 gsc-fetch --days 7 --min-impressions 3 --json
v2 serp-check --keywords "<completed-task-keyword>" --domain {{DOMAIN}} --json
```

> **Note:** SEO changes typically take 2-4 weeks to show full impact. Don't judge a task completed this week by this week's data alone. But DO check tasks completed 2-4 weeks ago.

```bash
# Check impact of tasks completed 2-4 weeks ago
v2 db query --sql "SELECT * FROM tasks WHERE status = 'completed' AND updated_at BETWEEN datetime('now', '-28 days') AND datetime('now', '-14 days')" --json
```

---

## Step 4: Evaluate Strategy Effectiveness

### AI Analysis â€” Strategic Assessment

Look at the bigger picture:

0. **Are we on track against the Monthly Roadmap?**
   - Recall the current month's roadmap DECISION note: `v2 brain recall --query "monthly roadmap" --markdown` (written by the first-Monday Monthly Roadmap run; see `processes/monthly-roadmap.md`).
   - For each of its focus areas: on track / behind / abandoned — and why.
   - If no roadmap note exists for the current month, flag that in the weekly report (the monthly-roadmap cron may have failed).

1. **Are we working on the right things?**
   - Review the tasks that were completed vs. the tasks that are still open
   - Are money keyword tasks getting priority over nice-to-have tasks?
   - Did any high-priority tasks get stuck while low-priority ones got done?

2. **Is our content strategy working?**
   - Are new blog posts driving traffic?
   - Are service pages improving in rankings?
   - Is our total keyword footprint expanding?
   - Are we building topical authority (more related queries appearing)?

3. **Are there strategic gaps?**
   - Keywords competitors are targeting that we're ignoring
   - Content types we're not producing (videos, tools, calculators)
   - Opportunities we're repeatedly deferring

4. **Seasonality Check:**
   - Is there a seasonal pattern in {{NICHE}} searches?
   - Spring/summer: higher search volume for {{NICHE}} services â†’ higher volume for {{AUDIENCE}} marketing
   - Winter: emergency {{AUDIENCE}} searches increase â†’ content opportunities
   - Are we adjusting our content calendar accordingly?

---

## Step 5: Plan Next Week's Priorities

### AI Analysis â€” Priority Setting

Based on the analysis above, determine the top 3-5 priorities for next week:

#### Priority Categories

**1. Defend & Protect (if needed)**
- Any money keyword showing decline needs attention first
- Any technical issue affecting rankings
- Any ranking emergency still being resolved

**2. Quick Wins (always include 1-2)**
- Tasks with high BIRD scores and low effort
- Keywords in positions 4-10 that can be pushed to page 1
- CTR improvements on high-impression keywords

**3. Strategic Growth (1-2 per week)**
- New content creation for validated opportunities
- Content gap fixes that expand our keyword footprint
- Competitive response tasks

**4. Maintenance (ongoing)**
- Update stale content
- Fix minor technical issues
- Internal linking improvements

### Weekly Priority Document

```bash
v2 task list --status open --sort priority --json
```

For each recommended priority:

```bash
# Update task priority if needed
v2 task update --id <task-id> --priority <new-priority> --note "Weekly review: Promoted to [priority] for next week. Rationale: [reason]." --json
```

---

## Step 6: Generate Weekly Report

### Report Structure

```bash
v2 report format --template weekly-review --data '{
  "week_ending": "2026-06-08",
  "scorecard": {...},
  "tasks_completed": [...],
  "tasks_created": [...],
  "highlights": [...],
  "concerns": [...],
  "next_week_priorities": [...],
  "strategic_notes": "..."
}' --json
```

The weekly report should include:

1. **Executive Summary** (2-3 sentences)
   - Overall direction: improving, stable, or declining?
   - Most important win this week
   - Most important concern

2. **Performance Scorecard** (the table from Step 2)

3. **Task Execution Summary**
   - Completed: list with outcomes
   - Created: list with rationale
   - In progress: status update
   - Cancelled/deferred: list with reasons

4. **Key Insights** (2-3 bullets)
   - What did we learn this week?
   - What surprised us?
   - What should we investigate further?

5. **Next Week's Plan**
   - Top 3-5 priorities, in order
   - Expected outcomes if priorities are executed
   - Any risks or dependencies

6. **Trends to Watch**
   - Metrics that are trending in a concerning direction
   - Competitor movements
   - Industry developments

---

## Post-Flight

```bash
v2 heartbeat finish --job weekly-review --json
```

### Escalation Criteria

Send an email summary if any of these are true:

```bash
v2 email send \
  --to {{ADMIN_EMAIL}} \
  --subject "Weekly SEO Review: [DATE] â€” [STATUS]" \
  --body "[FULL REPORT SUMMARY]" \
  --json
```

**Always send the weekly email.** This is the primary communication channel for ongoing performance.

**Flag as urgent if:**
- Any money keyword dropped â‰¥5 positions week-over-week
- Total organic clicks declined â‰¥20% week-over-week
- No tasks were completed in the past week
- Task queue has grown by >10 items
- A critical task has been open for >7 days without progress

---

## Metrics Reference: What "Good" Looks Like for {{SITE_NAME}}.agency

| Metric | Baseline Target | Stretch Goal |
|--------|----------------|-------------|
| "{{NICHE}} SEO" position | Top 5 | Top 3 |
| "SEO for {{AUDIENCE}}" position | Top 5 | Top 3 |
| "local SEO for {{AUDIENCE}}" position | Top 10 | Top 5 |
| Total money keyword clicks/week | 50+ | 100+ |
| Total organic clicks/week | 200+ | 500+ |
| Total impressions/week | 2,000+ | 5,000+ |
| Average CTR | 3%+ | 5%+ |
| Total queries ranking | 200+ | 500+ |
| Tasks completed/week | 3+ | 5+ |
| Task backlog growth | Net 0 or negative | Negative (shrinking) |
