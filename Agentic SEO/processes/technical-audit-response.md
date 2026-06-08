---
id: technical-audit-response
name: "Technical Audit Response"
version: 2
schedule: "manual"
description: "Respond to findings from a technical site crawl. Categorize issues by impact, prioritize fixes, and create tasks for critical problems."
trigger:
  schedule: "manual"
  can_run_manually: true
  conditions:
    - "A site crawl has been completed or technical issues have been reported"
guardrails:
  max_tasks_created: 10
  max_risk_level: safe
  require_human_review_for:
    - robots_txt_change
    - sitemap_structure_change
    - redirect_setup
    - navigation_change
  max_duration_minutes: 30
email_on_complete:
  enabled: false
  on_error_only: true
---

# Technical Audit Response Process

> Analyze technical SEO issues from a site crawl and create actionable fix tasks.
> Most technical fixes are safe operations that don't affect content or rankings directly.

## When to Use

- After a scheduled or manual site crawl completes
- When Google Search Console reports crawl errors
- After deploying changes that might have introduced technical issues
- During periodic technical health reviews

---

## Step 1: Run or Retrieve Crawl Data

```bash
# Run a fresh crawl
v2 crawl --url https://{{DOMAIN}} --json

# Or compare with a previous crawl to find new issues
v2 crawl-diff --days-ago 7 --json
```

---

## Step 2: Get Current Site Technical State

```bash
# Full site page inventory (catches missing meta, missing H1, etc.)
v2 site-pages --missing-meta --json
v2 site-pages --missing-canonical --json
v2 site-pages --missing-h1 --json
v2 site-pages --multiple-h1 --json

# Check internal link structure for orphans
v2 site-links --orphans --json

# Check for any stuck locks or deployments
v2 lock list --stale --json
v2 deploy status --latest --json
```

---

## Step 2b: Core Web Vitals / Page Experience

> Title tags and canonicals are only half of a technical audit. Google uses **LCP, CLS, and INP**
> as page-experience signals, and slow pages cost rankings and conversions regardless of on-page SEO.
> A technical audit that ignores performance is incomplete.

```bash
# Runs PageSpeed Insights (Lighthouse + Core Web Vitals + CrUX field data)
v2 speed-audit --url https://{{DOMAIN}}/ --strategy both --json
v2 speed-audit --url https://{{DOMAIN}}/services/{{NICHE}}-seo/ --strategy mobile --json
```

**Thresholds (treat a money/template page exceeding these as Tier 1â€“2):**

| Metric | Good | What it catches |
|--------|------|-----------------|
| **LCP** (Largest Contentful Paint) | < 2.5s | Slow hero image / server response |
| **CLS** (Cumulative Layout Shift) | < 0.1 | Images/ads without reserved dimensions |
| **INP** (Interaction to Next Paint) | < 200ms | Heavy/blocking JavaScript |
| **TTFB** | < 0.8s | Slow server / no caching |

Common fixes to flag: compress/convert hero images (WebP/AVIF), `fetchpriority=high` + no lazy-load
on the LCP image, assign explicit width/height to images, defer render-blocking CSS/JS, reduce
third-party scripts, improve TTFB via caching/CDN. For a deeper, recurring performance pass, route to
the `core-web-vitals-audit.md` playbook.

---

## Step 2c: XML Sitemap Validation

> The crawl checks individual pages, but a stale or dirty sitemap actively misleads Google. The
> sitemap must advertise **only** canonical, indexable, 200-status URLs.

```bash
v2 sitemap-audit --url https://{{DOMAIN}}/sitemap.xml --json
```
Use the `issues`, `by_type`, and `ok_to_submit` fields to decide whether the sitemap is clean enough
to submit or whether it needs immediate cleanup.

Flag the sitemap as a Tier 1 issue if it contains any of:
- URLs returning **404/410 or 5xx**
- URLs that **301/302 redirect** (sitemaps should list final destinations only)
- URLs carrying **`noindex`**
- **Non-canonical** URLs (a URL whose canonical points elsewhere)
- Missing **important pages** (money/service pages absent from the sitemap)
- A `lastmod` that never updates, or an unreachable/!200 sitemap file itself

---

## Step 3: Categorize Issues

### AI Analysis â€” Issue Triage

Categorize every issue found into one of these tiers:

#### Tier 1: Critical (Fix immediately)
Issues that directly harm rankings or user experience:
- **Broken pages** (4xx, 5xx errors on important pages)
- **Missing or duplicate title tags** on service pages
- **Noindex on pages that should be indexed**
- **Broken canonical tags** pointing to wrong pages
- **SSL certificate issues**
- **Robots.txt blocking important pages**
- **Missing sitemap entries** for key pages, or **sitemap listing 404/redirected/noindex/non-canonical URLs**
- **Failing Core Web Vitals on a money/template page** (LCP â‰¥ 4s, CLS â‰¥ 0.25, or INP â‰¥ 500ms â€” "poor" range)

