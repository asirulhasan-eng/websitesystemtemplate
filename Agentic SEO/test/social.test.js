const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const social = require("../cli/lib/social");

function sampleSpec(nInfographics = 3) {
  const infographics = [];
  for (let i = 0; i < nInfographics; i++) {
    infographics.push({
      image_url: `https://img/info-${i}.png`,
      captions: {
        facebook: `FB caption ${i}`,
        instagram: `IG caption ${i}`,
        pinterest: `Pin caption ${i}`,
      },
    });
  }
  return {
    blog_url: "https://e.com/blog/post",
    channels: ["facebook", "instagram", "pinterest", "linkedin", "x"],
    infographics,
    linkedin: { image_url: "https://img/hero.png", caption: "LinkedIn caption" },
    x: { image_url: "https://img/hero.png", caption: "Short tweet" },
  };
}

test("normalizeChannels maps aliases and dedupes", () => {
  assert.deepStrictEqual(
    social.normalizeChannels(["x", "fb", "ig", "pin", "facebook", "li"]),
    ["twitter", "facebook", "instagram", "pinterest", "linkedin"]
  );
});

test("expandSpec: singles ride only in batch 0, FB/IG/Pin in every batch", () => {
  const { items, post_id } = social.expandSpec(sampleSpec(3));
  assert.strictEqual(items.length, 3);
  // all share the same blog post id
  assert.ok(items.every((it) => it.post_id === post_id));

  // batch 0 has FB/IG/Pin + LinkedIn + X
  assert.deepStrictEqual(
    Object.keys(items[0].platforms).sort(),
    ["facebook", "instagram", "linkedin", "pinterest", "twitter"]
  );
  // batches 1+ are FB/IG/Pin only
  assert.deepStrictEqual(Object.keys(items[1].platforms).sort(), ["facebook", "instagram", "pinterest"]);
  assert.deepStrictEqual(Object.keys(items[2].platforms).sort(), ["facebook", "instagram", "pinterest"]);

  // per-infographic image + unique caption
  assert.strictEqual(items[2].platforms.facebook.image_url, "https://img/info-2.png");
  assert.strictEqual(items[2].platforms.facebook.caption, "FB caption 2");
  assert.strictEqual(items[0].platforms.twitter.caption, "Short tweet");
  assert.strictEqual(items[0].platforms.linkedin.image_url, "https://img/hero.png");
});

test("resolvePlatformModes: env lists and spec.cadence override defaults", () => {
  // default
  assert.strictEqual(social.resolvePlatformModes().reddit, "once");
  // env forces reddit to each
  let modes = social.resolvePlatformModes({ perInfographic: ["reddit"] });
  assert.strictEqual(modes.reddit, "each");
  // spec.cadence beats env
  modes = social.resolvePlatformModes({
    perInfographic: ["reddit"],
    spec: { cadence: { reddit: "once", pinterest: "once" } },
  });
  assert.strictEqual(modes.reddit, "once");
  assert.strictEqual(modes.pinterest, "once");
});

test("expandSpec: adding reddit as a once-platform posts it in batch 0 only", () => {
  const spec = sampleSpec(2);
  spec.channels = ["facebook", "instagram", "pinterest", "reddit"];
  spec.reddit = { caption: "Reddit discussion post", image_url: "https://img/r.png" };
  const { items, cadence } = social.expandSpec(spec);
  assert.strictEqual(cadence.reddit, "once");
  assert.ok(Object.keys(items[0].platforms).includes("reddit"));
  assert.ok(!Object.keys(items[1].platforms).includes("reddit"));
  assert.strictEqual(items[0].platforms.reddit.caption, "Reddit discussion post");
});

test("expandSpec: cadence override flips pinterest to once (batch 0 only)", () => {
  const spec = sampleSpec(3);
  spec.cadence = { pinterest: "once" };
  spec.pinterest = { caption: "single pinterest" };
  const { items } = social.expandSpec(spec);
  assert.ok(Object.keys(items[0].platforms).includes("pinterest"));
  assert.ok(!Object.keys(items[1].platforms).includes("pinterest"));
  assert.ok(!Object.keys(items[2].platforms).includes("pinterest"));
  // facebook still per-infographic
  assert.ok(Object.keys(items[2].platforms).includes("facebook"));
});

test("buildWebhookPayload carries reddit fields when routed", () => {
  const spec = sampleSpec(1);
  spec.channels = ["facebook", "reddit"];
  spec.reddit = { caption: "Reddit body text", image_url: "https://img/r.png" };
  const { items } = social.expandSpec(spec);
  const cfg = { get: (n, d = "") => (n === "SOCIAL_REDDIT_SUBREDDIT" ? "smallbusiness" : d) };
  const payload = social.buildWebhookPayload(items[0], ["reddit"], cfg);
  assert.strictEqual(payload.send_reddit, true);
  assert.strictEqual(payload.reddit.text, "Reddit body text");
  assert.strictEqual(payload.reddit.subreddit, "smallbusiness");
  assert.strictEqual(payload.reddit_image_url, "https://img/r.png");
});

