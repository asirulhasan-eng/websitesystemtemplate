---
name: client-blog-publisher
description: Use the {{SITE_NAME}} blog writing workflow to create, refresh, or repair SEO blog posts with scaffolded HTML, SERP research, safe preview branches, and validation.
---

# {{SITE_NAME}} Blog Publisher

Use this skill when creating, rewriting, refreshing, or repairing {{SITE_NAME}} blog posts in the site repo. It covers blog article HTML, CSS/component fit, FAQ/schema, related posts, CTAs, preview validation, and reusable workflow notes.

## Partial preview recovery

If a blog-publisher run leaves `/opt/client-site` dirty after generating a valid article/images but before integration/commit, do not blindly reset. Use `client-operations` reference `references/blog-publisher-partial-preview-dirty-repo.md` to finish the preview branch, validate, create PR/Cloudflare preview, record `preview_ready`, sync outbox, and return the site repo to clean `master`.

The scheduled cron wrapper now pins the blog worker to `openai-codex` / `gpt-5.5` by default (`CLIENT_BLOG_PUBLISHER_PROVIDER`, `CLIENT_BLOG_PUBLISHER_MODEL`) and uses a tighter context budget (`CLIENT_BLOG_PUBLISHER_MAX_TURNS`, default 90). Keep the env override behavior when changing it, and validate shell syntax plus worker smoke tests.

## Operating rules

### Session-learned updates

- For scheduled `new_blog_post` pickup jobs, process at most one eligible semi-safe candidate from the authoritative SQLite DB, use this blog-publisher workflow rather than the generic deterministic fallback, create/push a preview branch and PR, update task state to `preview_ready` through project tooling, and report concise evidence only. See `references/scheduled-new-blog-post-preview-workflow.md`.
- When adding user-requested statistics/roundup blog candidates to the SQLite queue, avoid obviously templated titles across the batch. Do **not** stamp every post with the same `75+ Data Points` phrase. Vary the count promise (for example 70+, 72+, 76+, 81+, 88+) and use topic-specific nouns such as `benchmarks`, `trust and conversion benchmarks`, `cost/call/booking benchmarks`, or `wage/revenue/market benchmarks`. After insertion or correction, verify the authoritative queue, event rows, and Obsidian outbox rows. See `references/statistical-blog-candidate-title-variety.md`.
- Statistics/data/benchmark roundup tasks must be impossible to pick up through the generic blog workflow alone. For every stats-blog candidate, SQLite metadata, the scheduled worker prompt, and `record_blog_preview_ready.js` must all require `/opt/client-site/tools/stats-blog-production-skill.md` in addition to the normal blog skill. Validation evidence must include `checks.stats_blog_skill_loaded=true` and the stats skill path in `required_skills` or `commands`; otherwise the task must not become `preview_ready`. Also guard against stale preselect JSON by re-reading SQLite and using the corrected SQLite title. See `references/stats-blog-skill-pickup-gate.md`.
- After scheduled blog preview work, finish the durable state loop: verify task/deployment/outbox rows, commit/push any final SQLite or Obsidian mirror changes caused by state updates, return the site repo to `master`, and verify all four repos are clean/synced before reporting. See `references/scheduled-blog-preview-finalization.md`.
- If no fresh blog completes in two hours and logs show the same task id being started repeatedly, assume queue starvation: one candidate is being re-claimed while remaining candidates stay `candidate`. Before switching tasks, check:
  - `lock_type='blog_publisher_task'` rows for that task (active/expired/released timestamps),
  - status of the selected task in `tasks` (`candidate` vs transition), and
  - `Could not create auto-stash/Could not re-apply stash automatically`, `blog/index.html: needs merge`, `Context length exceeded`, and missing AI-manifest guard markers in `logs/blog-publisher.log`.
  - Durable fix pattern: the cron wrapper should snapshot dirty failed worktrees, hard-reset/clean `/opt/client-site` back to `master`, record `blog_publisher_run_failed`, temporarily skip recently failed candidates so the queue advances, and pin the spawned worker to `openai-codex` / `gpt-5.5` (not the smaller default Spark model).
  - Then verify with a real cron/dry-run cycle that the site repo is clean on `master`, the failed candidate is skipped, and another candidate can reach `preview_ready`.
