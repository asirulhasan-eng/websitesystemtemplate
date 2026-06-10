---
id: monthly-roadmap
name: "Monthly Roadmap"
version: 1
description: "Monthly strategic planning process to assess big picture and chart course for next month."
trigger:
  schedule: "0 7 1-7 * *"
  timezone: "UTC"
---

# Monthly Roadmap

> Monthly strategic planning process that zooms out from tactics to assess the big picture.
> This is where we evaluate whether our overall strategy is working and chart the course for the next month.

## Trigger

- **Schedule:** First Monday of each month at 07:00 UTC. The cron entry is
  `0 7 1-7 * *` (daily on days 1-7) and `cron/run-monthly-roadmap.sh` exits unless
  today is a Monday — NOT `0 7 1-7 * 1`, because vixie cron ORs a restricted
  day-of-month with a restricted day-of-week (that line would fire on days 1-7
  AND on every Monday).
- **Manual:** Can be triggered on-demand for mid-month strategic reassessment

## Pre-Flight Checks

1. Confirm at least 3 of 4 weekly reviews were completed in the past month
2. Confirm GSC data is available for the full 28-day window
3. Previous month's roadmap should be reviewed for completion status

```bash
v2 heartbeat start --job monthly-roadmap --json

# Check weekly review heartbeats
v2 db query --sql "SELECT job, started_at, finished_at FROM heartbeats WHERE job = 'weekly-review' AND started_at > datetime('now', '-30 days') ORDER BY started_at DESC" --json
```

---

## Step 1: Gather the Month's Data

### 1a: Comprehensive GSC Data

```bash
# Full month performance
v2 gsc-fetch --days 28 --min-impressions 10 --json

# Previous month (for comparison)
v2 gsc-fetch --days 56 --min-impressions 10 --json

# 90-day trend (quarterly context)
v2 gsc-fetch --days 90 --min-impressions 20 --json
```

### 1b: Full SERP Snapshot

```bash
# All money keywords
v2 serp-check --keywords "{{NICHE}} SEO,SEO for {{AUDIENCE}},{{AUDIENCE}} SEO services,local SEO for {{AUDIENCE}},{{NICHE}} SEO pricing,{{AUDIENCE}} marketing,{{NICHE}} company SEO,{{NICHE}} digital marketing,{{AUDIENCE}} website SEO,{{AUDIENCE}} Google ranking" --domain {{DOMAIN}} --json

# Expansion keywords (medium priority)
v2 serp-check --keywords "{{AUDIENCE}} lead generation,{{AUDIENCE}} reputation management,{{AUDIENCE}} social media,{{NICHE}} company website,{{AUDIENCE}} PPC,{{AUDIENCE}} content marketing,{{AUDIENCE}} email marketing,{{AUDIENCE}} online reviews" --domain {{DOMAIN}} --json

# Long-tail / blog targets
v2 serp-check --keywords "how to get more {{NICHE}} customers,{{AUDIENCE}} marketing ideas,{{NICHE}} business growth,{{AUDIENCE}} advertising,do {{AUDIENCE}} need SEO" --domain {{DOMAIN}} --json
```

### 1c: Historical Trends

```bash
v2 gsc-history --keyword "{{NICHE}} SEO" --days 90 --json
v2 gsc-history --keyword "SEO for {{AUDIENCE}}" --days 90 --json
v2 gsc-history --keyword "local SEO for {{AUDIENCE}}" --days 90 --json
v2 gsc-history --keyword "{{NICHE}} SEO pricing" --days 90 --json
v2 gsc-history --keyword "{{AUDIENCE}} marketing" --days 90 --json
```

### 1d: Task Activity Summary

```bash
# All task activity for the month
v2 db query --sql "SELECT status, COUNT(*) as count FROM tasks WHERE updated_at > datetime('now', '-30 days') GROUP BY status" --json

# Completed tasks with details
v2 db query --sql "SELECT id, title, type, priority, target_keyword, created_at, updated_at FROM tasks WHERE status = 'completed' AND updated_at > datetime('now', '-30 days') ORDER BY updated_at DESC" --json

# Cancelled tasks (to understand what we decided NOT to do)
v2 db query --sql "SELECT id, title, type, priority, target_keyword FROM tasks WHERE status = 'cancelled' AND updated_at > datetime('now', '-30 days') ORDER BY updated_at DESC" --json

# Current backlog
v2 task list --status open --sort priority --json
```

