/**
 * social-send.js — Drain the social pipeline (run by cron ~every 90 ± 11 min).
 *
 * Honours a jittered global pickup cadence AND a per-platform floor:
 *   - Global gate: only acts once `next_pickup_at` has passed (default 90 ± 11
 *     min after the last send). --force ignores this gate.
 *   - Per-platform floor: a platform never posts more often than
 *     SOCIAL_MIN_INTERVAL_MINUTES (default 60).
 *
 * On each pickup it sends the next batch(es): for every due platform it takes
 * the oldest pending batch, groups them per batch, and POSTs one webhook call
 * per batch (each platform carrying its own image + caption). Default 1 batch
 * per run; raise with --max-batches.
 *
 * Usage:
 *   v2 social send
 *   v2 social send --dry-run
 *   v2 social send --force --max-batches 2
 *
 * Options:
 *   --max-batches N   Max batches (webhook calls) this run (default 1)
 *   --interval        Per-platform floor minutes (default: env or 60)
 *   --pickup-interval Cadence base minutes (default: env or 90)
 *   --jitter          Cadence jitter minutes (default: env or 11)
 *   --force           Ignore the global pickup gate
 *   --array           Wrap webhook body as [ {…} ]
 *   --queue           Override queue file path
 *   --dry-run         Plan + build payloads, but do not send or mutate the queue
 *   --json            JSON output (default)
 *   --help            Show this help
 */

const { parseArgs, numberArg, boolArg, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { loadToolEnv } = require("../lib/env");
const { nowIso } = require("../lib/dates");
const social = require("../lib/social");

const TOOL = "social-send";

const HELP = `
social-send — Drain the social pipeline (jittered drip)

USAGE
  v2 social send [options]

OPTIONS
  --max-batches N   Max batches (webhook calls) this run (default 1)
  --interval        Per-platform floor minutes (default: env or 60)
  --pickup-interval Cadence base minutes (default: env or 90)
  --jitter          Cadence jitter minutes (default: env or 11)
  --force           Ignore the global pickup gate
  --array           Wrap webhook body as [ {…} ]
  --queue           Override queue file path
  --dry-run         Plan + build payloads, do not send or mutate the queue
  --json            JSON output (default)
  --help            Show this help

Run frequently so the jittered gate fires near target, e.g. cron:
  */15 * * * *  v2 social send --json
`.trim();

module.exports = async function socialSend() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const config = loadToolEnv({ envPath: args.env });
    const minutes = numberArg(args, "interval", Number(config.get("SOCIAL_MIN_INTERVAL_MINUTES", social.DEFAULT_INTERVAL_MINUTES)));
    const pickupInterval = numberArg(args, "pickup-interval", Number(config.get("SOCIAL_PICKUP_INTERVAL_MINUTES", social.DEFAULT_PICKUP_INTERVAL_MINUTES)));
    const jitter = numberArg(args, "jitter", Number(config.get("SOCIAL_PICKUP_JITTER_MINUTES", social.DEFAULT_PICKUP_JITTER_MINUTES)));
    const arrayWrap = boolArg(args, "array", String(config.get("SOCIAL_PAYLOAD_ARRAY", "false")) === "true");
    const maxBatches = numberArg(args, "max-batches", 1);
    const force = Boolean(args.force);
    const dryRun = Boolean(args["dry-run"]);
    const nowMs = Date.now();

    const queue = social.loadQueue(args.queue);

    // ---- Global pickup gate (jittered cadence) ----
    if (!force && queue.next_pickup_at && nowMs < Date.parse(queue.next_pickup_at)) {
      printOutput(envelope({
        sent: 0,
        waiting: true,
        next_pickup_at: queue.next_pickup_at,
        pending_items: queue.items.length,
        message: `Holding until next pickup (${queue.next_pickup_at}). Use --force to override.`,
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    const groups = social.planDrain(queue, { now: nowMs, minutes, maxBatches });

    if (groups.length === 0) {
      printOutput(envelope({
        dry_run: dryRun,
        sent: 0,
        pending_items: queue.items.length,
        message: "Nothing due to send.",
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    const webhookUrl = config.get("SOCIAL_WEBHOOK_URL");
    if (!dryRun && !webhookUrl) throw new Error("Missing SOCIAL_WEBHOOK_URL");

    const results = [];
    for (const { item, platforms } of groups) {
      const payload = social.buildWebhookPayload(item, platforms, config);

      if (dryRun) {
        results.push({ post_id: item.post_id, batch_index: item.batch_index, platforms, status: "planned" });
        continue;
      }

      try {
        const res = await social.postToWebhook(webhookUrl, payload, { arrayWrap });
        const sentAt = nowIso();
        for (const p of platforms) {
          item.platforms[p].status = "sent";
          item.platforms[p].sent_at = sentAt;
          item.platforms[p].attempts += 1;
          item.platforms[p].error = null;
          queue.last_sent[p] = sentAt;
        }
        results.push({ post_id: item.post_id, batch_index: item.batch_index, platforms, status: "sent", webhook_status: res.status });
      } catch (err) {
        for (const p of platforms) {
          item.platforms[p].attempts += 1;
          item.platforms[p].error = err.message;
        }
        results.push({ post_id: item.post_id, batch_index: item.batch_index, platforms, status: "failed", error: err.message });
      }
    }

    let queuePath = social.resolveQueuePath(args.queue);
    const sentCount = results.filter((r) => r.status === "sent").length;

    if (!dryRun) {
      // Drop fully-sent batches.
      queue.items = queue.items.filter((it) =>
        Object.values(it.platforms).some((p) => p.status !== "sent")
      );
      // Schedule the next jittered pickup only if we actually posted something.
      if (sentCount > 0) {
        queue.next_pickup_at = social.computeNextPickup(nowMs, pickupInterval, jitter);
      }
      queuePath = social.saveQueue(queue, args.queue);
    }

    printOutput(envelope({
      dry_run: dryRun,
      sent: sentCount,
      attempted: results.length,
      remaining_items: queue.items.length,
      next_pickup_at: queue.next_pickup_at,
      queue_path: queuePath,
      results,
    }, { tool: TOOL }), getOutputFormat(args));

    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
