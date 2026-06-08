# Serper-backed blog rewrite validation checklist

Use this when the user asks to rewrite or enrich an existing {{SITE_NAME}} blog post, especially after asking whether Serper/SERP research was used.

## Research evidence to collect
- Run Serper batch research across several intent variants of the target keyword.
- Record counts for organic rows, related-search rows, and PAA rows if available.
- Scrape several competitor/source pages with the repo Serper scrape script.
- Retry community/Reddit sources when useful, but report when they return limited text.

## Rewrite expectations
- Rebuild the article from SERP findings, not just add paragraphs.
- Add a clear section that explicitly reflects current SERP/research findings.
- Preserve strong existing original assets, including useful infographics, unless they are inaccurate.
- Update title/H1, meta, OG/Twitter data, BlogPosting schema, Breadcrumb schema, FAQ copy, and FAQPage schema when the rewrite changes positioning.
- Update blog index card title/excerpt if the article title or angle changes.

## Validation evidence to report
- Commands run, with paths.
- Local article HTTP status.
- Local blog index HTTP status.
- Visible article word count.
- In-article infographic count.
- JSON-LD parse status and block count.
- No-go/banned source mentions check when relevant.
- Local crawler result, noting known false positives separately.
- Cloudflare preview URL and HTTP status.
- Preview content checks for new H1 and research/SERP section.
- PR URL/comment URL and latest commit.

## Safety
- Treat rewrites on a PR/preview branch as semi-safe.
- Do not merge or publish to production without explicit approval.