### 1e: Site Inventory

```bash
v2 site-pages --json
v2 db snapshot --json
```

---

## Step 2: Analyze Macro Trends

### AI Analysis â€” Monthly Performance Deep-Dive

#### 2a: Position Trend Analysis

For each money keyword, chart the 90-day trend and categorize:

| Keyword | 90-day Ago | 60-day Ago | 30-day Ago | Now | Trend | Assessment |
|---------|-----------|-----------|-----------|-----|-------|------------|
| {{NICHE}} SEO | ? | ? | ? | ? | â†‘/â†“/â†’ | ? |
| SEO for {{AUDIENCE}} | ? | ? | ? | ? | â†‘/â†“/â†’ | ? |
| local SEO for {{AUDIENCE}} | ? | ? | ? | ? | â†‘/â†“/â†’ | ? |
| {{NICHE}} SEO pricing | ? | ? | ? | ? | â†‘/â†“/â†’ | ? |
| {{AUDIENCE}} marketing | ? | ? | ? | ? | â†‘/â†“/â†’ | ? |

**Trend Assessment Categories:**
- **Strong Growth:** â‰¥5 position improvement over 90 days, consistent upward trend
- **Moderate Growth:** 2-4 position improvement, generally upward
- **Stable:** Â±2 positions, no clear direction
- **Concerning Decline:** 2-4 position decline, needs investigation
- **Critical Decline:** â‰¥5 position decline, strategic intervention needed

#### 2b: Traffic & Visibility Trend

| Metric | 3 Months Ago | 2 Months Ago | Last Month | This Month | Trend |
|--------|-------------|-------------|-----------|-----------|-------|
| Total impressions/month | ? | ? | ? | ? | ? |
| Total clicks/month | ? | ? | ? | ? | ? |
| Money keyword clicks | ? | ? | ? | ? | ? |
| Average CTR | ? | ? | ? | ? | ? |
| Total ranking queries | ? | ? | ? | ? | ? |
| New queries appearing | ? | ? | ? | ? | ? |

#### 2c: Content Portfolio Analysis

Analyze the site's content by type and performance:

| Content Area | Pages | Avg Position | Avg Clicks/Month | Trend | Strategic Value |
|-------------|-------|-------------|-----------------|-------|----------------|
| /services/ pages | ? | ? | ? | ? | High â€” direct conversion |
| /blog/ posts | ? | ? | ? | ? | Medium â€” funnel entry |
| Other pages | ? | ? | ? | ? | ? |

Questions to answer:
- Which service pages are our strongest performers?
- Which service pages are underperforming relative to their importance?
- Which blog posts drive the most traffic? Are they connecting visitors to service pages?
- Are there service pages with zero organic traffic? (potential content quality issues)
- Are there blog posts that outperform service pages for money keywords? (cannibalization risk)

---

## Step 3: Evaluate Content Strategy

### AI Analysis â€” Content Strategy Assessment

#### What content did we publish this month?

List all new pages/posts created and their current performance:

| Content Piece | Published | Target Keyword | Current Position | Impressions | Indexed? |
|--------------|-----------|---------------|-----------------|-------------|----------|
| ? | ? | ? | ? | ? | ? |

#### Content Strategy Effectiveness

1. **Are new content pieces performing as expected?**
   - Blog posts: Should have some impressions within 2-4 weeks
   - Service pages: Should start appearing for target keywords within 1-4 weeks
   - If content is not getting indexed: investigate technical issues

2. **Is our content mix right?**
   - How many service pages vs. blog posts?
   - Are we creating enough bottom-of-funnel content (service pages, pricing, case studies)?
   - Are we creating enough top-of-funnel content (educational blog posts)?
   - Ideal ratio for this business: ~40% service/conversion content, ~50% educational/authority content, ~10% trust signals (case studies, testimonials, about)

3. **Content Gaps Remaining**
   - List keywords with impressions but no dedicated content
   - List competitor content we haven't matched
   - List service areas we offer but don't have pages for