- When using `tools/scaffold-blog.ps1`, it may modify the tracked runtime file `tools/scaffold-blog.log`; restore or intentionally exclude that log before committing. If `tools/link-registry.json` is updated and Git warns because `tools/` is ignored, verify `git status`/`git ls-files` rather than assuming the registry failed to stage; stage tracked ignored registry changes with `git add -u tools/link-registry.json` rather than `git add tools/link-registry.json`. A plain Python static server does not rewrite extensionless blog URLs, so local HTTP checks may need the `.html` file path while Cloudflare preview verifies the canonical extensionless URL.
- When a preview draft is valid but the user asks for â€œmore depth,â€ more SERPs/scraping, more infographics, or table CSS fixes, treat it as a blog-quality repair on the existing semi-safe preview branch. Re-run adjacent-intent SERPs/scrapes, add decision-support depth, use existing table components, generate AI-model infographics with `image_generate`, save optimized WebP assets in the site repo, and visually verify image/table rendering before pushing. Do **not** hand-code SVG/HTML/canvas/Sharp infographics. For scheduled/autopilot publishing, fail closed if `image_generate` is unavailable instead of using a fallback generator. If `image_generate` fails with missing `FAL_KEY` while Hermes is logged into OpenAI Codex, configure the image tool to use Codex-backed image generation instead: `hermes plugins enable image_gen/openai-codex`, `hermes config set image_gen.provider openai-codex`, and `hermes config set image_gen.model gpt-image-2-medium`; then verify with a real `image_generate` call showing `provider: openai-codex`. Only use non-AI fallback visuals when the user explicitly requests them in the current task, and disclose clearly. See `references/serp-depth-infographics-table-polish.md`, `references/ai-infographic-generation-guardrail.md`, and `references/codex-image-generate-preview-finalization.md`.
- **Image model requests are explicit and validated:** the current working stack uses `image_gen.provider: openai-codex` and `image_gen.model: gpt-image-2-medium`; do not assume `gpt-image-2-high` or other variants exist unless confirmed by config/provider verification. When the user asks for a different variant, first check `image_gen.provider` and `image_gen.model`, then run a real `image_generate` smoke call and verify returned `provider`/`model` in evidence before proceeding. If the requested variant is unavailable, report back and continue with the validated model.
- When a scheduled blog run creates a branch/PR and AI images but stops before state finalization, resume from logs rather than rerunning the article. Extract the PR/branch/commit, use Cloudflare bot PR comments as the preview source if API env is missing, verify article/index/assets with HTTP `200`, run `record_blog_preview_ready.js`, process Obsidian/email outbox, return the site repo to `master`, commit/push durable SQLite + Obsidian changes, and report production status separately from preview status. See `references/codex-image-generate-preview-finalization.md`.
- GitHub CLI caveat for this workflow: `gh pr checks` does not support `--json` in this stack, and may return permission-restricted `Resource not accessible by personal access token` errors when checking checks. In that case, verify merge with `gh pr view` (`state`, `mergeCommit.oid`, `baseRefName`, `headRefName`) and treat `mergeStateStatus`/`mergeable` as `UNKNOWN` metadata only when merge is already accepted. After successful `gh pr merge`, proceed to deployment/task-state sync rather than blocking on those fields.
- For semi-safe infographic refreshes, treat deployment verification as a separate step from image generation: after pushing preview, confirm `tasks`/`deployments` rows show `preview_pushed`, confirm the specific preview commit/branch exists remotely, and read the generated `tools/out/deployments/preview-publish-*.json` for deployment state before retrying API checks. If `wait_cloudflare_deployment` reports long `running` with no branch visibility, do **not** force mergeâ€”re-poll DB state, reopen wait with smaller intervals, and capture a checkpoint note before escalation.

