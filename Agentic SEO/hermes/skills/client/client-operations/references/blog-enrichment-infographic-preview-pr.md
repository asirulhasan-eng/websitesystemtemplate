# Blog Enrichment + Infographic Expansion Workflow

Use this when the user says an existing {{SITE_NAME}} blog draft/preview needs to be â€œricher,â€ â€œmore infographics,â€ â€œadd more,â€ or similar.

## Risk lane
- Treat as **semi-safe** if it changes site content on a preview branch/PR.
- Do not merge or publish to production without explicit approval.
- Report that production is untouched and give the PR/preview details when available.

## Workflow
1. Re-read the current branch/PR state and target article before editing.
2. Quantify the baseline so the response can show concrete improvement:
   - visible article word count
   - number of in-article infographic/image blocks
   - current asset paths
3. Expand with useful sections, not filler. Good {{AUDIENCE}}-web-design additions include:
   - emergency/mobile UX checklist
   - trust proof placement
   - local SEO architecture map
   - service-page anatomy
   - conversion leak map
   - business-stage priorities
   - redesign audit steps
4. For each new infographic:
   - Generate it with the AI image tool (`image_generate`) first.
   - Use an information-dense prompt with exact data, labels, hierarchy, brand palette, and source citation.
   - Save/download the generated image under `assets/images/blog/` and optimize the browser-delivered asset as WebP.
   - Use descriptive filenames and alt text tied to {{NICHE}} SEO intent.
   - Do **not** create hand-coded SVG/HTML charts to satisfy the infographic requirement unless the user explicitly requests SVG/vector output or the AI image service is unavailable; disclose any fallback clearly in the report.
5. Insert the infographics near the matching sections rather than dumping them together.
6. Recalculate final visible word count and in-article infographic count.

## Validation checklist
Run and report real output for:
- local article `curl -I` returns `200 OK`
- every in-article local WebP/SVG asset returns `200 OK`
- JSON-LD parses cleanly
- local crawler has no new article-specific high errors other than known canonical/self-reference false positives if applicable
- no `switch.monster` / `switch-monster` mentions in the article or new assets unless the task is explicitly about no-go documentation
- `git diff --stat`, commit, push, and PR/comment update if working through GitHub

## Reporting shape
Keep the final concise and evidence-based:
- Risk classification first
- What changed: final word count, added word count, final infographic count, new asset names
- Commands/checks run and key outputs
- PR/preview URL and latest branch/commit if available
- Explicitly say production was not merged/published
