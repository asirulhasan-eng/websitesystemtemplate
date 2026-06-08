/**
 * social.js — Core of the social distribution pipeline.
 *
 * Pipeline model (one blog → many platform posts):
 *   - A blog yields N infographics. Facebook / Instagram / Pinterest each get
 *     ONE post per infographic, with UNIQUE per-platform captions written by the
 *     agent (each capped to that platform's character limit).
 *   - LinkedIn and X (twitter) get exactly ONE post per blog, with a matching
 *     infographic image. They ride along in the FIRST batch only.
 *   - Every post links back to the same blog URL.
 *
 * Batching: each infographic becomes one queue "batch item" (one webhook call
 * routing all its platforms with per-platform image + caption).
 *   Batch 0 → FB + IG + Pinterest (info #0) + LinkedIn + X
 *   Batch k → FB + IG + Pinterest (info #k)        (k >= 1)
 *
 * Drip: a cron drains one (or more) batches per run at a jittered cadence
 * (default 90 ± 11 min). Per-platform spacing is also floored so no platform
 * exceeds 1 post per SOCIAL_MIN_INTERVAL_MINUTES.
 *
 * This module is pure-ish (no CLI parsing): spec expansion, queue persistence,
 * drip planning, webhook payload building, and delivery.
 */

const fs = require("node:fs");
const path = require("node:path");
const { nowIso } = require("./dates");

// Canonical platform keys present in the webhook payload. `x` mirrors `twitter`.
const CANONICAL_PLATFORMS = [
  "reddit",
  "facebook",
  "linkedin",
  "pinterest",
  "youtube",
  "instagram",
  "twitter",
];

// Posting cadence per platform:
//   "each" → one post per infographic (image-first feeds)
//   "once" → one post per blog, in the first batch only (link/discussion feeds)
// This is the DEFAULT only — every platform's cadence is overridable via env
// (SOCIAL_PER_INFOGRAPHIC / SOCIAL_PER_BLOG) or a per-spec `cadence` map, so
// adding Reddit (or any future channel) or reclassifying one is pure config.
const DEFAULT_PLATFORM_MODES = {
  facebook: "each",
  instagram: "each",
  pinterest: "each",
  reddit: "once",
  linkedin: "once",
  twitter: "once",
  youtube: "once",
};

// Back-compat convenience views of the defaults.
const EACH_PLATFORMS = CANONICAL_PLATFORMS.filter((p) => DEFAULT_PLATFORM_MODES[p] === "each");
const SINGLE_PLATFORMS = CANONICAL_PLATFORMS.filter((p) => DEFAULT_PLATFORM_MODES[p] === "once");

const DEFAULT_CHANNELS = ["facebook", "instagram", "pinterest", "linkedin", "x"];

/**
 * Where a "once" platform's single post is described in the spec.
 * twitter reads spec.x (or spec.twitter); everyone else reads spec[platform].
 */
function specEntryFor(spec, platform) {
  if (platform === "twitter") return spec.x || spec.twitter || {};
  return spec[platform] || {};
}

/**
 * Resolve each platform's cadence ("each" | "once").
 * Precedence: spec.cadence  >  env lists  >  built-in defaults.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.perInfographic] Platforms forced to "each" (env CSV).
 * @param {string[]} [opts.perBlog]        Platforms forced to "once" (env CSV).
 * @param {object}   [opts.spec]           Spec whose `cadence` map wins last.
 */
function resolvePlatformModes(opts = {}) {
  const modes = { ...DEFAULT_PLATFORM_MODES };
  for (const token of opts.perInfographic || []) {
    const p = canonicalChannel(token);
    if (p) modes[p] = "each";
  }
  for (const token of opts.perBlog || []) {
    const p = canonicalChannel(token);
    if (p) modes[p] = "once";
  }
  const cadence = (opts.spec && opts.spec.cadence) || {};
  for (const [key, value] of Object.entries(cadence)) {
    if (key.startsWith("_")) continue; // allow `_comment` and other annotations
    if (value !== "each" && value !== "once") continue;
    const p = safeCanonicalChannel(key);
    if (p) modes[p] = value;
  }
  return modes;
}