4. **Content Refresh Needs**
   - Pages older than 6 months with declining performance
   - Pages with outdated information
   - Pages that could benefit from expanded content

---

## Step 4: Competitive Landscape Assessment

```bash
# Check competitor presence for money keywords
v2 serp-check --keywords "{{NICHE}} SEO,SEO for {{AUDIENCE}},{{AUDIENCE}} SEO services,local SEO for {{AUDIENCE}}" --domain {{DOMAIN}} --json
```

### AI Analysis â€” Competitive Assessment

1. **Who are our main competitors this month?**
   - List the domains that consistently appear in top 10 for our money keywords
   - Note any NEW competitors that appeared this month
   - Note any competitors that DISAPPEARED (opportunity!)

2. **Competitive Position Summary:**

| Competitor | Keywords Overlapping | They Beat Us On | We Beat Them On | Trend |
|-----------|---------------------|-----------------|-----------------|-------|
| ? | ? | ? | ? | ? |

3. **Competitive Threats:**
   - Is any competitor gaining on us significantly?
   - Has a new strong competitor entered our niche?
   - Are competitors creating content we should match?

4. **Competitive Opportunities:**
   - Keywords where competitors rank but we don't
   - Weaknesses in competitor content we can exploit
   - Untargeted keywords in the niche

---

## Step 5: Plan Next Month's Focus Areas

### AI Analysis â€” Strategic Planning

Based on all the above analysis, define 3-5 focus areas for the next month:

#### Focus Area Selection Framework

Consider these strategic priorities (in order):

1. **Protect existing rankings** â€” If any money keyword is declining, defense comes first
2. **Capture quick wins** â€” Keywords in positions 4-10 that can be pushed to page 1
3. **Fill critical content gaps** â€” Money keywords with no dedicated page
4. **Build authority** â€” Supporting content that strengthens money keyword rankings
5. **Expand footprint** â€” Target new keywords in adjacent spaces

#### Monthly Focus Area Template

For each focus area:

```markdown
## Focus Area [N]: [Title]

**Strategic Goal:** [What we're trying to achieve]
**Key Metrics:** [How we'll measure success]
**Target Keywords:** [Specific keywords to focus on]
**Tasks Required:** [High-level list of tasks needed]
**Dependencies:** [What needs to happen first]
**Risk Level:** [Low/Medium/High]
**Expected Outcome:** [What success looks like at end of month]
```

#### Example Focus Areas for {{SITE_NAME}}.agency

**Example 1: Defend "{{NICHE}} SEO" position**
- Goal: Maintain or improve position from #5 to top 3
- Tasks: Content refresh on service page, build internal links, improve E-E-A-T signals
- Metrics: Position, clicks, CTR for this keyword

**Example 2: Launch Local SEO content hub**
- Goal: Create a comprehensive content hub around local SEO for {{AUDIENCE}}
- Tasks: Create hub page, write 3-4 supporting blog posts, internal linking
- Metrics: Total impressions for "local SEO" keyword cluster

**Example 3: Fix technical debt**
- Goal: Resolve all critical and high-priority technical issues
- Tasks: Page speed improvements, schema fixes, broken link cleanup
- Metrics: Core Web Vitals scores, crawl error count

---

## Step 6: Generate Roadmap Document

### Monthly Roadmap Structure

```bash
v2 report format --template monthly-roadmap --data '{
  "month": "June 2026",
  "performance_summary": {...},
  "content_published": [...],
  "competitive_landscape": {...},
  "focus_areas": [...],
  "tasks_planned": [...],
  "success_metrics": {...},
  "risks": [...]
}' --json
```

### Roadmap Document Contents:

1. **Month in Review** (1 page)
   - Key metrics vs. last month
   - Significant wins
   - Significant concerns
   - Tasks completed vs. planned

2. **Strategic Assessment** (1 page)
   - Content strategy effectiveness
   - Competitive position
   - Market/industry developments

3. **Next Month's Roadmap** (2 pages)
   - Focus areas with detailed plans
   - Week-by-week milestones
   - Resource requirements
   - Success criteria

4. **Risk Register**
   - Known risks and mitigation plans
   - Dependencies on external factors
   - Contingency plans