1. **Risk-classify first.** Blog changes on a PR/preview branch are semi-safe. Do not merge or publish production without explicit approval.
2. **Check existing blogs before new support posts.** Before suggesting, drafting, or approving a `new_blog_post` that supports the homepage or a service page, run `node /opt/client-agent/cli/bin/v2.js content blog-cannibalization --topic "<working title>" --target-keyword "<primary keyword>" --support-url "<support page>" --site-root /opt/client-site --json`. If it returns `refresh_existing_blog`, refresh/link the matched blog instead of creating a new URL. If it returns `differentiate_or_refresh`, only proceed after documenting the distinct intent split in the brief and task evidence. Store the result summary under `metadata.evidence.blog_cannibalization_check`.
3. **Use the repo scaffold when available.** Do not hand-build the article shell if a repo scaffold/template script exists. For a new post or an existing-post repair, first inspect the current site repo `tools/` and existing `blog/*.html` patterns. If `tools/scaffold-blog.ps1` exists, run it to generate a reference page, then adapt content into the scaffolded structure. If the scaffold script is absent in the current checkout, explicitly report that and clone the structure from the closest existing production blog post plus `blog/index.html` footer/FAQ/card patterns instead of inventing unsupported markup.
4. **Preserve source-of-truth boundaries.** Site repo edits happen in the site repo; operational task state belongs in SQLite/agent tooling, not ad-hoc note edits.
5. **Show commands and evidence.** The user expects commands, logs, preview URLs, and validation outcomes. For workflow corrections (especially AI infographic generation), include positive proof that the intended tool path is required/used; do not report success from a negative guard alone.

## Workflow

### 1. Pre-flight

- Confirm branch and git status.
- Load {{SITE_NAME}} system/preview rules if production or preview behavior is involved.
- Locate the target blog post, blog index, CSS, images, and relevant scripts.
- Inspect `tools/` before inventing a workflow.
- For `task_type: new_blog_post`, do **not** rely on the generic deterministic safe-task executor as the writing path. It may create a technically valid but thin draft. Reserve new blog tasks for this blog-publisher workflow unless the user explicitly asks for a fallback scaffold. If the user wants automatic pickup, use a separate Hermes cron/job that loads this skill and processes one semi-safe blog candidate per run, rather than enabling generic deterministic autopilot. See `references/new-blog-post-autopilot-guard.md`.

### 2. Scaffold first

For new posts or structural repairs, generate a temporary scaffold reference with the repo script. Example:

```powershell
cd tools
.\scaffold-blog.ps1 -Title "Final Title" -Slug "scaffold-temp-[topic]-fix" -Category "Category" -Description "Final meta description" -SourcePost "google-maps-seo-for-{{AUDIENCE}}.html"
```

Then copy/adapt the scaffolded shell, footer, scripts, and component patterns into the real target post while preserving researched content, canonical URL, OG metadata, images, and schema. Remove temporary scaffold files/log noise before commit unless intentionally tracked.

### 3. Component rules

- Footer must match the scaffold/blog-index footer exactly unless the user explicitly requests a global footer change.
- FAQ must use the existing accordion pattern: `.faq-section` â†’ `.faq-accordion` â†’ `.faq-item` â†’ `button.faq-question` + `.faq-answer > .faq-answer__inner`.
- Do not use raw `<details><summary>` FAQ unless matching CSS/JS is intentionally added.
- Related posts should use `.related-posts` / `.related-posts__card`, not custom `.keep-reading` blocks.
- Bottom CTA should use an existing styled component like `.cta-box` or `.bottom-cta`, not a new unstyled class.
- Tables should use existing blog table components (`.data-table-wrapper` + `.data-table`) rather than inline `<table style=...>` markup. If a user says table CSS is wrong, inspect the target blog CSS and convert to supported classes instead of adding one-off inline styles.
- Floating call/text/WhatsApp CTA must load both assets on every blog article: `/css/floating-cta.css?v=1` in `<head>` and `/js/floating-cta.js?v=1` before `</body>`. If only the script is present, the button renders unstyled/incorrectly.
- Avoid leaving unsupported one-off core classes such as `.article-cta` when a styled component exists.