// Caption character limits per platform (caption text the API will accept).
const PLATFORM_LIMITS = {
  twitter: 280,
  instagram: 2200,
  pinterest: 500,
  linkedin: 3000,
  facebook: 63206,
  reddit: 40000,
  youtube: 5000,
};

const DEFAULT_INTERVAL_MINUTES = 60; // per-platform floor
const DEFAULT_PICKUP_INTERVAL_MINUTES = 90; // cron cadence base
const DEFAULT_PICKUP_JITTER_MINUTES = 11; // +/- jitter on the cadence
const TWITTER_MAX = PLATFORM_LIMITS.twitter;

// ---------------------------------------------------------------------------
// Channel normalisation
// ---------------------------------------------------------------------------

function canonicalChannel(token) {
  const t = String(token || "").trim().toLowerCase();
  if (!t) return null;
  if (t === "x" || t === "twitter") return "twitter";
  if (t === "fb") return "facebook";
  if (t === "ig" || t === "insta") return "instagram";
  if (t === "li") return "linkedin";
  if (t === "pin") return "pinterest";
  if (CANONICAL_PLATFORMS.includes(t)) return t;
  throw new Error(`Unknown channel: "${token}". Valid: ${[...CANONICAL_PLATFORMS, "x"].join(", ")}`);
}

/** Like canonicalChannel but returns null instead of throwing on unknown tokens. */
function safeCanonicalChannel(token) {
  try {
    return canonicalChannel(token);
  } catch {
    return null;
  }
}

function normalizeChannels(list) {
  const out = [];
  for (const token of list || []) {
    const c = canonicalChannel(token);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caption helpers
// ---------------------------------------------------------------------------

function firstParagraph(text) {
  return String(text || "").split(/\n\s*\n/)[0].trim();
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).find((l) => l.trim()) || "";
}

function collapseWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function truncate(text, len) {
  const s = String(text || "");
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}

/** Truncate a caption to a hard limit on a word boundary, adding an ellipsis. */
function truncateCaption(text, limit) {
  const s = String(text || "");
  if (s.length <= limit) return s;
  let cut = s.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > limit * 0.6) cut = cut.slice(0, lastSpace);
  return cut.trim() + "…";
}