test("expandSpec validates character limits", () => {
  const spec = sampleSpec(1);
  spec.x.caption = "x".repeat(400); // over 280
  spec.infographics[0].captions.pinterest = "p".repeat(600); // over 500
  const { validation } = social.expandSpec(spec);
  assert.strictEqual(validation.ok, false);
  const platforms = validation.violations.map((v) => v.platform).sort();
  assert.deepStrictEqual(platforms, ["pinterest", "twitter"]);
});

test("expandSpec --truncate brings captions within limits", () => {
  const spec = sampleSpec(1);
  spec.x.caption = "word ".repeat(100);
  const { items, validation } = social.expandSpec(spec, { truncate: true });
  assert.strictEqual(validation.ok, false); // pre-truncate report
  assert.ok(items[0].platforms.twitter.caption.length <= social.PLATFORM_LIMITS.twitter);
});

test("planDrain drains one batch per platform per run, oldest batch first", () => {
  const queue = social.emptyQueue();
  const { items } = social.expandSpec(sampleSpec(3));
  queue.items.push(...items);

  // Run 1: batch 0 → FB/IG/Pin/LI/X together (one group).
  let groups = social.planDrain(queue, { now: Date.parse("2026-06-08T12:00:00Z"), minutes: 60 });
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].item.batch_index, 0);
  assert.deepStrictEqual(groups[0].platforms.sort(), ["facebook", "instagram", "linkedin", "pinterest", "twitter"]);

  // Simulate the send: mark batch 0 sent, set last_sent.
  for (const p of groups[0].platforms) {
    groups[0].item.platforms[p].status = "sent";
    queue.last_sent[p] = "2026-06-08T12:00:00Z";
  }

  // Run 2 immediately: platforms still within the 60-min floor → nothing.
  groups = social.planDrain(queue, { now: Date.parse("2026-06-08T12:30:00Z"), minutes: 60 });
  assert.strictEqual(groups.length, 0);

  // Run 3 after the floor: batch 1 → FB/IG/Pin only (LI/X already done).
  groups = social.planDrain(queue, { now: Date.parse("2026-06-08T13:05:00Z"), minutes: 60 });
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].item.batch_index, 1);
  assert.deepStrictEqual(groups[0].platforms.sort(), ["facebook", "instagram", "pinterest"]);
});

test("computeNextPickup stays within the jitter window", () => {
  const now = Date.parse("2026-06-08T12:00:00Z");
  for (let i = 0; i < 50; i++) {
    const next = Date.parse(social.computeNextPickup(now, 90, 11));
    const deltaMin = (next - now) / 60000;
    assert.ok(deltaMin >= 79 && deltaMin <= 101, `delta ${deltaMin} out of 79..101`);
  }
});

test("buildWebhookPayload uses per-platform image + caption and routes subset", () => {
  const { items } = social.expandSpec(sampleSpec(2));
  const cfg = { get: (_n, d = "") => d };
  const payload = social.buildWebhookPayload(items[0], ["facebook", "pinterest"], cfg);

  assert.deepStrictEqual(payload.active_platforms, ["facebook", "pinterest"]);
  assert.strictEqual(payload.send_facebook, true);
  assert.strictEqual(payload.send_instagram, false);
  assert.strictEqual(payload.routes.x, "no");
  assert.strictEqual(payload.facebook.post_caption, "FB caption 0");
  assert.strictEqual(payload.facebook_photo_url, "https://img/info-0.png");
  assert.strictEqual(payload.pinterest_description, "Pin caption 0");
  // batch index travels in the payload
  assert.strictEqual(payload.batch_index, 0);
});

test("save/load queue round-trips with next_pickup_at", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  const qp = path.join(dir, "q.json");
  const queue = social.emptyQueue();
  queue.next_pickup_at = "2026-06-08T13:30:00Z";
  const { items } = social.expandSpec(sampleSpec(1));
  queue.items.push(...items);
  social.saveQueue(queue, qp);

  const loaded = social.loadQueue(qp);
  assert.strictEqual(loaded.next_pickup_at, "2026-06-08T13:30:00Z");
  assert.strictEqual(loaded.items.length, 1);
  assert.strictEqual(loaded.items[0].platforms.facebook.status, "pending");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("captionDuplicationWarnings flags copy-paste and reuse", () => {
  const spec = sampleSpec(2);
  // identical FB + IG in batch 0
  spec.infographics[0].captions.facebook = "SAME";
  spec.infographics[0].captions.instagram = "SAME";
  // pinterest reused across both infographics
  spec.infographics[0].captions.pinterest = "REUSED";
  spec.infographics[1].captions.pinterest = "REUSED";
  const { items } = social.expandSpec(spec);
  const warns = social.captionDuplicationWarnings(items);
  assert.ok(warns.some((w) => /identical caption on facebook \+ instagram/i.test(w)));
  assert.ok(warns.some((w) => /pinterest: the same caption is reused/i.test(w)));
});

test("captionDuplicationWarnings is empty for fully-unique captions", () => {
  const { items } = social.expandSpec(sampleSpec(3));
  assert.deepStrictEqual(social.captionDuplicationWarnings(items), []);
});

test("isWebpUrl detects webp", () => {
  assert.strictEqual(social.isWebpUrl("https://x/y.webp"), true);
  assert.strictEqual(social.isWebpUrl("https://x/y.webp?v=2"), true);
  assert.strictEqual(social.isWebpUrl("https://x/y.png"), false);
});
