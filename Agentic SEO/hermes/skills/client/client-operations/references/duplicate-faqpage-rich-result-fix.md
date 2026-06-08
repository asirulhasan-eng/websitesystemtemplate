# Duplicate FAQPage rich-result fix

Use this reference when Google Search Console reports **Duplicate field `FAQPage`** for {{SITE_NAME}} blog URLs.

## Risk lane

Classify as **Safe** when the work is limited to removing duplicate structured-data markup from existing pages while preserving visible content and the canonical FAQ JSON-LD. If the fix rewrites page copy, redesigns FAQ content, or changes production beyond schema cleanup, reclassify.

## Queue/task handling

1. Add a high-priority task in the authoritative SQLite DB using project tooling, not raw SQLite writes.
2. Candidate metadata should include:
   - `evidence.type = "duplicate_faqpage_schema"`
   - affected URLs deduped from GSC examples
   - reported GSC issue text and first-detected/last-crawled dates when available
   - URL/file locks for affected pages
3. Invalid rich-result items are high priority because they are not eligible for Google rich results.

## Fix pattern

1. Inspect each affected URL/page for both FAQPage sources:
   - JSON-LD FAQPage in `application/ld+json` with `"@type": "FAQPage"`
   - HTML microdata using `itemscope itemtype="https://schema.org/FAQPage"` plus nested Question/Answer itemtypes
2. Keep one canonical source. Preferred {{SITE_NAME}} behavior: keep JSON-LD and remove duplicate microdata attributes from the visible FAQ HTML.
3. Preserve the visible FAQ accordion and answer text. Remove only schema attributes:
   - `itemscope`
   - `itemtype="https://schema.org/FAQPage"`
   - `itemtype="https://schema.org/Question"`
   - `itemtype="https://schema.org/Answer"`
   - `itemprop="mainEntity"`, `acceptedAnswer`, `name`, `text`
4. If one reported URL already has a single valid FAQPage source, do not force an edit; validate and report it separately.
5. If `tools/execute_safe_task.js` does not support `duplicate_faqpage_schema`, add deterministic executor support and tests after the immediate fix so future GSC rich-result duplicate tasks can auto-execute safely.

## Validation checklist

- Local/static page still renders and visible FAQ content remains.
- Every affected live URL returns HTTP 200.
- Every JSON-LD block parses.
- Each affected page has exactly one FAQPage JSON-LD source.
- Each affected page has zero FAQPage microdata sources.
- Run relevant agent tests after changing executor/tooling.
- Record deployment/task state and process Obsidian outbox after a safe production push.
- Tell the user that Search Console can now run **Validate Fix / Finished fixing**, but the GSC report clears only after Google recrawls.

## Pitfalls

- GSC may show duplicate rows for the same URL; dedupe affected URLs before editing, but keep the reported examples in metadata.
- Do not remove FAQ content, only duplicate structured-data markup.
- Cloudflare may block simple Python `urllib` live checks with 403. Retry with `curl -A` and no-cache/cache-busting headers rather than treating that transient fetch behavior as a site defect.