### 4. Research and content

- Use current search-intent/competitive research when the article depends on search intent or competitive positioning, but **never expose the research tool, provider, scrape status, or task lineage in public copy**.
- Save research artifacts and logs under a temporary run directory.
- Cite useful sources without overloading the article.
- Hard public-copy ban: do not write phrases such as `Serper`, `Serper API failed`, `scrape failed`, `SERP results say`, `SERP results says`, `Google search says`, `Googe serach says`, `SERP research for this task`, `competitor article behind this task`, `Reddit search and scrape`, or `community research was attempted` into article body, metadata, schema, captions, alt text, blog index cards, or sitemap-related copy.
- Convert research/tool observations into reader-facing support instead: `Recent competitive analysis suggests...`, `Top-ranking {{NICHE}} marketing pages commonly emphasize...`, `{{NICHE}} owners should ask...`, or cite an actual public source directly when appropriate.
- For first-party product/update announcement posts (for example a newly launched addon/app/tool), treat the official listing/docs as the primary source of truth. Keep feature and pricing claims strictly bounded to what the listing/docs explicitly state, include the official install/listing URL in-body, and qualify time-sensitive claims (for example pricing) with "at the time of writing."
- Include at least one editorial external link/backlink in the article body when current research supports factual claims; prefer authoritative/non-competitor sources such as Google documentation over competitor SEO agencies. Footer/social links do not count as editorial external citations.
- If Reddit/old Reddit scraping returns blocked or low-value text, record that only in private logs/research notes and do not mention the failed scrape, Serper/API status, or inaccessible thread in public article copy.
- Count Serper usage from logs: batch search count from query rows, scrape credits from `Credits used:` lines, and failed/no-credit attempts separately. Keep this accounting out of public copy.
- For user-requested depth improvements, do adjacent-intent research instead of only repeating the headline keyword. Add concise synthesis sections that explain what should happen first, when paid channels are still needed, how to judge progress, and what operational constraints block SEO success.
- When adding infographics, use the AI image tool (`image_generate`) first and save/download the resulting image into `/opt/client-site/assets/images/blog/` as optimized WebP with semantic alt/captions. Keep prompt text information-dense and include the exact data, labels, hierarchy, and source citation. Do **not** satisfy the infographic requirement by writing SVG/HTML/canvas charts or Sharp-created layouts programmatically. For scheduled/autopilot publishing, preserve the executable post-run guard (`tools/validate_blog_infographic_guard.js`) with required AI manifest evidence, and stop as blocked if `image_generate` fails or is unavailable. Only use non-AI fallback visuals when the user explicitly requests them in the current task; if a fallback is used, disclose it in the report. Verify the browser actually renders the image content. Lazy-loaded figures can appear blank in full-page visual checks until scrolled into view; inspect `currentSrc`, `complete`, and natural dimensions or use eager loading for new in-article infographics.

### 5. Validation checklist

Run local and preview checks before reporting completion:

- Article local HTTP returns `200`.
- `/blog/` local HTTP returns `200`.
- Exactly one `<h1>`.
- Footer outer HTML/text matches `blog/index.html` or scaffold reference.
- Visible FAQ count equals FAQPage schema count.
- Blog pages expose only one FAQPage structured-data source: prefer canonical JSON-LD and do not also add FAQ microdata (`itemtype="https://schema.org/FAQPage"`) to the visible FAQ accordion.
- All JSON-LD parses.
- FAQ opens/closes in browser through `js/main.js`.
- No raw details/summary FAQ remains unless intentionally supported.
- No `.keep-reading`, `.article-cta`, or other unsupported core component classes remain.
- Related posts card count is correct.
- Floating call/text/WhatsApp CTA assets are paired: if `/js/floating-cta.js?v=1` is present, `/css/floating-cta.css?v=1` is also present, and vice versa. On the site repo, run `npm test` or `node scripts/check-floating-cta-assets.mjs` after adding/updating blog posts.
- Local relative links/assets resolve.
- Blog index contains the new/updated slug and title only when the post is approved for public discovery; preview-only drafts should stay out of public `blog/index.html` unless explicitly noindexed/approved.
- Sitemap contains exactly one canonical `<loc>` for the slug with expected metadata only when the post is approved for public discovery; preview-only drafts should stay out of public `sitemap.xml` unless explicitly noindexed/approved.
- Public copy contains no internal research/tool/process wording: scan article body, metadata, schema, image alt/captions, blog index card text, and sitemap-adjacent copy for `Serper`, `SERP results say`, `SERP results says`, `Google search says`, `Googe serach says`, `scrape failed`, `SERP research for this task`, `competitor article behind this task`, and similar variants.
- Cloudflare branch preview reflects pushed HTML; use a cache-busting query string if needed.
- Newly generated infographic assets return `200` from local and branch preview URLs, and browser QA confirms they render with visible graphics/text rather than blank reserved boxes. For infographic workflow regressions, also verify the instruction chain still says `image_generate` first and does not reintroduce `SVG+WebP`, `source SVG`, `text-rich SVG`, or stale `generate_image` guidance; see `references/ai-infographic-generation-guardrail.md`.
- For new multi-image blog posts, confirm the rendered page exposes the expected image count in browser QA and that FAQ accordion count matches FAQPage schema count before considering the post complete.
- Styled comparison/timing tables use `.data-table-wrapper .data-table`; no inline `<table style=` remains unless intentionally documented.
- After an approved production merge, verify production article URL, `/blog/`, and `/sitemap.xml` instead of assuming deployment completed.

### 6. Social distribution (approved public posts only)

Once a post is approved for public discovery and its infographics are live at
public URLs, fan them out to social via the `v2 social` pipeline. Write **unique
per-platform captions** (FB/IG long and keyword-rich; Pinterest short; one
LinkedIn + one X post per blog), assemble a spec JSON (see
`cli/commands/social-post.example.json`), validate with `--dry-run`, then enqueue:

```bash
node /opt/client-agent/cli/bin/v2.js social post --spec ./post-spec.json --json
```

The cron drains it on a jittered drip; do not bulk-post manually. Full rules,
character limits, and guardrails: `references/social-distribution-pipeline.md`.

## Consolidated content maintenance lanes

Use this umbrella for the following formerly separate {{SITE_NAME}} blog-maintenance workflows; pick the lane inside this skill instead of loading a narrow sibling skill:

### Public-copy and content audit lane
- Before revising, reviewing, or publishing blog content, run a deterministic public-copy scan for internal workflow language, provider/tool leakage, task lineage, failed scrape/API notes, vague SERP attribution, and placeholder briefing phrasing.
- Hard-banned reader-visible phrases include variants of `Serper`, `SERP results say(s)`, `Google search says`, `Googe serach says`, `scrape failed`, `SERP research for this task`, `competitor article behind this task`, `for this task`, `Reddit search and scrape`, and `community research was attempted`.
- Scope scans to public site HTML/MD and relevant preview files; avoid broad filesystem scans that mix unrelated notes and system paths.
- When adjacent blog posts may cannibalize each other, validate a SERP-uniqueness split: distinct title/H1/meta/schema identity, thumbnail/non-logo image uniqueness, body shingle overlap, blog-index card differentiation, reciprocal cross-links, and post-edit live `200` checks.
- Treat PR-review copy cleanups as low-risk branch edits: switch to the PR branch, edit only called-out content/discoverability files, remove internal language from body/metadata/schema/alt/captions/cards, verify the preview-only slug is absent from `sitemap.xml` and `blog/index.html` unless explicitly approved/noindexed, then push to the same PR branch.