5. **Key Decisions Needed**
   - Any strategic decisions requiring human input
   - Options presented with pros/cons
   - Recommended course of action

---

## Step 7: Create Tasks for the Month

Based on the roadmap, create or update tasks for each focus area:

```bash
# Example: Create a strategic task for a focus area
v2 task create \
  --title "Monthly Focus: Defend '{{NICHE}} SEO' rankings â€” June 2026" \
  --type content_optimization \
  --priority 800 \
  --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" \
  --target-keyword "{{NICHE}} SEO" \
  --description "Monthly roadmap priority: Maintain and improve '{{NICHE}} SEO' ranking (currently position 5). Plan: (1) Week 1: Content audit and refresh, (2) Week 2: Internal linking improvements, (3) Week 3: E-E-A-T signals enhancement, (4) Week 4: Review and adjust. Success criteria: Reach position 3 or better by month end." \
  --evidence "90-day trend: Position improved from 8 to 5. Momentum is positive but competitors are also improving. Need sustained effort to maintain trajectory." \
  --json
```

```bash
# Example: Create content hub tasks
v2 task create \
  --title "Monthly Focus: Local SEO content hub â€” Hub page creation" \
  --type new_content \
  --priority 800 \
  --risk-level safe \
  --target-keyword "local SEO for {{AUDIENCE}}" \
  --description "Part of June 2026 monthly roadmap. Create comprehensive hub page at /services/local-seo-for-{{AUDIENCE}}/ covering: Google Business Profile optimization, local citation building, review management, local link building, map pack optimization. This page will be the anchor for a cluster of supporting blog posts." \
  --json
```

---

## Post-Flight

```bash
v2 heartbeat finish --job monthly-roadmap --json

# Send the monthly report
v2 email send \
  --to {{ADMIN_EMAIL}} \
  --subject "Monthly SEO Roadmap: [MONTH YEAR]" \
  --body "[FULL ROADMAP SUMMARY â€” include performance scorecard, key insights, focus areas for next month, and any decisions needed]" \
  --json
```

### Review Previous Month's Roadmap

Before finalizing, pull up last month's roadmap and assess:

| Last Month's Focus Area | Status | Outcome |
|------------------------|--------|---------|
| ? | Complete/Partial/Not Started | ? |
| ? | Complete/Partial/Not Started | ? |
| ? | Complete/Partial/Not Started | ? |

- If focus areas consistently go incomplete: we're overplanning. Reduce scope.
- If all focus areas complete easily: we're underplanning. Be more ambitious.
- If the wrong focus areas were chosen (they didn't move key metrics): improve our strategic analysis.

---

## Seasonal Planning for {{NICHE}} SEO

### Understanding the {{NICHE}} Business Cycle

{{NICHE}} company clients have seasonal patterns that affect their marketing appetite:

| Season | {{NICHE}} Business Activity | Our Opportunity |
|--------|---------------------------|-----------------|
| **Spring (Mar-May)** | Busy season starting â€” pipes thawing, outdoor {{NICHE}}, remodels | High demand for SEO. {{AUDIENCE}} realize they need online presence. Best time for sales. |
| **Summer (Jun-Aug)** | Peak season â€” highest call volume, longest days | {{AUDIENCE}} are too busy to think about marketing. Less responsive but seeing ROI. Focus on retention/upsell. |
| **Fall (Sep-Nov)** | Slowing down â€” maintenance season, winterization | {{AUDIENCE}} start planning for next year. Good time for strategy content and long-term SEO. |
| **Winter (Dec-Feb)** | Variable â€” emergency calls (frozen pipes) but lower overall | Budget planning. Some slow periods where {{AUDIENCE}} reconsider their marketing. Good time for case studies showing ROI. |

### Content Calendar Alignment

Plan blog content that aligns with what {{NICHE}} business owners are thinking about:
- **Spring:** "How to get more {{NICHE}} leads before busy season"
- **Summer:** "{{AUDIENCE}} marketing ROI: what to expect after 6 months of SEO"
- **Fall:** "Planning your {{NICHE}} company's marketing budget for next year"
- **Winter:** "Why slow season is the perfect time to invest in {{NICHE}} SEO"
