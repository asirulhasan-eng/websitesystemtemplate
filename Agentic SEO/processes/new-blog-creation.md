---
id: new-blog-creation
name: "Blog Publisher"
version: 2
description: "Single entry point for all blog writing on Website Operations Agency. Routes each topic to one of two production lines (standard blog or stats blog), then delegates the full writing workflow to that production skill."
trigger:
  schedule: "manual"
  can_run_manually: true
  conditions:
    - "A blog post needs to be written (task of type new_content, content gap, or manual request)"
guardrails:
  max_risk_level: high_risk
  publish_model: sequential_no_manual_gate
  notes: "Blog/content work publishes one post at a time through the blog_content worker; no PR/manual merge gate unless a task explicitly overrides this."
metadata:
  hermes:
    tags: [SEO, Website Operations, Blog, Content, Stats]
    related_skills: [client-system-rules]
    requires_tools: [terminal]
---

# Blog Publisher

## Overview
This process is the **single entry point** for all blog writing on Website Operations Agency. Every blog post is produced through one of two specialized production skills. This process determines which production line to use based on the topic, then delegates the full writing workflow to that production skill.

---

## Ã¢Å¡Â Ã¯Â¸Â CRITICAL: Always Start a New Session

**Every blog writing task MUST be started in a fresh, new session (empty context window).** This is non-negotiable.

Why:
- Blog production skills are large (800Ã¢â‚¬â€œ1600+ lines) and must be read in full
- A clean context window ensures no interference from prior conversations
- Research, planning, asset generation, and writing require maximum available context

**Never attempt to write a blog mid-conversation.** Always open a new session, read the appropriate production skill, and begin fresh.

---

## Two Production Lines

All blog writing goes through one of these two production skills. There is no third option Ã¢â‚¬â€ every blog is either a standard blog or a stats blog.

### 1. Standard Blog Production
**Skill file:** `/opt/website-site/tools/blog-production-skill.md`

**Use when:** The topic is an editorial, how-to, comparison, guide, checklist, strategy, or opinion post Ã¢â‚¬â€ anything that is NOT primarily a data/statistics aggregation.

**What it produces:**
- Data-driven, interactive blog posts with 3Ã¢â‚¬â€œ5 custom infographics
- TLDR box, FAQ accordion, inline CTAs, bottom CTA
- Article + FAQ schema, OG/Twitter Cards, canonical URLs
- Unique outline per topic (no fixed template)
- Full research Ã¢â€ â€™ planning Ã¢â€ â€™ assets Ã¢â€ â€™ writing Ã¢â€ â€™ integration Ã¢â€ â€™ QA pipeline

**Examples of standard blog topics:**
- "website SEO vs PPC: Which Gets More Calls?"
- "How to Optimize Your Google Business Profile for small business owners"
- "What Does a Website Audit Include?"
- "Local SEO Checklist for website Companies"

---

### 2. Stats Blog Production
**Skill file:** `/opt/website-site/tools/stats-blog-production-skill.md`

**Use when:** The topic is a **statistics roundup, data aggregation, or industry data post** Ã¢â‚¬â€ the definitive data resource on a given topic.

**What it produces:**
- Massive data-aggregation posts with 50+ verified statistics from 15+ sources
- Hero stat counters, key takeaways box, table of contents navigation
- HTML/CSS data visualizations (bar charts, progress bars, stat grids, comparison tables)
- 5+ infographic images complementing HTML visualizations
- Source-cited throughout Ã¢â‚¬â€ every statistic links to its original source
- Methodology section and summary reference table
- Format: "[Topic] Statistics: [N]+ Data Points You Need to Know in [Year]"

**Examples of stats blog topics:**
- "website Industry Statistics: 75+ Data Points for 2026"
- "SEO ROI Statistics for Service Businesses: 60+ Data Points"
- "Local Search Statistics: 80+ Data Points for 2026"

---

## How to Decide Which Production Line

| Signal | Ã¢â€ â€™ Use |
|---|---|
| Topic asks for "statistics", "data points", "numbers", "industry data" | **Stats Blog** |
| Title format matches "[Topic] Statistics: [N]+ Data Points..." | **Stats Blog** |
| Topic is a how-to, guide, comparison, checklist, strategy, opinion | **Standard Blog** |
| Brief mentions "lead magnet", "guide", "walkthrough", "checklist" | **Standard Blog** |
| Topic is data-heavy but NOT a pure stats aggregation | **Standard Blog** (use more infographics) |
| Unsure | Default to **Standard Blog** |

---

## Procedure: Writing a Blog

### Step 1: Start a New Session
Open a **fresh, empty context window session**. This is mandatory.

### Step 2: Check Existing Blogs for Cannibalization
Before recommending, drafting, or approving a new blog post, inventory existing blog posts and
check whether the topic is already covered:

```bash
V2="/opt/website-agent/cli/bin/v2.js"
SITE="--site-root /opt/website-site"

node $V2 content blog-cannibalization \
  --topic "<working title or angle>" \
  --target-keyword "<primary keyword>" \
  --support-url "<homepage or service URL this blog will support>" \
  $SITE --json
```

Decision rule:
- `refresh_existing_blog`: do not create a new post. Refresh the matched post and add/strengthen
  the internal link to the support page.
- `differentiate_or_refresh`: create a new post only when the brief documents a distinct intent
  split, unique title/H1/meta target, and why the existing post cannot serve the query.
- `create_new_blog`: continue to production-line selection.

Record the top-match URL, score, recommendation, and support URL in task metadata under
`evidence.blog_cannibalization_check`. New support blogs without this evidence should be returned
to planning instead of drafted.

