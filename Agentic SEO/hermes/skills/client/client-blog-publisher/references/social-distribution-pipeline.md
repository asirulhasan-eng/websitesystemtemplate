# Social Distribution Pipeline (blog → infographics → social)

Use this after a blog post's AI infographics are generated and the post is
approved for public discovery. It turns the blog's infographics into a
drip-fed set of social posts via the `v2 social` CLI.

## When to run

- Only for posts approved for public discovery (same gate as adding the slug to
  `blog/index.html` / `sitemap.xml`). Preview-only drafts do **not** get social
  posts.
- After infographics exist as real, publicly reachable image URLs (the deployed
  `https://{{DOMAIN}}/assets/images/blog/*.webp` assets, or PNG/JPG mirrors).

## What the agent produces

The agent writes **unique, platform-appropriate captions** and assembles a spec
JSON (see `cli/commands/social-post.example.json`):

- **"each" platforms** (default: Facebook, Instagram, Pinterest): one post **per
  infographic**, with a unique caption per platform under `infographics[].captions`.
  FB/IG should be long and keyword-rich (they rank on Google); Pinterest short.
- **"once" platforms** (default: LinkedIn, X/Twitter, Reddit, YouTube): ONE post
  for the whole blog, described by a top-level object (`spec.linkedin`, `spec.x`,
  `spec.reddit`, …) with `caption` and optional `image_url` (defaults to the hero
  infographic). These ride in batch 0 only.
- Always include the blog URL in every caption.

Character limits are enforced by the CLI: X 280 · Instagram 2200 · Pinterest 500
· LinkedIn 3000 · Reddit 40000 · Facebook 63206. Over-limit captions are rejected
(fix them) or pass `--truncate` to auto-trim.

## Cadence is configurable (add/remove platforms freely)

The per-infographic vs once-per-blog split is **not fixed**. Reclassify or add a
platform (e.g. Reddit) without code changes:

- Per spec: add a `cadence` map, e.g. `"cadence": { "reddit": "each" }`.
- Globally: env `SOCIAL_PER_INFOGRAPHIC` / `SOCIAL_PER_BLOG` (CSV), and
  `SOCIAL_DEFAULT_CHANNELS` to enable the channel.
- Precedence: `spec.cadence` > env > built-in defaults.
- New "once" platforms read `spec.<platform>.{caption,image_url}`; new "each"
  platforms read `infographics[].captions.<platform>`.
- Reddit also uses `SOCIAL_REDDIT_SUBREDDIT` for the target subreddit.

## Pipeline behavior (don't re-implement)

- FB/IG/Pinterest = one post **per infographic**; LinkedIn + X = one post **per
  blog**, riding in batch 0 only. Every post links back to the same blog URL.
- Batches drain on a jittered cadence (default 90 ± 11 min) with a per-platform
  floor (default 60 min). Batch 0 = FB+IG+Pin(#0)+LinkedIn+X; batch k = FB+IG+Pin(#k).
- The webhook routes (`*_yes_no`) only fire the due subset. Instagram is enabled
  in the schema even though the current webhook adds IG later.

## Commands

```bash
# 1. Enqueue the blog's infographics (validate first with --dry-run)
node /opt/client-agent/cli/bin/v2.js social post --spec ./post-spec.json --dry-run --json
node /opt/client-agent/cli/bin/v2.js social post --spec ./post-spec.json --json

# 2. Inspect the pipeline
node /opt/client-agent/cli/bin/v2.js social status --json

# 3. Draining is automatic via cron (do NOT post manually in bulk):
#    */15 * * * *  node /opt/client-agent/cli/bin/v2.js social send --json
```

## Guardrails

- webp images trigger a warning — if a platform rejects webp, supply a PNG/JPG
  mirror URL in the spec instead of the `.webp` asset.
- Do not bypass the drip by calling `social send --force` repeatedly; the
  per-platform floor still protects against spamming a platform.
- Public-copy ban from the main skill applies to captions/alt text too: never
  expose Serper/SERP/scrape/tool/task-lineage wording in any caption.
- Config lives in env (`SOCIAL_WEBHOOK_URL`, board/page/profile fields,
  `SOCIAL_PICKUP_INTERVAL_MINUTES`, `SOCIAL_PICKUP_JITTER_MINUTES`). See
  `.env.example` Section 11.
