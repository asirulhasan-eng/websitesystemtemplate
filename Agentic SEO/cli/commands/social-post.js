/**
 * social-post.js — Feed a blog's infographics into the social pipeline.
 *
 * Two input modes:
 *   1. Spec mode (primary): a JSON spec describing the blog, its infographics,
 *      and per-platform captions the agent wrote. FB/IG/Pinterest get one post
 *      per infographic; LinkedIn + X get one post per blog (batch 0 only).
 *   2. Simple mode (legacy): --caption + --image + --link for a single image.
 *
 * Spec shape (file via --spec, inline via --spec-json, or piped on stdin):
 *   {
 *     "blog_url": "https://site/blog/post",
 *     "channels": ["facebook","instagram","pinterest","linkedin","x"],
 *     "infographics": [
 *       { "image_url": "https://.../1.png",
 *         "captions": { "facebook": "…", "instagram": "…", "pinterest": "…" } },
 *       { "image_url": "https://.../2.png",
 *         "captions": { "facebook": "…", "instagram": "…", "pinterest": "…" } }
 *     ],
 *     "linkedin": { "image_url": "https://.../hero.png", "caption": "…" },
 *     "x":        { "image_url": "https://.../hero.png", "caption": "…" }
 *   }
 *
 * Captions are validated against platform limits (X 280, IG 2200, Pinterest 500,
 * LinkedIn 3000). Over-limit captions are rejected unless --truncate is passed.
 *
 * Usage:
 *   v2 social post --spec ./post-spec.json
 *   cat spec.json | v2 social post --spec -
 *   v2 social post --caption "…" --image <url> --link <blog-url>   (simple mode)
 *
 * Options:
 *   --spec <path|->   JSON spec file ("-" = stdin)
 *   --spec-json <s>   Inline JSON spec string
 *   --caption/--image/--link/--channels   Simple-mode single-image inputs
 *   --truncate        Truncate over-limit captions instead of erroring
 *   --dry-run         Expand + validate only; no queue write
 *   --json            JSON output (default)
 *   --help            Show this help
 */

const fs = require("node:fs");
const { parseArgs, listArg, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { loadToolEnv } = require("../lib/env");
const social = require("../lib/social");

const TOOL = "social-post";

const HELP = `
social-post — Feed a blog's infographics into the social pipeline

USAGE
  v2 social post --spec ./post-spec.json
  cat spec.json | v2 social post --spec -
  v2 social post --caption "…" --image <url> --link <blog-url>   (simple mode)

SPEC MODE
  --spec <path|->   JSON spec file ("-" reads stdin)
  --spec-json <s>   Inline JSON spec string

SIMPLE MODE
  --caption         Caption reused for FB/IG/Pinterest (X auto-derived)
  --image           Single infographic image URL
  --link            Blog URL to link back to
  --channels        CSV of channels (default: facebook,instagram,pinterest,linkedin,x)

CADENCE (which platforms post per-infographic vs once-per-blog)
  --per-infographic CSV   Force these platforms to "each" (one post per image)
  --per-blog        CSV   Force these platforms to "once" (one post per blog)
  Spec may also set { "cadence": { "reddit": "once", "pinterest": "each" } }.
  Precedence: spec.cadence > --per-* / env > built-in defaults.
  Defaults: facebook/instagram/pinterest = each; linkedin/twitter/reddit/youtube = once.

COMMON
  --truncate        Truncate over-limit captions instead of erroring
  --dry-run         Expand + validate only; do not write the queue
  --json            JSON output (default)
  --help            Show this help

CHARACTER LIMITS (enforced)
  x/twitter 280 · instagram 2200 · pinterest 500 · linkedin 3000 · reddit 40000 · facebook 63206

PIPELINE
  "each" platforms → one post per infographic (unique captions)
  "once" platforms → one post per blog (batch 0 only)
  Drains via: v2 social send   (cron every ~90 ± 11 min)
`.trim();

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

module.exports = async function socialPost() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    // ---- Resolve the spec from --spec / --spec-json / simple flags ----
    let spec;
    if (args["spec-json"]) {
      spec = JSON.parse(args["spec-json"]);
    } else if (args.spec) {
      const raw = args.spec === "-" ? readStdin() : fs.readFileSync(args.spec, "utf8");
      if (!raw.trim()) throw new Error("Empty spec input");
      spec = JSON.parse(raw);
    } else if (args.caption && args.image && args.link) {
      spec = social.specFromSimple({
        caption: args.caption,
        image: args.image,
        link: args.link,
        channels: listArg(args, "channels", []),
      });
    } else {
      throw new Error(
        "Provide --spec <file|->, --spec-json '<json>', or simple mode (--caption --image --link)"
      );
    }

    // Resolve per-platform cadence: env defaults, then spec.cadence wins.
    const config = loadToolEnv({ envPath: args.env });
    const modes = social.resolvePlatformModes({
      perInfographic: listArg(args, "per-infographic", String(config.get("SOCIAL_PER_INFOGRAPHIC", "")).split(",").filter(Boolean)),
      perBlog: listArg(args, "per-blog", String(config.get("SOCIAL_PER_BLOG", "")).split(",").filter(Boolean)),
      spec,
    });

    const { items, post_id, cadence, validation } = social.expandSpec(spec, {
      modes,
      truncate: Boolean(args.truncate),
    });

    // ---- Enforce character limits unless --truncate ----
    if (!validation.ok && !args.truncate) {
      printOutput(errorEnvelope(
        "Caption(s) exceed platform character limits. Fix the captions or pass --truncate.",
        { tool: TOOL }
      ), "json");
      // Attach the violation detail for the agent to act on.
      console.error(JSON.stringify({ violations: validation.violations }, null, 2));
      process.exitCode = 1;
      return;
    }

    // ---- webp advisory ----
    const warnings = [];
    const webpImages = [...new Set(
      items.flatMap((it) => Object.values(it.platforms).map((p) => p.image_url))
    )].filter(social.isWebpUrl);
    if (webpImages.length) {
      warnings.push(
        `${webpImages.length} image(s) are .webp — some platform APIs reject webp. Provide PNG/JPG mirrors if posts fail.`
      );
    }
    // Advisory: captions should be unique per platform / per infographic.
    warnings.push(...social.captionDuplicationWarnings(items));

    // Summarise what will be posted, per batch.
    const plan = items.map((it) => ({
      batch_index: it.batch_index,
      platforms: Object.keys(it.platforms),
    }));

    if (args["dry-run"]) {
      printOutput(envelope({
        dry_run: true,
        post_id,
        batches: items.length,
        cadence,
        plan,
        truncated: Boolean(args.truncate) && !validation.ok,
        warnings,
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    const queue = social.loadQueue(args.queue);
    queue.items.push(...items);
    const queuePath = social.saveQueue(queue, args.queue);

    printOutput(envelope({
      queued: true,
      post_id,
      batches_queued: items.length,
      cadence,
      plan,
      pending_items: queue.items.length,
      next_pickup_at: queue.next_pickup_at || "due now",
      queue_path: queuePath,
      truncated: Boolean(args.truncate) && !validation.ok,
      warnings,
      hint: "Run `v2 social send` (cron ~90±11 min) to drain the pipeline.",
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
