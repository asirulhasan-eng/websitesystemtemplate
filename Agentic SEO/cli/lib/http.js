const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Shared HTTP response parser (extracted from gsc.js, serper.js, dataforseo.js)
// ---------------------------------------------------------------------------

/**
 * Read a fetch() Response as parsed JSON, with a safe fallback.
 * @param {Response} response - fetch() Response object
 * @returns {Promise<object>}
 */
async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// ---------------------------------------------------------------------------
// Simple in-process rate limiter (token bucket)
// ---------------------------------------------------------------------------

/**
 * Creates a rate limiter that enforces a maximum number of requests per window.
 *
 * @param {object} options
 * @param {number} options.maxRequests - Maximum requests allowed per window
 * @param {number} options.windowMs - Window duration in milliseconds (default: 60000 = 1 minute)
 * @returns {{ check(): boolean, wait(): Promise<void>, remaining(): number }}
 */
function createRateLimiter({ maxRequests, windowMs = 60_000 }) {
  const timestamps = [];

  function prune() {
    const cutoff = Date.now() - windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }
  }

  return {
    /**
     * Check if a request is allowed. If so, records it and returns true.
     * If rate limit exceeded, returns false.
     */
    check() {
      prune();
      if (timestamps.length >= maxRequests) return false;
      timestamps.push(Date.now());
      return true;
    },

    /**
     * Wait until a request is allowed, then record it.
     * Blocks execution with a sleep loop.
     */
    async wait() {
      prune();
      while (timestamps.length >= maxRequests) {
        const oldest = timestamps[0];
        const sleepMs = oldest + windowMs - Date.now() + 50;
        if (sleepMs > 0) await sleep(sleepMs);
        prune();
      }
      timestamps.push(Date.now());
    },

    /** Returns how many requests remain in the current window. */
    remaining() {
      prune();
      return Math.max(0, maxRequests - timestamps.length);
    },
  };
}

// ---------------------------------------------------------------------------
// Daily budget tracker (persisted as JSON on disk)
// ---------------------------------------------------------------------------

/**
 * Creates a daily budget tracker that persists usage to a JSON file.
 * Tracks credits/cost consumed per calendar day and blocks calls when exhausted.
 *
 * @param {object} options
 * @param {string} options.name - Tracker name (e.g., 'dataforseo', 'imap')
 * @param {number} options.dailyLimit - Maximum credits/cost per day
 * @param {string} [options.unit] - Unit label (default: 'credits')
 * @param {string} [options.storePath] - Path to the JSON tracker file
 * @returns {{ consume(amount: number): { allowed: boolean, used: number, remaining: number, message?: string }, usage(): { date: string, used: number, remaining: number } }}
 */
function createBudgetTracker({ name, dailyLimit, unit = "credits", storePath }) {
  const resolvedPath =
    storePath ||
    path.resolve(process.cwd(), `tools/out/state/budget-${name}.json`);

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function load() {
    try {
      if (fs.existsSync(resolvedPath)) {
        const data = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
        if (data.date === todayKey()) return data;
      }
    } catch {
      // corrupted file — reset
    }
    return { date: todayKey(), used: 0, notified: false };
  }

  function save(data) {
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  return {
    /**
     * Attempt to consume `amount` from today's budget.
     * Returns { allowed, used, remaining } and a message if limit hit.
     */
    consume(amount = 1) {
      const data = load();
      const remaining = dailyLimit - data.used;

      if (remaining < amount) {
        // Budget exhausted — notify once
        if (!data.notified) {
          data.notified = true;
          save(data);
          console.error(
            `[BUDGET] ${name}: Daily ${unit} budget exhausted. ` +
              `Used: ${data.used}/${dailyLimit} ${unit}. ` +
              `Requests blocked until ${data.date}T23:59:59.`
          );
        }
        return {
          allowed: false,
          used: data.used,
          remaining: 0,
          message:
            `${name} daily ${unit} budget exhausted ` +
            `(${data.used}/${dailyLimit} ${unit}). Try again tomorrow.`,
        };
      }

      data.used += amount;
      save(data);

      // Warn when 90% consumed
      const newRemaining = dailyLimit - data.used;
      if (newRemaining <= dailyLimit * 0.1 && !data.notified) {
        console.error(
          `[BUDGET] ${name}: 90% of daily ${unit} budget consumed ` +
            `(${data.used}/${dailyLimit} ${unit}).`
        );
      }

      return {
        allowed: true,
        used: data.used,
        remaining: newRemaining,
      };
    },

    /** Returns current usage without consuming anything. */
    usage() {
      const data = load();
      return {
        date: data.date,
        used: data.used,
        remaining: Math.max(0, dailyLimit - data.used),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  readJsonResponse,
  createRateLimiter,
  createBudgetTracker,
};
