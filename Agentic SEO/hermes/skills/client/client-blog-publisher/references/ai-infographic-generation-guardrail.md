# AI Infographic Generation Guardrail

Use this reference when creating, refreshing, repairing, or diagnosing {{SITE_NAME}} blog posts that include infographics.

## Root cause pattern
A prior blog-worker failure happened because multiple instruction layers disagreed:

- The scheduled worker loaded `client-blog-publisher` and the cron prompt.
- Older guidance in a loaded skill/reference said to create `SVG+WebP` or `source SVG` assets.
- Site docs mentioned image generation, but used stale/generic tool wording (`generate_image`) and were weaker than the loaded runtime skill.
- The worker therefore satisfied the "infographic" requirement by writing SVG/HTML charts programmatically and converting them to WebP with `sharp`, even though the user wanted AI-model infographics.

## Required behavior
For blog infographics, default to the AI image model/tool:

1. Use `image_generate` first.
2. Prompt with exact researched data, labels, hierarchy, layout, brand palette, and source citation.
3. Save/download the generated image into the site repo, normally under `assets/images/blog/`.
4. Optimize the browser-delivered asset as WebP.
5. Add semantic alt text and captions.
6. Verify actual browser rendering, not just file existence.

Do **not** satisfy an infographic requirement with hand-coded SVG/HTML/canvas charts, browser screenshots, or Sharp-created graphic layouts unless the user explicitly asks for that non-AI fallback in the current task.

For scheduled/autopilot publishing, fail closed: if `image_generate` is unavailable or fails, stop as blocked instead of using a fallback generator.

Hard requirement learned from user correction: banning SVG/canvas/Sharp fallbacks is **not sufficient**. The scheduled workflow must also produce positive evidence that the AI image generator was used. Require a per-run manifest and check the generated worker prompt/output for explicit `image_generate` instructions, the required manifest path, and "stop as blocked" fallback behavior before claiming the issue is fixed.

## Diagnostic checklist when the user asks "why SVG/programmatic?" or "fixed now?"
Check every instruction layer, not just the article file:

- active Hermes skill: `client-blog-publisher`
- related operations skill notes if blog enrichment is involved
- cron prompt: `/opt/client-agent/tools/cron/prompts/blog-publisher-autopilot.md`
- wrapper toolsets include `image_gen`: `/opt/client-agent/tools/cron/run-blog-publisher.sh`
- site docs: `/opt/client-site/tools/blog-production-skill.md`
- stats docs: `/opt/client-site/tools/stats-blog-production-skill.md`
- old references containing `SVG+WebP`, `source SVG`, `text-rich SVG`, or stale `generate_image`

When changing repo docs, avoid editing an unrelated active preview branch directly. If the site repo is on a task branch, stash doc-only changes, branch from `master`, commit to a separate fix branch/PR, then return to the original task branch.

## Guarded scheduled-publisher pattern
Prompt wording is not enough for the scheduled blog publisher. Keep an executable post-run guard in the cron wrapper so a future worker cannot silently create SVG-derived infographic assets.

Durable pattern:

1. Before invoking Hermes, create a per-run marker file in the blog-publisher run directory.
2. After Hermes succeeds, run a guard against the site repo changes since that marker and relevant output directories.
3. Fail the scheduled run if new/generated files contain programmatic non-AI infographic signals such as `<svg ... xmlns=`, `Buffer.from(svg)`, `sharp(Buffer.from(svg))`, `sharp({ create: ... })`, `createCanvas`, browser screenshot generation, `SVG+WebP`, `source SVG`, `text-rich SVG`, or stale `generate_image` guidance.
4. Require an AI image manifest for scheduled blog visual assets. The manifest must list each delivered `/assets/images/blog/*.webp` visual with `tool: "image_generate"`, the information-dense prompt, the returned source URL/path, the final WebP path, alt text, and caption.
5. Avoid broad matching on tiny inline UI icons; `viewBox`-only SVG snippets in buttons/social icons should not fail the guard.
6. If an old candidate draft contains SVG-generated visuals, stash or quarantine it before returning the site repo to clean `master`; do not publish it as-is.

Current guard entry point:

```bash
node /opt/client-agent/tools/validate_blog_infographic_guard.js \
  --site-root /opt/client-site \
  --base master \
  --since-file "$GUARD_MARKER" \
  --run-dir /opt/client-site/tools/out/blog-publisher,/opt/client-site/tools/out/blog-research
```

## Verification patterns
Search for stale guidance after patching:

```bash
# Hermes skills / prompts
rg -n "SVG\+WebP|source SVG|text-rich SVG|Use `generate_image`|Use the generate_image|generate_image x|generate_image Ã—" /root/.hermes/skills/client /opt/client-agent/tools/cron/prompts

# Site docs on the intended branch
rg -n "SVG\+WebP|source SVG|text-rich SVG|Use `generate_image`|Use the generate_image|generate_image x|generate_image Ã—" /opt/client-site/tools -g '*.md'
```

Run the executable guard with a fresh marker for smoke verification:

```bash
marker=$(mktemp)
: > "$marker"
node /opt/client-agent/tools/validate_blog_infographic_guard.js \
  --site-root /opt/client-site \
  --base master \
  --since-file "$marker" \
  --run-dir /opt/client-site/tools/out/blog-publisher,/opt/client-site/tools/out/blog-research
```

Also inspect the actual final branch/PR content with `git show <branch>:<path>` when the working tree is on a different branch.
