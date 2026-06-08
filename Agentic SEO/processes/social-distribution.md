---
id: social-distribution
name: "Social Distribution"
version: 1
type: process
schedule: "event:blog_published"
description: "After a blog post is approved and live, write UNIQUE per-platform social captions for each infographic and enqueue them into the v2 social pipeline. A separate cron drains the pipeline on a jittered drip; this process only writes captions and enqueues."
trigger:
  schedule: "event:blog_published"
  can_run_manually: true
  conditions:
    - "The blog post is approved for public discovery and live (in blog/index.html + sitemap.xml)."
    - "Its infographics are reachable at public image URLs (deployed assets or PNG/JPG mirrors)."
guardrails:
  max_risk_level: semi_safe
  notes: "Social reshares of already-approved, already-public content are semi-safe. Do NOT enqueue for preview-only or unapproved drafts. The pipeline never posts faster than 1/platform/floor and drains on a ~90±11 min cron, so there is no burst risk."
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Social, Distribution, Content]
    related_skills: [client-blog-publisher, client-system-rules]
    requires_tools: [terminal]
---

# Social Distribution

## Overview
This process turns a published blog post's infographics into a drip-fed set of
social posts via the `v2 social` CLI. The AI agent writes the captions (a content
decision); the CLI only transports and schedules them (data). It runs **after**
a post is approved and live — never for preview-only drafts.

There are two jobs:
1. **This process (per blog):** write unique captions + enqueue with `v2 social post`.
2. **The drip cron (always-on):** `*/15 * * * * v2 social send --json` drains the
   pipeline at a jittered ~90 ± 11 min cadence. Do **not** run `social send` in a
   loop yourself.

---

## ⚠️ Caption rules — captions MUST be unique per platform

The single most important rule: **never copy-paste one caption across platforms or
across infographics.** Each post is a separate ranking/engagement surface.

- **Facebook**: long, natural-language, keyword-rich. FB posts can rank in Google
  for long-tail phrasing — write a full, readable paragraph and include the blog URL.
- **Instagram**: long and keyword-rich too, but framed for IG (hook first line,
  hashtags at the end). Must DIFFER from the Facebook caption — different opening,
  different emphasis — not a duplicate.
- **Pinterest**: short, keyword-led description (ranks on image search). One per
  infographic.
- **LinkedIn**: one professional post for the whole blog (matching/hero image).
- **X/Twitter**: one post for the whole blog, ≤280 chars, matching/hero image.
- **Reddit** (if enabled): one discussion-style post; respect the target subreddit's
  norms (no spammy marketing tone).

Every caption links back to the **same** blog URL. The CLI emits an advisory
warning when two platforms share an identical caption or a caption is reused
across infographics — **treat those warnings as a fail and rewrite.**

Character limits are enforced (X 280 · IG 2200 · Pinterest 500 · LinkedIn 3000 ·
Reddit 40000 · FB 63206). Over-limit captions are rejected unless `--truncate`.

Public-copy ban (same as the blog-publisher skill) applies to captions and alt
text: never expose Serper/SERP/scrape/tool/task-lineage wording.

---

## Cadence model (configurable — not hardcoded)

- `each` platforms (default: facebook, instagram, pinterest) → one post **per
  infographic**.
- `once` platforms (default: linkedin, twitter, reddit, youtube) → one post **per
  blog**, in the first batch only.
- Reclassify per spec (`"cadence": { "reddit": "each" }`) or globally via env
  (`SOCIAL_PER_INFOGRAPHIC` / `SOCIAL_PER_BLOG`, `SOCIAL_DEFAULT_CHANNELS`).

So a blog with 3 infographics and the defaults produces: batch 0 = FB+IG+Pin(#0)
+ LinkedIn + X (+ Reddit); batch 1–2 = FB+IG+Pin only.

---

## Procedure

### Step 1: Confirm eligibility
The post must be approved and live, with infographics at public URLs. If the
images are `.webp` and a target platform rejects webp, prepare PNG/JPG mirror URLs.

### Step 2: Write the spec
Build a spec JSON with a **unique** caption per platform per infographic. Use
`cli/commands/social-post.example.json` as the template. Shape:

```json
{
  "blog_url": "https://{{DOMAIN}}/blog/<slug>",
  "channels": ["facebook","instagram","pinterest","linkedin","x"],
  "infographics": [
    { "image_url": "https://{{DOMAIN}}/assets/images/blog/<img1>.png",
      "captions": { "facebook": "…", "instagram": "…", "pinterest": "…" } },
    { "image_url": "https://{{DOMAIN}}/assets/images/blog/<img2>.png",
      "captions": { "facebook": "…", "instagram": "…", "pinterest": "…" } }
  ],
  "linkedin": { "image_url": "https://{{DOMAIN}}/assets/images/blog/<hero>.png", "caption": "…" },
  "x":        { "image_url": "https://{{DOMAIN}}/assets/images/blog/<hero>.png", "caption": "…" }
}
```

### Step 3: Validate (dry run)
```bash
V2="/opt/client-agent/cli/bin/v2.js"
node $V2 social post --spec ./post-spec.json --dry-run --json
```
Read `cadence`, `plan`, and `warnings`. If any warning mentions identical/reused
captions, **rewrite the offending captions** and re-validate. Fix any character
-limit rejection rather than blindly passing `--truncate`.

### Step 4: Enqueue
```bash
node $V2 social post --spec ./post-spec.json --json
```

### Step 5: Confirm it queued
```bash
node $V2 social status --json
```
Verify the batches and per-platform pending entries. Do not post manually beyond
this — the drip cron sends them.

### Step 6: Record state
Record the enqueue in task metadata / memory (the blog is the source post). The
pipeline drains autonomously afterward.

---

## Notes for v2
- CLI tools are data-only; the AI writes all caption content. See
  `hermes/skills/client/system-rules/SKILL.md` and the detailed rules in
  `hermes/skills/client/client-blog-publisher/references/social-distribution-pipeline.md`.
- Env config lives in `.env` Section 11 (`SOCIAL_WEBHOOK_URL`, board/page/profile
  fields, cadence, jitter). The webhook routes (`*_yes_no`) fan out to the
  platforms; Instagram is in the schema even though the live webhook may add it later.
- The pipeline queue is a JSON file at `tools/out/state/social-queue.json`.
