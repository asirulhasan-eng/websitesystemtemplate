---
id: keyword-campaign
name: Money Keyword Campaign
version: 1
type: process
trigger: manual | planner
---

# Money Keyword Campaign

## Purpose
Turn a high-value money keyword/cluster gap into a multi-step campaign. This is the bridge between "we identified a money keyword opportunity" and "we have a page ranking for it." The campaign persists across weeks while the planner enqueues child tasks per session.

## When to Trigger
- A `wrong_page` or `missing_page` opportunity from content-gap-quick
- A money keyword cluster with no dedicated service page
- Planner identifies a Bucket-1 keyword without adequate page coverage
- Manual request from the site owner

## Input
The process receives either:
- A cluster name + opportunity data from content-gap-quick
- A keyword + target URL from the planner

## Step 1: Assess the Opportunity

### Load Data
```bash
v2 keyword list --cluster "<cluster_name>" --json --db $DB
v2 keyword cluster --from-gsc --days 28 --json --db $DB
v2 content inventory --join-keywords --join-gsc --json --db $DB
v2 gsc-fetch --days 90 --query-contains "<head_term>" --json --db $DB
```

### Evaluate
- What pages currently rank for this cluster? (wrong page? no page?)
- What position are we at? (deep = more work needed)
- What's the impression volume? (validates business value)
- Does a service page already exist that could be upgraded?
- What do the top-10 SERP results look like?

```bash
v2 serp-check --keywords "<head_term>" --include-features --json --db $DB
```

## Step 2: Decide â€” Create vs Upgrade

### Create New Page (decision: `create_page`)
Choose this when:
- No existing service page covers this intent
- Current ranking is through a blog post or homepage
- SERP top-10 is dominated by dedicated service/landing pages
- The keyword cluster is a distinct service offering

### Upgrade Existing Page (decision: `upgrade_page`)
Choose this when:
- A service page exists but is thin, outdated, or poorly optimized
- The page ranks but at deep position (could improve with content enhancement)
- Adding sections/content to the existing page would serve the intent better than a new page

## Step 3: Generate Content Brief

Analyze the SERP top-10 results to determine:
- **Angle**: What unique value can {{DOMAIN}} offer?
- **Sections**: What H2/H3 topics do top-ranking pages cover?
- **Word count target**: Based on top-10 average (minimum 800 for service, 1200 for blog)
- **Internal links IN**: Which existing pages should link TO this new page? (high-authority service pages, related blog posts)
- **Internal links OUT**: Which existing pages should this new page link TO? (related services, case studies, blog posts)
- **Schema type**: Service, FAQ, HowTo, or Article
- **CTA**: What conversion action should the page drive?

## Step 4: Create the Campaign

```bash
v2 campaign create \
  --cluster "<cluster_name>" \
  --keyword "<head_term>" \
  --decision "<create_page|upgrade_page>" \
  --target-url "<recommended_url>" \
  --brief '<content_brief_json>' \
  --success-metric "position<=10 within 30d" \
  --priority high \
  --status active \
  --db $DB
```

## Step 5: Create First Child Task

For `create_page`:
```bash
v2 task create \
  --title "Create service page: <head_term>" \
  --description "<detailed brief from Step 3>" \
  --risk-level semi_safe \
  --target-url "<target_url>" \
  --target-keyword "<head_term>" \
  --priority 900 \
  --source "keyword-campaign" \
  --metadata '{"campaign_id": "<campaign_id>", "task_type": "new_service_page", "campaign_step": 1}' \
  --db $DB
```

For `upgrade_page`:
```bash
v2 task create \
  --title "Optimize service page: <head_term>" \
  --description "<detailed brief from Step 3>" \
  --risk-level safe \
  --target-url "<target_url>" \
  --target-keyword "<head_term>" \
  --priority 850 \
  --source "keyword-campaign" \
  --metadata '{"campaign_id": "<campaign_id>", "task_type": "content_optimization", "campaign_step": 1}' \
  --db $DB
```

## Step 6: Plan Follow-Up Tasks

Document these as the campaign's child task roadmap (the planner will enqueue them in subsequent sessions):

1. **Internal link wiring** (Step 2, after page is live):
   - Add 2-3 contextual links from existing high-authority pages to the new page
   - Add links from the new page to related services
   - Task type: `internal_link_add` (safe, auto-approved)

2. **Sitemap verification** (Step 3, 24h after deploy):
   - Verify the new page appears in sitemap.xml
   - Task type: `sitemap_update` (semi_safe)

3. **Index inspection** (Step 4, 48h after deploy):
   - Run `v2 index-inspect --url <target_url>` to verify Google has discovered the page
   - If not indexed, submit via GSC URL Inspection API
   - Task type: monitor task

4. **SERP tracking enrollment** (Step 5, immediate):
   - Ensure the head term is tracked: `v2 keyword track --update "<head_term>" --status ranking --target-url "<url>"`
   - The serp-monitor intelligence module will automatically track it going forward

5. **Performance review** (Step 6, 2 weeks after deploy):
   - Check position via `v2 gsc-fetch --days 14 --query-contains "<head_term>"`
   - If position improved â†’ campaign success metric check
   - If no improvement â†’ evaluate content quality, backlink opportunities

## Guardrails
- `new_page_create` is `semi_safe` â€” auto-approved per guardrails.json
- `content_optimization` is `safe` â€” auto-approved
- `internal_link_add` is `safe` â€” auto-approved
- Campaign child tasks use existing risk classification. No new risk categories.
- All page creation goes through preview branch + validation before production deploy.

## Success Criteria
- Campaign is marked `completed` when:
  - Target page exists and is indexed
  - Head term ranks in position â‰¤ success_metric threshold
  - OR 60 days have passed (mark as `paused` for review)