/** Derive a short tweet (<= 280) from a long caption + link. */
function deriveTwitterText(caption, link, maxLen = TWITTER_MAX) {
  const url = String(link || "").trim();
  const base = collapseWhitespace(firstParagraph(caption));
  if (!url) return base.slice(0, maxLen);
  const reserve = url.length + 1;
  if (reserve >= maxLen) return url.slice(0, maxLen);
  const room = maxLen - reserve;
  if (base.length <= room) return `${base} ${url}`.trim();
  let cut = base.slice(0, room - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}… ${url}`.trim();
}

// ---------------------------------------------------------------------------
// Spec validation + expansion
// ---------------------------------------------------------------------------

/**
 * Validate captions against per-platform limits.
 * @returns {{ ok: boolean, violations: Array<{platform,batch,length,limit}> }}
 */
function validateSpecLimits(items) {
  const violations = [];
  for (const item of items) {
    for (const [platform, entry] of Object.entries(item.platforms)) {
      const limit = PLATFORM_LIMITS[platform];
      if (limit && entry.caption && entry.caption.length > limit) {
        violations.push({
          platform,
          batch: item.batch_index,
          length: entry.caption.length,
          limit,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

function makePostId() {
  return `post_${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

function makeItemId(batchIndex) {
  return `SOC-${Date.now().toString(36)}-${batchIndex}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function makePlatformEntry(imageUrl, caption) {
  return {
    image_url: String(imageUrl || ""),
    caption: String(caption || ""),
    status: "pending",
    sent_at: null,
    attempts: 0,
    error: null,
  };
}

/**
 * Expand a blog spec into ordered batch items.
 *
 * spec = {
 *   blog_url, channels?, post_id?,
 *   infographics: [ { image_url, captions: { facebook, instagram, pinterest } }, ... ],
 *   linkedin?: { image_url?, caption },
 *   x?:        { image_url?, caption }
 * }
 *
 * @param {object} opts
 * @param {object}  [opts.modes]    Per-platform cadence map ("each"|"once").
 *                                  Defaults to resolvePlatformModes({ spec }).
 * @param {boolean} [opts.truncate] Truncate over-limit captions instead of keeping raw.
 * @returns {{ items: object[], post_id: string, modes: object, cadence: object, validation: object }}
 */
function expandSpec(spec, opts = {}) {
  if (!spec || typeof spec !== "object") throw new Error("Spec must be an object");
  const blogUrl = String(spec.blog_url || spec.link || "").trim();
  if (!blogUrl) throw new Error("Spec is missing blog_url");

  const infographics = Array.isArray(spec.infographics) ? spec.infographics : [];
  if (infographics.length === 0) throw new Error("Spec needs at least one infographic");

  const channels = normalizeChannels(
    spec.channels && spec.channels.length ? spec.channels : DEFAULT_CHANNELS
  );
  const modes = opts.modes || resolvePlatformModes({ spec });
  const eachEnabled = channels.filter((p) => modes[p] === "each");
  const onceEnabled = channels.filter((p) => modes[p] === "once");
  if (eachEnabled.length === 0 && onceEnabled.length === 0) {
    throw new Error("No postable channels resolved from spec.channels");
  }

  const anyCaption = (captions) =>
    captions.facebook || captions.instagram || captions.pinterest ||
    captions.linkedin || captions.reddit || captions.twitter || "";

  const postId = spec.post_id || makePostId();
  const createdAt = opts.now || nowIso();
  const items = [];

  infographics.forEach((info, k) => {
    const image = String(info.image_url || info.image || "").trim();
    if (!image) throw new Error(`Infographic #${k} is missing image_url`);
    const captions = info.captions || {};
    const platforms = {};

    // "each" platforms post on every infographic with their own caption.
    for (const p of eachEnabled) {
      const cap = captions[p] != null && captions[p] !== "" ? String(captions[p]) : anyCaption(captions);
      platforms[p] = makePlatformEntry(image, cap);
    }

    // "once" platforms post a single time, riding in the first batch only.
    if (k === 0) {
      for (const p of onceEnabled) {
        const entry = specEntryFor(spec, p);
        let cap = entry.caption != null && entry.caption !== "" ? String(entry.caption) : (captions[p] || anyCaption(captions));
        if (!cap && p === "twitter") cap = deriveTwitterText(anyCaption(captions), blogUrl);
        platforms[p] = makePlatformEntry(entry.image_url || image, cap);
      }
    }

    items.push({
      id: makeItemId(k),
      post_id: postId,
      blog_url: blogUrl,
      batch_index: k,
      created_at: createdAt,
      platforms,
    });
  });

  const validation = validateSpecLimits(items);
  if (opts.truncate && !validation.ok) {
    for (const item of items) {
      for (const [platform, entry] of Object.entries(item.platforms)) {
        const limit = PLATFORM_LIMITS[platform];
        if (limit && entry.caption.length > limit) {
          entry.caption = truncateCaption(entry.caption, limit);
        }
      }
    }
  }

  // Compact cadence view limited to the channels actually used.
  const cadence = {};
  for (const p of [...new Set([...eachEnabled, ...onceEnabled])]) cadence[p] = modes[p];

  return { items, post_id: postId, modes, cadence, validation };
}

