# Blog QA Checklist ({{SITE_NAME}})

## Purpose
Reusable runbook for one-by-one deep review of newly published posts (usually daily).

## Core checks to capture
1. **Published slug extraction**
   - Extract card slugs from `blog/index.html` by matching visible publish date (`June 1, 2026` or current target date).
2. **HTTP sanity**
   - Each slug URL should return HTTP 200.
   - Route baseline:
     - `/blog/`
     - `/blog/index.html`
     - `/sitemap.xml`
3. **Per-post scoring dimensions**
   - Word count (ideal: 2500+, minimum 2200)
   - H2 count (ideal: 10+, minimum 8)
   - FAQ JSON-LD count (ideal: 6+, minimum 5)
   - Image count (minimum 5)
   - Lazy loading for non-hero images (>=40â€“60% where possible)
   - CTA presence in-content (contact/book/call/audit/quote/schedule terms)
   - Author schema/`org`/`BlogPosting` presence
4. **SEO integrity**
   - Canonical + OG tags present
   - Structured data JSON-LD parses without JSON errors
   - Internal links should not point to non-existent local targets
   - Keep links actionable and non-duplicative
5. **Set-level parity**
   - `blog/index.html` slug set == expected published set
   - `sitemap.xml` contains every expected URL
   - Compare local vs origin/live snapshots when required

## Known failure patterns observed in production-like audits
- Regex-only parsers can undercount slugs when card/date formatting shifts.
- `cf-cache-status` alone is not reliable proof of freshness.
- Some internal links point to future/non-existing slugs; treat as follow-up tasks, not blocking QA if existing content strategy allows external linking.
- Local working tree can have extra draft/unmerged content not in live; always compare origin/live before declaring deployment state.

## Suggested remediation order
1. Expand low-depth C/D posts first
2. Fix unresolved internal links and schema inconsistencies
3. Normalize image loading for non-critical assets
4. Re-run full one-by-one QA pass