### Step 3: Determine the Production Line
Read the topic and brief. Decide whether this is a standard blog or a stats blog using the decision table above.

### Step 4: Read the Production Skill and Execute
In the new session, use a prompt like the examples below. The production skill will guide the entire process from research through QA.

### Step 5: Publish and Verify
Once the blog is complete and QA passes, commit directly to `main`/`master` according to the owner rule for blog/content work. Do not create a PR unless the current task explicitly asks for one.

Before commit/push, verify `/blog/` ordering is latest-first:
```bash
cd /opt/website-site
node --test test/blog-index-sort.test.js
```
`tools/register-blog-post.ps1` should run `tools/sort-blog-index.js` automatically after adding the card. If an agent manually edits `blog/index.html`, it must run `node tools/sort-blog-index.js blog/index.html` and then the sort test before publishing.

---

## Example Prompts (New Session)

### For a Standard Blog:

```
Read the /opt/website-site/tools/blog-production-skill.md and write on below topic and brief. ALWAYS generate infographics using AI. The infographics must be information dense. Register the post with tools/register-blog-post.ps1, verify /blog/ ordering with node --test test/blog-index-sort.test.js, then commit directly to main/master unless the current task explicitly asks for a PR.

Topic: What Does a Website Audit Include?
Brief: Primary intent: lead magnet support.
SERP gap: audit topics rank with checklists and tools. Your version should explain the human review and the first-priority fixes.

Must cover:

Website structure.
Technical basics.
Google Business Profile.
Local visibility.
Service pages.
Internal links.
Competitor snapshot.
Priority list: fix first, fix next, monitor.
Internal links:

/free-seo-audit with anchor free website audit
/services/seo-foundation with anchor SEO foundation
/pricing with anchor clear SEO pricing
/blog/small-business-seo-checklist after live
```

### For a Stats Blog:

```
Read the /opt/website-site/tools/stats-blog-production-skill.md if present; otherwise use /opt/website-site/tools/blog-production-skill.md and adapt the outline for a data roundup. ALWAYS generate infographics using AI. The infographics must be information dense. Register the post with tools/register-blog-post.ps1, verify /blog/ ordering with node --test test/blog-index-sort.test.js, then commit directly to main/master unless the current task explicitly asks for a PR.

Topic: website Industry Statistics: 75+ Data Points You Need to Know in 2026
Brief: Comprehensive data aggregation covering market size, revenue, workforce, technology adoption, and consumer behavior in the website industry.
```

---

## Brand Voice Rules
- small business owners-first language
- No generic marketing jargon
- Practical, actionable advice
- Show expertise in website SEO specifically
- Use internal links to service pages
- Include proper title, meta, schema

## Worker Closeout After Publish
- Publish directly to `main`/`master` from the fresh blog session, one task at a time. Do not create a PR, preview branch, or manual merge/review gate unless the current task explicitly overrides the standard policy.
- Before pushing, run the blog-index ordering check from Step 5 and any production-skill QA checks. If QA fails, leave the task blocked/needs_review with the failure evidence instead of partially publishing.
- After the push, verify the live URL when possible, then record all state in SQLite via v2 CLI (never write to the DB directly):
  ```bash
  v2 task update --id <task-id> --status completed --note "Published sequentially to main: <live-url>; verification: <result>" --json
  ```
- Legacy `preview_ready` / `preview_pushed` rows are old manual-gate drafts. Do not treat them as an executable queue. Reconcile one at a time: verify the draft/source still exists and is worth publishing, then either convert that one row to `approved` for the blog worker to publish directly, or park it as `skipped` / `needs_review` with evidence. Never bulk-approve the legacy preview backlog.

## Validation Checks
- Title tag present and unique
- Meta description present
- H1 present and unique
- Schema markup (Article schema)
- Internal links to relevant service pages
- No broken links
- Images have alt text
- URL follows slug convention

---

## After Publish: Social Distribution

Once the post is **approved and live** (in `blog/index.html` + `sitemap.xml`, with
its infographics reachable at public image URLs), distribute it to social.

Follow the `social-distribution` process (`processes/social-distribution.md`):
write a **unique caption per platform per infographic** (never copy-paste FBâ†”IG or
reuse a caption across infographics), build the spec from
`cli/commands/social-post.example.json`, then:

```bash
V2="/opt/website-agent/cli/bin/v2.js"
node $V2 social post --spec ./post-spec.json --dry-run --json   # validate: read warnings + cadence
node $V2 social post --spec ./post-spec.json --json             # enqueue
node $V2 social status --json                                   # confirm queued
```

Treat any "identical/reused caption" warning as a fail and rewrite. Do **not** run
`v2 social send` manually â€” the drip cron (`*/15 * * * * v2 social send`) drains the
pipeline at a jittered ~90 Â± 11 min cadence. Skip this entirely when QA failed,
when the task was parked instead of published, or when the live URL was not verified.

---

## Notes for v2
- This process is the **router** Ã¢â‚¬â€ it picks the production line and delegates the full writing workflow to the production skill on the site server.
- CLI tools are data-only; AI makes all content decisions. See `hermes/skills/client/system-rules/SKILL.md`.
- The production-skill files (`blog-production-skill.md`, `stats-blog-production-skill.md`) live server-side under `/opt/website-site/tools/` and are read in full at the start of each new session.
- SQLite at `/opt/website-state/website-agent.db` is the single source of truth Ã¢â‚¬â€ record all state through `v2` CLI commands.
