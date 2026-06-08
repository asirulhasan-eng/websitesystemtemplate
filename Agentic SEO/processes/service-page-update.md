---
id: service-page-update
name: "Service Page Update"
version: 1
description: "Optimize an existing service page based on GSC data, SERP analysis, and content quality review. Used when a service page is underperforming or needs content refresh."
trigger:
  schedule: "manual"
  can_run_manually: true
  conditions:
    - "A service page has been identified as needing optimization (via daily scan or manual review)"
guardrails:
  max_risk_level: semi_safe
  require_human_review_for:
    - new_service_page
    - navigation_change
    - redirect_setup
  max_duration_minutes: 45
email_on_complete:
  enabled: false
  on_error_only: true
outputs:
  - name: "Updated service page"
    type: tasks
    description: "Branch with optimized service page content"
---

# Service Page Update Process

> Optimize an existing service page to improve rankings, traffic, and conversions.
> This is a semi-safe operation: changes go to a preview branch first.

## When to Use

- GSC shows a service page dropping in position for its target keywords
- CTR is below expected for the page's position
- A competitor's page is outranking us with better content
- Content audit reveals the page is thin, outdated, or poorly optimized
- A new service offering needs to be reflected on an existing page

---

## Step 1: Gather Current Performance Data

```bash
# Get GSC data for the service page
v2 gsc-fetch --days 28 --url-contains "/services/<page-slug>" --json

# Get historical trend
v2 gsc-history --page "/services/<page-slug>" --days 90 --json

# Compare recent vs historical performance
v2 gsc-compare --from-db --keyword "<target-keyword>" --json
```

### AI Analysis â€” Performance Assessment

Review the data and answer:
1. **Which keywords is this page ranking for?** Are they the right keywords?
2. **Position trend**: Improving, stable, or declining?
3. **CTR**: Is CTR appropriate for the position? Low CTR at good position = title/meta issue.
4. **Impressions**: Growing or shrinking? Growing impressions with stable position = opportunity.

---

## Step 2: Analyze Current Page Content

```bash
# Get page metadata
v2 page-meta --url https://{{DOMAIN}}/services/<page-slug> --json

# Read page content for analysis
v2 page-read --url https://{{DOMAIN}}/services/<page-slug> --keyword-density "<target-keyword>" --json

# Check internal link support
v2 site-links --url /services/<page-slug> --json
```

### AI Analysis â€” Content Quality

Evaluate:
1. **Title tag**: Does it include the primary keyword? Is it compelling for clicks? Is it 50-60 characters?
2. **Meta description**: Does it sell the service? Does it include a call to action? 150-160 characters?
3. **H1**: Clear, keyword-rich, matches search intent?
4. **Content depth**: Is the word count competitive with ranking competitors? (Check in Step 3)
5. **Keyword density**: Natural use of primary and related keywords?
6. **Internal links**: How many pages link TO this page? Are they relevant?
7. **Schema markup**: Is there appropriate Service/LocalBusiness schema?
8. **Images**: Are they optimized with descriptive alt text?

---

## Step 3: Analyze SERP Competition

```bash
# Check what's ranking for our target keywords
v2 serp-check --keywords "<target-keyword>,<secondary-keyword>" --top 10 --include-features --json
```

### AI Analysis â€” Competitive Gap

For each competitor ranking above us:
1. **What type of content are they using?** (Long-form service page? Guide? Comparison?)
2. **What topics do they cover that we don't?**
3. **Do they have better title tags, meta descriptions?**
4. **Are there featured snippets we could target?**
5. **What's their estimated word count vs ours?**

---

## Step 4: Plan the Update

Based on your analysis, decide what changes are needed. Common optimization actions:

### Title & Meta Optimization
- Rewrite title to include primary keyword + compelling hook
- Rewrite meta description with value proposition + CTA

### Content Enhancement
- Add missing subtopics that competitors cover
- Expand thin sections with more detail
- Add FAQ section targeting "People Also Ask" queries
- Update outdated information
- Add internal links to relevant blog posts and other service pages

### Technical SEO
- Add/update structured data (Service schema, FAQ schema)
- Ensure canonical tag is correct
- Add missing image alt text
- Ensure proper heading hierarchy (single H1, logical H2/H3 structure)

### Internal Linking
- Add links from relevant blog posts to this service page
- Add links from related service pages
- Use keyword-rich anchor text

---

## Step 5: Execute the Update

```bash
# Acquire lock on the target page
v2 lock acquire --type file_lock --resource "services/<page-slug>.html" --reason "Service page optimization" --json

# Create a preview branch
v2 deploy branch --site-root /opt/client-site --branch "preview/optimize-<page-slug>" --message "Optimize <page-slug> service page" --json
```

Now make the content changes to the file. The AI should:
1. Edit the HTML file directly based on the optimization plan
2. Keep existing content structure unless it needs significant reorganization
3. Preserve all existing schema markup (update, don't remove)
4. Maintain consistent styling with the rest of the site

```bash
# Push the preview branch
v2 deploy push --site-root /opt/client-site --branch "preview/optimize-<page-slug>" --json

# Wait for Cloudflare preview deployment
v2 deploy wait --branch "preview/optimize-<page-slug>" --timeout-seconds 180 --json
```

---

## Step 6: Verify the Preview

```bash
# Check the preview page metadata
v2 page-meta --file services/<page-slug>.html --site-root /opt/client-site --json
```

### AI Verification Checklist

Before requesting merge:
- [ ] Title tag is present and optimized (50-60 chars, includes primary keyword)
- [ ] Meta description is present and compelling (150-160 chars)
- [ ] Single H1 tag matching page topic
- [ ] Logical heading hierarchy (H2, H3)
- [ ] Word count is competitive with top-ranking pages
- [ ] Primary keyword density is 1-2% (not over-optimized)
- [ ] All images have descriptive alt text
- [ ] Schema markup is present and valid
- [ ] Canonical URL is correct
- [ ] Internal links added/preserved
- [ ] No broken links introduced
- [ ] Content reads naturally (not keyword-stuffed)

---

## Step 7: Record & Release

```bash
# Create a task record for this optimization
v2 task create --title "Service page optimized: <page-slug>" --type service_page_update \
  --status completed --risk-level semi_safe --target-url "https://{{DOMAIN}}/services/<page-slug>" \
  --target-keyword "<target-keyword>" \
  --description "Optimized based on GSC analysis: [summary of changes made]" \
  --evidence '{"position_before": X, "impressions": Y, "changes_made": ["title", "meta", "content", "schema"]}' --json

# Release the lock
v2 lock release --id <lock-id> --json
```

---

## Post-Update Monitoring

After 7-14 days, check if the update had the desired effect:

```bash
v2 gsc-compare --from-db --keyword "<target-keyword>" --current-days 7 --previous-days 7 --json
v2 serp-check --keywords "<target-keyword>" --json
```

If position improved: Success! Document what worked.
If position didn't change: May need more time, or the changes weren't sufficient.
If position dropped: Investigate â€” was there an algorithm update? Did we over-optimize?
