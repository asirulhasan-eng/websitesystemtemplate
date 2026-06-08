/**
 * social-status.js — Inspect the social pipeline.
 *
 * Shows the global pickup gate, per-platform last-sent/next-eligible, and the
 * queued batches grouped by blog (post_id) with per-platform status.
 *
 * Usage:
 *   v2 social status
 *   v2 social status --table
 *
 * Options:
 *   --interval   Per-platform floor minutes (default: env or 60)
 *   --queue      Override queue file path
 *   --json       JSON output (default)
 *   --table      One row per pending platform entry
 *   --help       Show this help
 */

const { parseArgs, numberArg, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { loadToolEnv } = require("../lib/env");
const social = require("../lib/social");

const TOOL = "social-status";

const HELP = `
social-status — Inspect the social pipeline

USAGE
  v2 social status [options]

OPTIONS
  --interval   Per-platform floor minutes (default: env or 60)
  --queue      Override queue file path
  --json       JSON output (default)
  --table      One row per pending platform entry
  --help       Show this help
`.trim();

module.exports = async function socialStatus() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const config = loadToolEnv({ envPath: args.env });
    const minutes = numberArg(args, "interval", Number(config.get("SOCIAL_MIN_INTERVAL_MINUTES", social.DEFAULT_INTERVAL_MINUTES)));
    const ms = social.intervalMs(minutes);
    const now = Date.now();

    const queue = social.loadQueue(args.queue);

    const platformDue = {};
    for (const p of social.CANONICAL_PLATFORMS) {
      platformDue[p] = {
        last_sent: queue.last_sent[p],
        due: social.isDue(queue.last_sent[p], now, ms),
        next_eligible: social.nextDueAt(queue.last_sent[p], ms) || "now",
      };
    }

    if (getOutputFormat(args) === "table") {
      const rows = [];
      for (const it of queue.items) {
        for (const [p, entry] of Object.entries(it.platforms)) {
          rows.push({
            post_id: it.post_id,
            batch: it.batch_index,
            platform: p,
            status: entry.status,
            attempts: entry.attempts,
            chars: (entry.caption || "").length,
            next: platformDue[p] ? platformDue[p].next_eligible : "",
          });
        }
      }
      printOutput(rows, "table");
      return;
    }

    const pendingCount = queue.items.reduce(
      (n, it) => n + Object.values(it.platforms).filter((p) => p.status === "pending").length,
      0
    );

    // Group batches by blog post for a readable overview.
    const byPost = {};
    for (const it of queue.items) {
      (byPost[it.post_id] ||= {
        post_id: it.post_id,
        blog_url: it.blog_url,
        batches: [],
      }).batches.push({
        batch_index: it.batch_index,
        platforms: Object.fromEntries(
          Object.entries(it.platforms).map(([p, e]) => [p, { status: e.status, chars: (e.caption || "").length, attempts: e.attempts, error: e.error }])
        ),
      });
    }

    printOutput(envelope({
      interval_minutes: minutes,
      next_pickup_at: queue.next_pickup_at || "due now",
      pickup_waiting: Boolean(queue.next_pickup_at && now < Date.parse(queue.next_pickup_at)),
      batches: queue.items.length,
      pending_platform_entries: pendingCount,
      platforms: platformDue,
      blogs: Object.values(byPost),
    }, { tool: TOOL }), "json");
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
