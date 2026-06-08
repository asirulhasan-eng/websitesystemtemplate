# SERP depth, infographic rendering, and table polish for blog previews

Use these notes when a {{SITE_NAME}} blog preview is technically valid but the user asks for more depth, more SERP/scrape work, additional infographics, or table/CSS polish.

## Pattern that worked

1. Keep the risk lane semi-safe: edit only the existing preview branch/PR; do not merge production.
2. Re-run live SERP research for the article intent, not just the original target keyword. For timing/strategy posts, use adjacent intents such as timeline, PPC/LSA comparison, and first-90/180-day expectations.
3. Scrape several ranking resources and extract repeated themes. Add a short research-backed synthesis section rather than dumping competitor claims.
4. Convert thin advice into decision support:
   - readiness signals
   - first-priority checklist
   - paid-lead bridge guidance
   - red flags
   - questions to ask before hiring
   - 90/180-day roadmap
5. Use existing site components for tables. For comparison/timing tables, wrap with `.data-table-wrapper` and use `.data-table`; do not leave inline `<table style=...>` markup.
6. Generate infographic assets with the AI image tool (`image_generate`) first. Prompts must be information-dense and include exact data, labels, layout, hierarchy, brand palette, and source citation. Download/save the generated image into the site repo and optimize to WebP. Do not hand-code SVG/HTML charts to satisfy the infographic requirement unless the user explicitly requests SVG/vector output or the AI image service is unavailable; disclose any fallback clearly in the report.
7. After adding image assets, visually verify rendering in a browser. Browser full-page screenshots may show lazy image placeholders; either scroll the target figure into view or temporarily use `loading="eager"` for newly added in-article infographics before visual QA. Also inspect `img.currentSrc`, `complete`, and `naturalWidth/naturalHeight` to confirm loading.
8. Use cache-busting query strings on newly regenerated WebP sources when validating a local or Cloudflare preview (`?v=2`, commit SHA, etc.).
9. Validate both structure and deployment before reporting:
   - word count/depth target
   - exactly one H1
   - FAQ visible count equals FAQPage schema count
   - all JSON-LD parses
   - three new infographic figures/sources when requested
   - no inline table styles remain
   - relative assets exist
   - local HTTP 200s
   - Cloudflare branch preview 200s for article and image assets

## Useful probes

```js
Array.from(document.querySelectorAll('figure.infographic img')).map(img => ({
  currentSrc: img.currentSrc,
  complete: img.complete,
  naturalWidth: img.naturalWidth,
  naturalHeight: img.naturalHeight
}))
```

```bash
npm test
curl -L -s -o /tmp/preview.html -w '%{http_code} %{content_type} %{size_download} %{url_effective}\n' "$PREVIEW/blog/slug?v=$SHA"
```

## Reporting to user

Report the preview URL, PR, commit, what changed, and real validation output. Mention that production was not merged/published.