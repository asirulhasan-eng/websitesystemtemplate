---
id: content-gap-analysis
name: "Content Gap Analysis"
version: 2
schedule: "event:content_gap"
description: "Identify and resolve wrong-page rankings, missing pages, and cannibalization. Diagnoses the real cause (including search-intent shifts), plans an evidence-backed fix, and handles redirect cleanup safely."
trigger:
  schedule: "event:content_gap"
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
  conditions:
    - "GSC data fetched within the last 24 hours"
    - "Site page inventory is current"
guardrails:
  max_tasks_created: 10
  max_risk_level: semi_safe
  require_human_review_for:
    - new_service_page
    - redirect_setup
    - delete_page
  max_duration_minutes: 45
  abort_on_error: false
outputs:
  - name: "Content gap tasks"
    type: tasks
    description: "Wrong-page, new-content, and cannibalization-fix tasks with evidence"
  - name: "Gap log"
    type: report
    description: "Identified gaps and chosen resolutions for trend tracking"
---

# Content Gap Analysis

> Identify and resolve situations where the wrong page ranks for a query, no page exists
> for a valuable query, or multiple pages compete against each other (cannibalization).

## Trigger

- **Automatic:** Flagged during the Daily Opportunity Scan (Step 3, "Content Gap" bucket)
- **Manual:** Triggered when reviewing GSC data and noticing unexpected landing pages
- **Scheduled:** Run a full-site content gap analysis monthly as part of the Monthly Roadmap process

## Pre-Flight Checks

1. Confirm GSC data is fresh (fetched within the last 24 hours)
2. Confirm site pages inventory is current
3. Verify no content-related tasks are currently in-progress for the same pages/keywords (to avoid conflicting changes)

```bash
v2 lock list --json
v2 task list --status in_progress --type content_optimization --json
v2 task list --status in_progress --type new_content --json
```

---

## Step 1: Identify the Content Gap

A content gap exists when one of these conditions is true:

### Scenario A: Wrong Page Ranking

GSC shows a query driving impressions/clicks to a page that is NOT the best match.

**Examples:**
- "{{NICHE}} SEO pricing" lands on the homepage instead of `/services/pricing/`
- "local SEO for {{AUDIENCE}}" lands on a generic blog post instead of `/services/local-seo-for-{{AUDIENCE}}/`
- "{{AUDIENCE}} website design" lands on the SEO service page instead of a dedicated web design page

### Scenario B: No Page Exists

GSC shows impressions for a valuable query but we have no dedicated content for it.

**Examples:**
- Impressions for "{{AUDIENCE}} reputation management" but no page covers this topic
- Queries about "{{AUDIENCE}} social media marketing" but we have no content on this
- "{{NICHE}} company Google Ads" generating impressions â€” adjacent service we don't cover yet

### Scenario C: Cannibalization

Multiple pages compete for the same keyword, splitting authority and confusing Google.

**Examples:**
- Both `/services/{{NICHE}}-seo/` and `/blog/what-is-{{NICHE}}-seo/` rank for "{{NICHE}} SEO"
- Multiple blog posts all targeting "{{AUDIENCE}} marketing ideas"
- A service page and a case study both targeting the same keyword

---

## Step 2: Gather Comprehensive Data

### 2a: GSC Query-Level Data

```bash
# Get all queries and their landing pages for the last 28 days
v2 gsc-fetch --days 28 --min-impressions 5 --json
```

From this data, build a **query-to-page mapping**. For each query, note:
- Which page(s) Google is associating with this query
- Position, impressions, clicks, CTR for each page-query pair
- Whether the association has changed over the past 28 days

### 2b: Page Content Analysis

For each page involved in a potential gap, read the actual content:

```bash
# Read the page that IS ranking
v2 page-read --url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" --json
v2 page-meta --url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" --json

# Read the page that SHOULD be ranking (if it exists)
v2 page-read --url "https://{{DOMAIN}}/services/pricing/" --json
v2 page-meta --url "https://{{DOMAIN}}/services/pricing/" --json
```

### 2c: Full Site Inventory

```bash
v2 site-pages --json
```

Map out the entire site structure to understand:
- What pages exist under `/services/`
- What pages exist under `/blog/`
- Are there orphan pages not linked from navigation?
- Is there a logical content hierarchy?

### 2d: SERP Context

```bash
# Check what's actually ranking for the gap keyword
v2 serp-check --keywords "{{NICHE}} SEO pricing" --domain {{DOMAIN}} --json
```

