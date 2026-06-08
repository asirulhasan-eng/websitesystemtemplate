# Content Brief Gap Planning â€” Session Reference

Use this when the user asks for content briefs/topics that have not been covered yet for {{SITE_NAME}}.

## Risk lane
- Planning and brief creation only is **Safe** when it does not edit production pages, deploy, or write raw SQLite.
- Still state the risk lane before inspecting or saving work because the user expects risk classification before acting.

## Recommended sequence
1. State **Safe** risk classification and reason.
2. Check repo status for the four {{SITE_NAME}} repos before saving anything durable:
   - `/opt/client-site`
   - `/opt/client-sqlite`
   - `/opt/client-obsidian`
   - `/opt/client-agent`
3. Inspect existing coverage from `/opt/client-site/blog/*.html` by extracting filenames, `<title>`, and `<h1>` so the briefs target real gaps instead of duplicating published posts.
4. For competitor-blog gap requests, collect competitor posts from `/blog/`, paginated archives, and `post-sitemap.xml`; do not assume posts live under `/blog/` because WordPress category permalinks may be `/seo/...`, `/web-design/...`, etc. See `references/competitor-blog-gap-task-generation.md`.
5. Treat partial coverage as a briefing opportunity only when the new angle is materially different or deeper. Example: existing LSA content can coexist with a dedicated brief on â€œhow reviews affect LSA rankingsâ€ if the article focuses on review score, review velocity, proximity/category fit, disputes, and spam pressure.
6. Save the finished briefs somewhere durable and recallable, preferably in the {{SITE_NAME}} Obsidian mirror as an Obsidian note when the task is strategy/planning or under `tools/out/competitor-blog-gaps/` when generating task-candidate artifacts. Use wikilinks and frontmatter when writing Obsidian markdown.
7. Verify the saved file exists and report the path plus the exact commands/tool actions used.

## Coverage signals from this session
Existing {{SITE_NAME}} blog coverage included: LSA bidding, general Local Service Ads, Google Guaranteed/LSA ranking drops, Google reviews, negative review templates, GBP suspension recovery, multi-location SEO, schema markup, technical SEO checklist, AI search optimization, Google AI Overviews, marketing guide, ROI/statistics/benchmarks.

Gaps or deeper briefs requested by the user:
- Reviews and LSA rankings
- LSA spam and fake competitors
- Emergency {{NICHE}} SEO: 24-hour {{AUDIENCE}} SEO, burst pipe keywords, water heater emergency SEO, after-hours lead generation, storm season strategy
- Practical AI search/GEO examples and citation templates
- Owner-operator operational marketing content
- Video-first/visual SEO content
- City-specific educational SEO pages
- {{NICHE}} marketing benchmarks
- Reputation management depth
- Deeper technical SEO for service businesses

## Pitfalls
- Do not assume â€œnot coveredâ€ from memory. Inspect the live blog inventory first.
- Do not store this as memory; content plans are project artifacts that can go stale. Save as an Obsidian/project note or task artifact instead.
- If a user says â€œswitch temporarilyâ€ during a content operation, pause and clarify the new target before continuing the long-form task; do not continue drafting in the background.