#### Tier 2: Important (Fix this week)
Issues that impact SEO quality:
- **Missing meta descriptions** (especially on service and blog pages)
- **Missing H1 tags** or multiple H1 tags
- **Missing alt text on images** (especially hero images)
- **Orphan pages** (no internal links pointing to them)
- **Core Web Vitals in the "needs improvement" range** on important pages (LCP 2.5â€“4s, CLS 0.1â€“0.25, INP 200â€“500ms)
- **Missing schema markup** on service pages
- **Redirect chains** (A â†’ B â†’ C instead of A â†’ C)

#### Tier 3: Minor (Batch fix when convenient)
Issues that are good practice but not urgent:
- **Missing alt text on decorative images**
- **Very long titles** (> 70 characters)
- **Very short meta descriptions** (< 50 characters)
- **External links with no rel="noopener"**
- **Missing Open Graph tags**

#### Tier 4: Informational (No action needed)
- **Expected patterns** (utility pages like 404, thank-you without meta)
- **Design decisions** (single-page sections without canonical)

### Key Judgment Calls

> **"Does this issue actually impact SEO?"**
> Many technical SEO tools flag issues that are technically correct but don't impact rankings. For example:
> - A missing meta description on a thank-you page: **Not important** (noindex page)
> - A missing meta description on the main {{NICHE}} SEO service page: **Critical** (money page)
> - An orphan blog post from 2 years ago about an outdated topic: **Minor** (redirect or delete later)
> - An orphan service page: **Critical** (needs internal links immediately)

---

## Step 4: Create Fix Tasks

For Tier 1 and Tier 2 issues, create tasks:

### Safe technical fixes (auto-executable):
```bash
v2 task create --title "Fix: Missing title tag on /services/<page>" \
  --type technical_fix --priority 900 --risk-level safe \
  --target-url "https://{{DOMAIN}}/services/<page>" \
  --target-file "services/<page>.html" \
  --description "Crawl found missing <title> tag. Add appropriate title including primary keyword." \
  --json

v2 task create --title "Fix: Missing meta description on /blog/<post>" \
  --type technical_fix --priority 700 --risk-level safe \
  --target-url "https://{{DOMAIN}}/blog/<post>" \
  --description "Missing meta description. Add compelling 150-160 char description." \
  --json

v2 task create --title "Fix: Missing alt text on images - /services/<page>" \
  --type technical_fix --priority 600 --risk-level safe \
  --target-file "services/<page>.html" \
  --description "N images missing alt text. Add descriptive alt attributes." \
  --json
```

### Semi-safe fixes (need preview):
```bash
v2 task create --title "Fix: Orphan service page needs internal links - /services/<page>" \
  --type internal_linking --priority 800 --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/<page>" \
  --description "Service page has 0 incoming internal links. Add links from relevant blog posts and navigation." \
  --json
```

### Reversible high-risk fixes (auto-run under opt-out, listed in the plan email):
```bash
# Reversible (redirect consolidation): created as a normal high-risk task; it runs
# automatically this session unless the owner stops it via Telegram.
v2 task create --title "Redirect chain found /old-page â†’ /middle â†’ /final" \
  --type technical_fix --priority 750 --risk-level high_risk \
  --description "Redirect chain detected. Consolidate to a direct redirect." \
  --json

# Irreversible/destructive (e.g. deleting a page): require explicit approval.
# Create it, then request approval â€” it will NOT auto-run until the owner replies 'approve <id>'.
v2 task create --title "Delete orphaned /legacy-page and 301 to /services" \
  --type delete_page --priority 700 --risk-level high_risk --json
# â†’ then: v2 task approve request --task <new-task-id> --json
```

---

## Step 5: Batch Fix Minor Issues

For Tier 3 issues, consider batching:

```bash
# Create a single batch task for minor fixes
v2 task create --title "Batch fix: Minor technical issues from $(date +%Y-%m-%d) crawl" \
  --type technical_fix --priority 400 --risk-level safe \
  --description "Batch of N minor issues from crawl: X missing alt text, Y long titles, Z missing og:tags" \
  --evidence '{"issues": [{"type": "missing_alt", "count": X}, {"type": "long_title", "count": Y}]}' \
  --json
```

---

## Step 6: Update Site-Wide Tracking

```bash
# Snapshot current technical health
v2 db snapshot --health-only --json

# Record the crawl run results
v2 db query --allow-write --sql "UPDATE crawler_runs SET metadata_json = json_patch(metadata_json, '{\"triage_completed\": true}') WHERE crawler_run_id = '<run-id>'" --json
```

---

## Success Criteria

After addressing the issues:
- Zero Tier 1 issues remaining
- Tier 2 issues have tasks created and scheduled
- No service pages are orphaned
- All service pages have title, meta description, H1, and schema
- Crawl error rate is below 2% of total pages
- No money/template page is in the "poor" Core Web Vitals range (LCP, CLS, INP)
- `sitemap.xml` lists only canonical, indexable, 200-status URLs (no 404/redirected/noindex entries) and includes all money pages