### 2e: Historical Context

```bash
# Has this keyword been worked on before?
v2 task-search --keyword "{{NICHE}} SEO pricing" --days 90 --json
v2 gsc-history --keyword "{{NICHE}} SEO pricing" --days 90 --json
```

---

## Step 3: AI Analysis â€” Diagnose the Gap

### For Scenario A (Wrong Page Ranking)

> **Before anything else: classify search intent from the live SERP.**
> Page mismatches are not always structural. Google frequently shifts the intent it rewards
> for a query. If the SERP has moved from transactional (service pages) to informational
> (guides), forcing your service page to rank is wasted effort â€” and vice versa.

**Step 3.0 â€” Top-10 intent distribution (run this first):**

Pull the current top 10 results and classify each by the intent it satisfies:

| Bucket | Signal |
|--------|--------|
| Service / commercial | Service, product, or "hire us" pages |
| Comparison / pricing | "best", "vs", pricing, packages pages |
| Educational guide | How-to, definitions, long-form articles |
| Local / map | Local pack, map results, location pages |
| Directory / list | Listicles, aggregators, directories |
| Tool / template | Calculators, generators, templates |
| Mixed | No single intent dominates |

Then decide:

- **If the dominant intent matches the page you want to rank** (e.g. mostly service pages, and you want your service page to rank) â†’ proceed with the structural fix below.
- **If Google now prefers a different content type** (e.g. mostly guides, but you're pushing a service page) â†’ do **not** force the service page. Either create/optimize a page of the matching type, or expand the service page to genuinely satisfy the observed intent. Record this as an intent-shift finding, not a wrong-page bug.

Once intent is confirmed to match, continue:

1. **Why is the wrong page ranking?** Common causes:
   - The "right" page doesn't mention the query at all, or barely mentions it
   - The "wrong" page has stronger internal linking
   - The "wrong" page has more external links/authority
   - The "right" page is newer and hasn't been indexed long enough
   - The site architecture confuses Google about topical relevance

2. **Is the "wrong" page actually a better fit than we think?** Sometimes our assumption about which page should rank is wrong. Check:
   - What type of content does the SERP prefer for this query? (service pages vs. guides vs. blog posts)
   - Does the "wrong" page actually satisfy user intent better?

3. **What would fixing this gain us?** Estimate the potential improvement:
   - If the right page ranked, would it convert better? (e.g., service page vs. blog post for a buying keyword)
   - Would consolidating signals improve position?

### For Scenario B (No Page Exists)

Ask yourself:

1. **Is this keyword valuable enough to create a page for?**
   - Money keyword (Bucket 1): Almost always yes
   - Authority keyword (Bucket 2) with >50 impressions/week: Likely yes
   - Informational (Bucket 3) with >100 impressions/week: Consider a blog post
   - <20 impressions/week and not a money keyword: Probably not worth standalone content

2. **Should this be a new service page or a blog post?**

   **Create a SERVICE PAGE when:**
   - The keyword has commercial/transactional intent ("{{AUDIENCE}} SEO services", "{{NICHE}} SEO pricing")
   - The SERP shows mostly service/product pages ranking
   - It represents a service you actually offer or want to offer
   - It logically fits under your `/services/` hierarchy

   **Create a BLOG POST when:**
   - The keyword has informational intent ("how to get more {{NICHE}} customers")
   - The SERP shows mostly blog posts, guides, or articles ranking
   - It's a supporting topic that builds authority for a money keyword
   - It's a question-format query (great for PAA/featured snippets)

   **Expand an EXISTING PAGE when:**
   - The keyword is a sub-topic of an existing page
   - Adding a section to an existing high-authority page would be more effective than a thin new page
   - The existing page is ranking in positions 11-20 and needs more content depth

3. **Does this create a content hub opportunity?**
   - Multiple related queries with no pages could signal an opportunity to create a content hub
   - Example: queries about "{{AUDIENCE}} Google Business Profile", "{{AUDIENCE}} Google Maps", "{{AUDIENCE}} local pack" â†’ create a Local SEO for {{AUDIENCE}} hub page with supporting articles

### For Scenario C (Cannibalization)

Ask yourself:

1. **Which page should be the canonical target?** Consider:
   - Which page has more backlinks/authority?
   - Which page has better historical performance?
   - Which page type matches SERP intent?
   - Which page better serves conversion (for money keywords)?

2. **How bad is the cannibalization?** Check if:
   - Both pages are on page 1 (less urgent â€” could even be beneficial)
   - Both pages are on page 2+ (likely hurting â€” Google is confused)
   - Positions are fluctuating between the pages (Google is testing â€” needs resolution)

3. **What's the fix?**
   - **Merge:** Combine content into the stronger page, 301 redirect the weaker one
   - **Differentiate:** Make each page target distinctly different queries
   - **Canonicalize:** Keep both pages but add canonical tag pointing to the preferred one
   - **Internal linking:** Strengthen internal links to the preferred page for that keyword

---

## Step 4: Plan the Response

### Response Plan: Wrong Page Ranking

```
PLAN:
1. Confirm SERP intent matches the target page type (Step 3.0). If it doesn't, switch to an
   intent-matched fix instead of forcing the wrong page type.
2. Optimize the target page's title tag, H1, and meta description to include the query naturally
3. Add/expand content on the target page that directly addresses the query
4. Add internal links FROM the wrong-ranking page TO the correct page using CONTEXTUAL anchors
   (see anchor-text rule below)
5. Review internal linking sitewide so links for this topic point to the correct page
6. Consider adding a canonical signal if the pages are similar enough to confuse Google
```

> **Anchor-text rule (over-optimization safeguard).**
> Do **not** add repeated exact-match keyword anchors across many pages â€” done programmatically
> and at scale this is a classic over-optimization signal that can trigger Google's spam/quality
> filters. Instead:
> - Use a **mix** of descriptive, partial-match, and natural-phrase anchors
>   (e.g. for "{{NICHE}} SEO pricing": "our pricing packages", "what {{NICHE}} SEO costs",
>   "see pricing details" â€” not five identical "{{NICHE}} SEO pricing" links).
> - Vary the anchor per source page; let the surrounding sentence carry the relevance.
> - Cap exact-match anchors to at most one or two of the highest-relevance source pages.
> - The link must help the reader first; the ranking signal is a side effect, not the goal.

### Response Plan: No Page Exists â€” New Service Page

```
PLAN:
1. Create a comprehensive service page under /services/
2. Target primary keyword + 3-5 related secondary keywords
3. Include: clear service description, benefits for {{NICHE}} companies, process/methodology, pricing signals, testimonials, CTA
4. Add to main navigation or relevant sub-navigation
5. Build internal links from related blog posts and other service pages
6. Add appropriate schema markup (Service, FAQPage if applicable)
```

### Response Plan: No Page Exists â€” New Blog Post

```
PLAN:
1. Run `v2 content blog-cannibalization` against existing blog inventory with the proposed topic,
   target keyword, and support URL.
2. If an existing blog overlaps, refresh/link/differentiate it instead of creating a new URL.
3. Trigger the new-blog-creation.md process only after the gate allows a new post.
4. Focus on informational depth and practical value for {{NICHE}} company owners.
5. Include internal links to relevant service pages (the monetization path).
6. Target featured snippet / PAA opportunities with clear Q&A formatting.
```

### Response Plan: Cannibalization Fix

```
PLAN:
1. Choose the canonical page based on analysis above
2. Update the canonical page to be the definitive resource for the target keyword
3. Modify the competing page to target a different (related but distinct) keyword
4. Update internal linking to consistently point to the canonical page (contextual anchors â€” see
   the anchor-text rule above)
5. If merging: 301 redirect the deprecated page â†’ canonical page, then run the redirect-cleanup
   checklist below
6. Monitor GSC for 2-4 weeks to confirm Google has resolved the confusion
```

> **Redirect-cleanup checklist (run whenever a page is 301'd or merged).**
> A redirect is not "done" when the 301 is in place. Skipping these steps leaves redirect chains,
> broken internal links, and a stale sitemap that slow Google's reprocessing of the change:
>
> 1. **Create the 301** from the old URL â†’ final canonical URL (one hop, never a chain).
> 2. **Update every internal link** that pointed at the old URL to point directly at the final URL
>    (run `v2 link-check` / `v2 site-links` to find them).
>    Use `v2 link-check --target-url "<old-url>" --json` to list remaining internal links to the old URL.
> 3. **Remove the old URL from `sitemap.xml`** so it no longer advertises a redirected URL.
> 4. **Confirm the canonical tag** on the final page is self-referential and the old page does not
>    carry a conflicting canonical.
> 5. **Check for redirect chains** (Aâ†’Bâ†’C). Collapse to a single hop (Aâ†’C).
> 6. **Re-crawl** the affected URLs to verify status codes and that no internal link still 301s.
> 7. **Submit the old URL for re-indexing in GSC** (URL Inspection â†’ Request Indexing) so Google
>    processes the 301 faster instead of waiting for an organic recrawl.
>    Use `v2 index-inspect --url "<old-url>" --json` to record the current GSC/live inspection state;
>    the actual "Request Indexing" action still happens in the GSC UI.
> 8. **Monitor GSC** for 2-4 weeks; confirm the old URL drops out and the canonical consolidates signals.

---

## Step 5: Create Tasks

### Task for Wrong-Page Fix

```bash
v2 task create \
  --title "Content Gap Fix: '{{NICHE}} SEO pricing' ranking on homepage instead of /services/pricing/" \
  --type content_optimization \
  --priority 800 \
  --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/pricing/" \
  --target-keyword "{{NICHE}} SEO pricing" \
  --description "Wrong page ranking: homepage ranks for '{{NICHE}} SEO pricing' at position 14 instead of the dedicated pricing page. Plan: optimize pricing page title/H1/content for this keyword, add internal links from homepage to pricing page using keyword anchor, update sitewide internal linking. Expected result: pricing page replaces homepage in SERP with higher position due to better relevance match." \
  --evidence "GSC 28d: '{{NICHE}} SEO pricing' â†’ homepage at pos 14, 85 imp, 2 clicks. Pricing page not appearing for this query at all. SERP shows dedicated pricing/packages pages ranking in top 5." \
  --json
```

### Task for New Content

```bash
v2 task create \
  --title "Content Gap: Create service page for '{{AUDIENCE}} reputation management'" \
  --type new_content \
  --priority 500 \
  --risk-level safe \
  --target-keyword "{{AUDIENCE}} reputation management" \
  --description "No page exists for reputation management queries. GSC shows growing impressions (60/week, up 25% month-over-month). SERP shows mostly service pages and guides. Recommend: create /services/reputation-management/ page covering review generation, review response, reputation monitoring for {{NICHE}} companies. This supports the broader SEO service offering." \
  --evidence "GSC 28d: '{{AUDIENCE}} reputation management' at pos 22 (homepage), 60 imp/week trending up. Related queries also showing: '{{AUDIENCE}} reviews SEO' (30 imp), '{{NICHE}} company reviews' (45 imp)." \
  --json
```

### Task for Cannibalization Fix

```bash
v2 task create \
  --title "Cannibalization Fix: /services/{{NICHE}}-seo/ vs /blog/what-is-{{NICHE}}-seo/ for '{{NICHE}} SEO'" \
  --type content_optimization \
  --priority 800 \
  --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" \
  --target-keyword "{{NICHE}} SEO" \
  --description "Two pages competing for '{{NICHE}} SEO': service page (pos 8, 200 imp) and blog post (pos 15, 80 imp). Service page should be canonical â€” it's the conversion page and matches SERP intent (mostly service pages in top 5). Plan: (1) update blog post to target 'what is {{NICHE}} SEO' and '{{NICHE}} SEO explained' instead, (2) add clear internal link from blog â†’ service page, (3) ensure service page has strongest keyword signals." \
  --evidence "GSC 28d: Service page pos 8, 200 imp, 12 clicks. Blog post pos 15, 80 imp, 2 clicks. Both pages fluctuating in position â€” Google is testing." \
  --json
```

---

## Post-Flight

1. Log all identified gaps and their resolutions in the database for trend tracking
2. If >3 content gaps were found in a single scan, flag for strategic review â€” this may indicate a broader content strategy issue
3. Content gap tasks should be reviewed during the next Task Triage cycle

### Metrics to Track Over Time

- Number of content gaps identified per scan (trending down = good)
- Time from gap identification to resolution
- Position improvement after gap fixes (measure at 2 and 4 weeks)
- Number of queries with "wrong page" ranking (trending down = good)

---

## Decision Quick-Reference

| Situation | Action |
|-----------|--------|
| Money keyword on wrong page | Fix immediately â€” high priority task |
| Money keyword with no page | Create service page â€” high priority |
| Authority keyword on wrong page | Fix if >50 impressions â€” medium priority |
| Authority keyword with no page | Create blog post or expand existing page â€” medium priority |
| Informational keyword gap | Only act if >100 impressions or supports money keyword |
| Cannibalization on money keyword | Fix immediately â€” high priority |
| Cannibalization on non-money keyword | Fix during next content optimization cycle |
| Multiple gaps for related keywords | Consider a content hub strategy |