/** Convenience: build a one-infographic spec from simple inputs (legacy path). */
function specFromSimple({ caption, image, link, channels }) {
  const ch = normalizeChannels(channels && channels.length ? channels : DEFAULT_CHANNELS);
  return {
    blog_url: link,
    channels: ch,
    infographics: [
      {
        image_url: image,
        captions: { facebook: caption, instagram: caption, pinterest: caption },
      },
    ],
    linkedin: ch.includes("linkedin") ? { image_url: image, caption } : undefined,
    x: ch.includes("twitter") ? { image_url: image, caption: deriveTwitterText(caption, link) } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Queue persistence
// ---------------------------------------------------------------------------

function resolveQueuePath(explicit) {
  return (
    explicit ||
    process.env.SOCIAL_QUEUE_PATH ||
    path.resolve(process.cwd(), "tools", "out", "state", "social-queue.json")
  );
}

function emptyQueue() {
  const last_sent = {};
  for (const p of CANONICAL_PLATFORMS) last_sent[p] = null;
  return { version: 2, next_pickup_at: null, last_sent, items: [] };
}

function loadQueue(queuePath) {
  const resolved = resolveQueuePath(queuePath);
  if (!fs.existsSync(resolved)) return emptyQueue();
  try {
    const data = JSON.parse(fs.readFileSync(resolved, "utf8"));
    const base = emptyQueue();
    return {
      version: data.version || 2,
      next_pickup_at: data.next_pickup_at || null,
      last_sent: { ...base.last_sent, ...(data.last_sent || {}) },
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return emptyQueue();
  }
}

function saveQueue(queue, queuePath) {
  const resolved = resolveQueuePath(queuePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(queue, null, 2) + "\n", "utf8");
  return resolved;
}

// ---------------------------------------------------------------------------
// Drip scheduling
// ---------------------------------------------------------------------------

function intervalMs(minutes) {
  const m = Number(minutes);
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_INTERVAL_MINUTES) * 60_000;
}

function isDue(lastSentIso, now, ms) {
  if (!lastSentIso) return true;
  const last = Date.parse(lastSentIso);
  if (Number.isNaN(last)) return true;
  return now - last >= ms;
}

function nextDueAt(lastSentIso, ms) {
  if (!lastSentIso) return null;
  const last = Date.parse(lastSentIso);
  if (Number.isNaN(last)) return null;
  return new Date(last + ms).toISOString();
}

/** Next jittered pickup time: base ± random(0..jitter) minutes from `now`. */
function computeNextPickup(now, intervalMinutes, jitterMinutes) {
  const base = Number(intervalMinutes) > 0 ? Number(intervalMinutes) : DEFAULT_PICKUP_INTERVAL_MINUTES;
  const jitter = Number(jitterMinutes) >= 0 ? Number(jitterMinutes) : DEFAULT_PICKUP_JITTER_MINUTES;
  const offset = base + (Math.random() * 2 - 1) * jitter; // [base-jitter, base+jitter]
  return new Date(now + Math.max(1, offset) * 60_000).toISOString();
}

/**
 * Plan the next drain: for each platform that is due (per-platform floor), pick
 * the OLDEST pending batch still pending on that platform, then group picks by
 * batch item so one webhook call carries every due platform for that batch.
 *
 * @returns {Array<{ item, platforms: string[] }>}
 */
function planDrain(queue, { now = Date.now(), minutes = DEFAULT_INTERVAL_MINUTES, maxBatches = 0 } = {}) {
  const ms = intervalMs(minutes);
  const pending = queue.items.filter((it) =>
    Object.values(it.platforms).some((p) => p.status === "pending")
  );
  // Oldest blog first, then earliest batch within a blog.
  const ordered = [...pending].sort((a, b) => {
    const c = String(a.created_at).localeCompare(String(b.created_at));
    if (c !== 0) return c;
    return (a.batch_index || 0) - (b.batch_index || 0);
  });

  const picks = new Map();
  for (const platform of CANONICAL_PLATFORMS) {
    if (!isDue(queue.last_sent[platform], now, ms)) continue;
    const item = ordered.find(
      (it) => it.platforms[platform] && it.platforms[platform].status === "pending"
    );
    if (!item) continue;
    if (!picks.has(item.id)) picks.set(item.id, { item, platforms: [] });
    picks.get(item.id).platforms.push(platform);
  }

  let groups = ordered.filter((it) => picks.has(it.id)).map((it) => picks.get(it.id));
  if (maxBatches > 0) groups = groups.slice(0, maxBatches);
  return groups;
}

// ---------------------------------------------------------------------------
// Webhook payload builder
// ---------------------------------------------------------------------------

function originOf(url) {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "";
  }
}

/**
 * Build the full webhook payload for ONE batch.
 * Each platform carries its own image + caption (`item.platforms[p]`).
 *
 * @param {object} item    Batch item (platforms{} with image_url + caption).
 * @param {string[]} routed Platforms to actually fire in this call.
 * @param {object} cfg     Env accessor (loadToolEnv result; has .get).
 * @param {object} [opts]  { now: Date }
 */
function buildWebhookPayload(item, routed, cfg, opts = {}) {
  const now = opts.now || new Date();
  const get = (name, dflt = "") => (cfg && cfg.get ? cfg.get(name, dflt) : dflt) || dflt;

  const link = item.blog_url || "";
  const websiteUrl = get("SOCIAL_WEBSITE_URL", originOf(link));

  const pimg = (p) => (item.platforms[p] ? item.platforms[p].image_url : "") || "";
  const pcap = (p) => (item.platforms[p] ? item.platforms[p].caption : "") || "";

  const routedSet = new Set(routed);
  const enabledSet = new Set(Object.keys(item.platforms));
  const isRouted = (p) => routedSet.has(p);
  const yn = (p) => (isRouted(p) ? "yes" : "no");

  // Representative image/caption for the generic "main_*" fields.
  const repPlatform = ["facebook", "instagram", "pinterest", "linkedin", "twitter"].find(
    (p) => routedSet.has(p) && pimg(p)
  ) || routed[0];
  const mainImage = pimg(repPlatform);
  const mainCaption = pcap(repPlatform);
  const mainTitle = firstLine(mainCaption) || truncate(mainCaption, 90);

  const profileUrls = {
    reddit: get("SOCIAL_REDDIT_PROFILE_URL"),
    pinterest: get("SOCIAL_PINTEREST_PROFILE_URL"),
    linkedin: get("SOCIAL_LINKEDIN_PROFILE_URL"),
    twitter: get("SOCIAL_TWITTER_PROFILE_URL"),
    facebook: get("SOCIAL_FACEBOOK_PROFILE_URL"),
    instagram: get("SOCIAL_INSTAGRAM_PROFILE_URL"),
    website: websiteUrl,
  };

  const fbPage = get("SOCIAL_FACEBOOK_PAGE");
  const igPage = get("SOCIAL_INSTAGRAM_PAGE");
  const liCompany = get("SOCIAL_LINKEDIN_COMPANY");
  const pinBoard = get("SOCIAL_PINTEREST_BOARD");
  const pinBoardUrl = get("SOCIAL_PINTEREST_BOARD_URL");

  const selected_platforms = {};
  const routes = {};
  const sendFlags = {};
  const ynFlags = {};
  const routeFlags = {};
  for (const p of CANONICAL_PLATFORMS) {
    selected_platforms[p] = enabledSet.has(p);
    routes[p] = yn(p);
    sendFlags[`send_${p}`] = isRouted(p);
    ynFlags[`${p}_yes_no`] = yn(p);
    routeFlags[`route_${p}`] = yn(p);
  }
  routes.x = yn("twitter");
  ynFlags.x_yes_no = yn("twitter");
  routeFlags.route_x = yn("twitter");

  const activePlatforms = CANONICAL_PLATFORMS.filter(isRouted);
  const liImg = pimg("linkedin");
  const liFileName = liImg ? liImg.split("/").pop() : "";

  const payload = {
    sent_at: now.toISOString(),
    post_id: item.post_id,
    batch_index: item.batch_index,

    active_platforms: activePlatforms,
    active_platforms_csv: activePlatforms.join(","),
    selected_platforms,
    routes,

    ...sendFlags,
    send_x: isRouted("twitter"),
    ...ynFlags,
    ...routeFlags,

    profile_urls: profileUrls,
    reddit_profile_url: profileUrls.reddit,
    pinterest_profile_url: profileUrls.pinterest,
    linkedin_profile_url: profileUrls.linkedin,
    x_profile_url: profileUrls.twitter,
    twitter_profile_url: profileUrls.twitter,
    facebook_profile_url: profileUrls.facebook,
    instagram_profile_url: profileUrls.instagram,
    website_url: websiteUrl,

    main_caption: mainCaption,
    main_title: mainTitle,
    main_image_url: mainImage,
    main_link_url: websiteUrl,
    image_url: mainImage,
    direct_image_url: mainImage,
    public_image_url: mainImage,
    link_url: websiteUrl,
    main: {
      caption: mainCaption,
      title: mainTitle,
      image_url: mainImage,
      direct_image_url: mainImage,
      link_url: websiteUrl,
    },

    // reddit
    srName: get("SOCIAL_REDDIT_SUBREDDIT"),
    reddit_subreddit_display_name: get("SOCIAL_REDDIT_SUBREDDIT"),
    reddit_title: isRouted("reddit") ? (firstLine(pcap("reddit")) || mainTitle) : "",
    reddit_url: "",
    reddit_link_url: isRouted("reddit") ? link : "",
    reddit_image_url: pimg("reddit"),
    reddit_text: pcap("reddit"),
    reddit_data: pimg("reddit"),
    reddit: {
      ...blockOff("reddit", enabledSet, routedSet),
      subreddit: get("SOCIAL_REDDIT_SUBREDDIT"),
      srName: get("SOCIAL_REDDIT_SUBREDDIT"),
      title: isRouted("reddit") ? (firstLine(pcap("reddit")) || mainTitle) : "",
      link: isRouted("reddit") ? link : "",
      image_url: pimg("reddit"),
      text: pcap("reddit"),
      data: pimg("reddit"),
    },

    // linkedin
    linkedin_company: liCompany,
    linkedin_image_url: liImg,
    linkedin_file_url: liImg,
    linkedin_file_name: liFileName,
    linkedin_title: truncate(pcap("linkedin"), 70),
    linkedin_alt_text: truncate(pcap("linkedin"), 110),
    linkedin_content: pcap("linkedin"),
    linkedin_data: liImg,
    linkedin: {
      ...blockOff("linkedin", enabledSet, routedSet),
      company: liCompany,
      upload_method: "Upload by file",
      image_url: liImg,
      file_url: liImg,
      data: liImg,
      file_name: liFileName,
      title: truncate(pcap("linkedin"), 70),
      alt_text: truncate(pcap("linkedin"), 110),
      content: pcap("linkedin"),
    },

    // facebook
    facebook_page: fbPage,
    facebook_photo_url: pimg("facebook"),
    facebook_caption: pcap("facebook"),
    facebook_data: pimg("facebook"),
    facebook: {
      ...blockOff("facebook", enabledSet, routedSet),
      page: fbPage,
      photo_url: pimg("facebook"),
      post_caption: pcap("facebook"),
      data: pimg("facebook"),
    },

    // pinterest
    pinterest_image_url: pimg("pinterest"),
    pinterest_board: pinBoard,
    pinterest_board_name: pinBoard,
    pinterest_board_url: pinBoardUrl,
    pinterest_pin_name: "",
    pinterest_pin_title: "",
    pinterest_title: "",
    pinterest_link: link,
    pinterest_description: pcap("pinterest"),
    pinterest_data: pimg("pinterest"),
    pinterest: {
      ...blockOff("pinterest", enabledSet, routedSet),
      image_url: pimg("pinterest"),
      board: pinBoard,
      board_name: pinBoard,
      board_url: pinBoardUrl,
      profile_url: profileUrls.pinterest,
      pin_name: "",
      pin_title: "",
      title: "",
      link,
      description: pcap("pinterest"),
      data: pimg("pinterest"),
    },

    // youtube (off)
    youtube_title: "",
    youtube_data: "",
    youtube_description: pcap("youtube"),
    youtube: blockOff("youtube", enabledSet, routedSet, { data: "" }),

    // instagram
    instagram_page: igPage,
    instagram_photo_url: pimg("instagram"),
    instagram_image_url: pimg("instagram"),
    instagram_media_link: link,
    instagram_caption: pcap("instagram"),
    instagram_text: pcap("instagram"),
    instagram_direct_image_url: pimg("instagram"),
    instagram_data: pimg("instagram"),
    instagram: {
      ...blockOff("instagram", enabledSet, routedSet),
      page: igPage,
      photo_url: pimg("instagram"),
      image_url: pimg("instagram"),
      media_link: link,
      caption: pcap("instagram"),
      data: pimg("instagram"),
    },
  };

  // twitter / x
  const tw = pcap("twitter");
  const twImg = pimg("twitter");
  const twTrunc = truncate(tw, 240);
  const twitterBlock = {
    ...blockOff("twitter", enabledSet, routedSet),
    buffer_text: twTrunc,
    text: twTrunc,
    text_full: tw,
    caption: twTrunc,
    buffer_image_url: twImg,
    buffer_link_to_image: twImg,
    image_url: twImg,
    media_link: twImg,
    link_url: websiteUrl,
    data: twImg,
    character_count: tw.length,
  };
  Object.assign(payload, {
    x_buffer_text: twTrunc,
    x_text: twTrunc,
    x_text_full: tw,
    x_caption: twTrunc,
    x_buffer_image_url: twImg,
    x_buffer_link_to_image: twImg,
    x_image_url: twImg,
    x_media_link: twImg,
    x_link_url: websiteUrl,
    x_data: twImg,
    x_character_count: tw.length,
    twitter_buffer_text: twTrunc,
    twitter_text: twTrunc,
    twitter_text_full: tw,
    twitter_caption: twTrunc,
    twitter_buffer_image_url: twImg,
    twitter_buffer_link_to_image: twImg,
    twitter_image_url: twImg,
    twitter_media_link: twImg,
    twitter_link_url: websiteUrl,
    twitter_data: twImg,
    twitter_character_count: tw.length,
    twitter: twitterBlock,
    x: { ...twitterBlock },
  });

  return payload;
}

function blockOff(platform, enabledSet, routedSet, extra = {}) {
  const routed = routedSet.has(platform);
  return {
    enabled: enabledSet.has(platform),
    send: routed,
    yes_no: routed ? "yes" : "no",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

async function postToWebhook(url, payload, opts = {}) {
  if (!url) throw new Error("Missing SOCIAL_WEBHOOK_URL");
  const body = opts.arrayWrap ? [payload] : payload;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Webhook responded ${res.status}: ${truncate(text, 300)}`);
    return { status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

function isWebpUrl(url) {
  return /\.webp(\?|#|$)/i.test(String(url || ""));
}

/**
 * Advisory: detect copy-pasted captions. Each platform should get a UNIQUE,
 * platform-optimised caption. Returns human-readable warnings (non-fatal) for:
 *   - two platforms in the same batch sharing an identical caption, and
 *   - an "each" platform reusing the same caption across infographics.
 */
function captionDuplicationWarnings(items) {
  const warnings = [];
  const norm = (s) => String(s || "").trim();

  // (a) identical captions across platforms within the same batch.
  for (const item of items) {
    const seen = new Map(); // caption -> [platforms]
    for (const [p, entry] of Object.entries(item.platforms)) {
      const c = norm(entry.caption);
      if (!c) continue;
      if (!seen.has(c)) seen.set(c, []);
      seen.get(c).push(p);
    }
    for (const [, platforms] of seen) {
      if (platforms.length > 1) {
        warnings.push(
          `Batch ${item.batch_index}: identical caption on ${platforms.sort().join(" + ")} — write a unique caption per platform.`
        );
      }
    }
  }

  // (b) same platform reusing one caption across multiple infographics.
  const byPlatform = {};
  for (const item of items) {
    for (const [p, entry] of Object.entries(item.platforms)) {
      const c = norm(entry.caption);
      if (!c) continue;
      (byPlatform[p] ||= []).push(c);
    }
  }
  for (const [p, caps] of Object.entries(byPlatform)) {
    const uniq = new Set(caps);
    if (caps.length > 1 && uniq.size < caps.length) {
      warnings.push(
        `${p}: the same caption is reused across infographics — each infographic should get its own caption.`
      );
    }
  }

  return warnings;
}

module.exports = {
  CANONICAL_PLATFORMS,
  EACH_PLATFORMS,
  SINGLE_PLATFORMS,
  DEFAULT_PLATFORM_MODES,
  DEFAULT_CHANNELS,
  PLATFORM_LIMITS,
  resolvePlatformModes,
  specEntryFor,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_PICKUP_INTERVAL_MINUTES,
  DEFAULT_PICKUP_JITTER_MINUTES,
  canonicalChannel,
  normalizeChannels,
  deriveTwitterText,
  truncateCaption,
  validateSpecLimits,
  expandSpec,
  specFromSimple,
  resolveQueuePath,
  emptyQueue,
  loadQueue,
  saveQueue,
  makePostId,
  intervalMs,
  isDue,
  nextDueAt,
  computeNextPickup,
  planDrain,
  buildWebhookPayload,
  postToWebhook,
  isWebpUrl,
  captionDuplicationWarnings,
};