### Visual asset and infographic refresh lane
- For existing blog visual refreshes, keep filename stability unless the user explicitly asks to rewire paths; replace image file contents in place under `assets/images/blog/`, then update only real `width`/`height` attributes when dimensions changed.
- Use `image_generate` / configured Codex image generation first for information-dense infographic assets; do not substitute programmatic SVG/HTML/canvas/Sharp graphics unless explicitly requested in the current task and disclosed.
- Convert deterministically to repo format (usually WebP via `ffmpeg` when Pillow is unavailable), verify file existence, dimensions, references, rendered browser image count, and layout sanity before commit.
- If the request includes â€œmore depth,â€ run adjacent-intent research first, add concise source-backed sections, and place each new visual near the section it supports.
- Treat preview deployment verification as separate from generation: verify task/deployment rows, branch/commit, preview artifacts, and live/preview asset `200` responses before reporting.

### Link and CTA safe-fix lane
- Broken internal links are safe only when the change is limited to exact static `href` path corrections. Discover matches first, confirm canonical destination exists, replace only proven bad anchor tokens, re-scan old path to zero, and show a minimal diff.
- Floating CTA fixes are safe UI wiring when limited to one paired CSS+JS include per page: `/css/floating-cta.css?v=1` in `<head>` and `/js/floating-cta.js?v=1` near footer scripts. Remove duplicate loaders and run `node scripts/check-floating-cta-assets.mjs` from the site repo root.
- Keep unrelated local dirt out of safe-fix commits; isolate via branch/stash and validate production/preview HTML counts after push when applicable.

## References

- `references/scaffold-footer-faq-repair.md` â€” session-derived notes for fixing blog footer/FAQ/CSS issues after an existing-post rewrite.
- `references/new-blog-post-autopilot-guard.md` â€” guardrail for keeping `new_blog_post` tasks out of generic deterministic autopilot and requiring the blog-publisher workflow.
- `references/floating-cta-asset-pair-regression.md` â€” root cause, prevention pattern, and verification probes for call/text/WhatsApp floating CTA CSS/JS mismatches.
- `references/serp-depth-infographics-table-polish.md` â€” workflow notes for enriching thin preview posts with additional SERP/scrape depth, new infographic assets, and supported table CSS.
- `references/ai-infographic-generation-guardrail.md` â€” root-cause pattern and verification checklist for enforcing AI `image_generate` infographics instead of programmatic SVG/HTML charts.
- `references/codex-image-model-availability.md` â€” session-tested decision flow for explicit image-model variant requests (for example `gpt-image-2-high`) and required evidence checks.
- `references/blog-pr-cli-mergeability-guardrails-20260601.md` â€” PR merge verification pattern when CLI returns unsupported flags or permission-limited mergeability states.
- `references/semi-safe-preview-verification.md` â€” how to recover and report when preview deployment remains in transition after branch push.
- `references/statistical-blog-candidate-title-variety.md` â€” session-derived guardrail for statistics blog candidate batches: vary count promises and topic-specific title phrasing, then verify SQLite/events/outbox.
- `references/stats-blog-skill-pickup-gate.md` â€” enforce stats-blog production skill pickup through SQLite metadata, scheduled worker prompt injection, preview-ready validation evidence, and corrected-title re-read guards.
- `references/absorbed-blog-maintenance-skills-20260602.md` â€” inventory of blog/content/asset/link/CTA sibling packages consolidated into this umbrella.
- `references/social-distribution-pipeline.md` â€” after a post is approved for public discovery and its infographics are live, write unique per-platform captions and feed them to the `v2 social` pipeline (FB/IG/Pinterest = 1 post per infographic; LinkedIn + X = 1 per blog; jittered drip drain).
