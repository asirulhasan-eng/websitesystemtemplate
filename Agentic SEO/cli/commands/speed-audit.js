#!/usr/bin/env node
const path = require("node:path");
const { parseArgs, requireArg, numberArg, listArg, boolArg, getOutputFormat } = require("../lib/cli");
const { loadToolEnv } = require("../lib/env");
const { compactDateTime } = require("../lib/dates");
const { writeJson, slugify } = require("../lib/io");
const { printOutput, errorEnvelope } = require("../lib/output");

const TOOL = "speed-audit";
const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const VALID_STRATEGIES = ["mobile", "desktop"];
const VALID_CATEGORIES = ["performance", "accessibility", "best-practices", "seo", "pwa"];

const HELP = `
speed-audit - Google PageSpeed Insights and Core Web Vitals audit

USAGE
  v2 speed-audit --url <url> [options]

OPTIONS
  --url <url>              URL to test.
  --strategy <strategy>    mobile, desktop, or both. Default: mobile.
  --category <list>        Comma list: performance, accessibility, best-practices, seo, pwa.
                           Default: performance.
  --min-score <0-100>      Mark the run failed if performance score is below this.
  --key <key>              API key. Defaults to PAGESPEED_API_KEY or GOOGLE_API_KEY.
  --timeout-ms <ms>        Per-request timeout. Default: 60000.
  --out <path>             Write JSON report to path.
  --no-write               Do not write a report file unless --out is provided.
  --fail-on-error          Exit non-zero when PSI fails or misses --min-score.
  --sample                 Return sample data without calling Google.
  --json                   JSON output.
  --table                  Table output.
  --help                   Show help.

ALIASES
  v2 pagespeed
  v2 cwv
  v2 cwv-check
`.trim();

module.exports = async function speedAudit() {
  const args = parseArgs();
  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  try {
    const url = args.sample ? (args.url || "https://{{DOMAIN}}/") : requireArg(args, "url");
    const categories = normalizeCategories(listArg(args, "category", ["performance"]));
    const strategies = normalizeStrategies(args.strategy);
    const minScore = args["min-score"] !== undefined ? numberArg(args, "min-score", 0) : null;

    const runs = args.sample
      ? strategies.map((strategy) => sampleRun(strategy, categories))
      : await runAllStrategies({ args, url, categories, strategies });

    const auditPassed = runs.every((run) => run.ok && (minScore === null || passesMinScore(run, minScore)));
    const output = {
      ok: auditPassed,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      url,
      categories,
      strategies,
      min_score: minScore,
      used_api_key: args.sample ? false : Boolean(resolveApiKey(args)),
      runs,
    };

    const outPath = args.out || (!boolArg(args, "no-write")
      ? path.join(process.cwd(), "tools", "out", "pagespeed", `pagespeed-${slugify(url)}-${compactDateTime()}.json`)
      : null);
    if (outPath) {
      writeJson(outPath, output);
      output.report_path = outPath;
    }

    printOutput(output, getOutputFormat(args));
    if (!auditPassed && boolArg(args, "fail-on-error")) process.exitCode = 1;
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

async function runAllStrategies({ args, url, categories, strategies }) {
  const apiKey = resolveApiKey(args);
  const timeoutMs = numberArg(args, "timeout-ms", 60000);
  const runs = [];
  for (const strategy of strategies) {
    runs.push(await runPagespeed({ url, strategy, categories, apiKey, timeoutMs }));
  }
  return runs;
}

function resolveApiKey(args) {
  const config = loadToolEnv({ envPath: args.env, cwd: args.cwd });
  return args.key || config.get("PAGESPEED_API_KEY") || config.get("GOOGLE_API_KEY");
}

async function runPagespeed({ url, strategy, categories, apiKey, timeoutMs }) {
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("strategy", strategy);
  for (const category of categories) params.append("category", category);
  if (apiKey) params.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    const json = await response.json();
    if (!response.ok || json.error) {
      const message = json.error ? json.error.message : response.statusText;
      return { ok: false, strategy, response_time_ms: Date.now() - startedAt, error: message };
    }
    return summarizeResult({ strategy, json, responseTimeMs: Date.now() - startedAt });
  } catch (error) {
    return { ok: false, strategy, response_time_ms: Date.now() - startedAt, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResult({ strategy, json, responseTimeMs }) {
  const lighthouse = json.lighthouseResult || {};
  const lhCategories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};
  const scores = {};
  for (const [key, category] of Object.entries(lhCategories)) {
    scores[key] = category.score === null || category.score === undefined ? null : Math.round(category.score * 100);
  }
  return {
    ok: true,
    strategy,
    response_time_ms: responseTimeMs,
    analysis_utc: json.analysisUTCTimestamp || lighthouse.fetchTime || null,
    final_url: lighthouse.finalUrl || lighthouse.requestedUrl || null,
    lighthouse_version: lighthouse.lighthouseVersion || null,
    scores,
    core_web_vitals: {
      lcp_ms: numericValue(audits["largest-contentful-paint"]),
      cls: numericValue(audits["cumulative-layout-shift"]),
      tbt_ms: numericValue(audits["total-blocking-time"]),
      fcp_ms: numericValue(audits["first-contentful-paint"]),
      speed_index_ms: numericValue(audits["speed-index"]),
      tti_ms: numericValue(audits.interactive),
    },
    field_data: extractFieldData(json.loadingExperience),
    top_opportunities: extractOpportunities(audits),
  };
}

function extractFieldData(loadingExperience) {
  if (!loadingExperience || !loadingExperience.metrics) return null;
  const metrics = loadingExperience.metrics;
  const pick = (name) => {
    const metric = metrics[name];
    return metric ? { percentile: metric.percentile, category: metric.category } : null;
  };
  return {
    overall_category: loadingExperience.overall_category || null,
    lcp: pick("LARGEST_CONTENTFUL_PAINT_MS"),
    cls: pick("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    inp: pick("INTERACTION_TO_NEXT_PAINT"),
    fcp: pick("FIRST_CONTENTFUL_PAINT_MS"),
  };
}

function extractOpportunities(audits) {
  return Object.values(audits)
    .filter((audit) => audit?.details?.type === "opportunity" && audit.details.overallSavingsMs > 0)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      savings_ms: Math.round(audit.details.overallSavingsMs),
    }))
    .sort((a, b) => b.savings_ms - a.savings_ms)
    .slice(0, 5);
}

function numericValue(audit) {
  if (!audit || audit.numericValue === undefined || audit.numericValue === null) return null;
  return Math.round(audit.numericValue * 1000) / 1000;
}

function passesMinScore(run, minScore) {
  const performance = run.scores ? run.scores.performance : null;
  return performance !== null && performance !== undefined && performance >= minScore;
}

function normalizeCategories(values) {
  const normalized = values
    .map((value) => String(value).toLowerCase().replace(/_/g, "-"))
    .filter((value) => VALID_CATEGORIES.includes(value));
  return normalized.length ? Array.from(new Set(normalized)) : ["performance"];
}

function normalizeStrategies(value) {
  if (!value || value === true) return ["mobile"];
  const lowered = String(value).toLowerCase();
  if (lowered === "both" || lowered === "all") return ["mobile", "desktop"];
  return VALID_STRATEGIES.includes(lowered) ? [lowered] : ["mobile"];
}

function sampleRun(strategy, categories) {
  const scores = {};
  for (const category of categories) scores[category] = category === "performance" ? 91 : 96;
  return {
    ok: true,
    strategy,
    response_time_ms: 1234,
    analysis_utc: "2026-06-03T00:00:00.000Z",
    final_url: "https://{{DOMAIN}}/",
    lighthouse_version: "sample",
    scores,
    core_web_vitals: {
      lcp_ms: strategy === "mobile" ? 2100 : 1300,
      cls: 0.03,
      tbt_ms: 70,
      fcp_ms: strategy === "mobile" ? 1100 : 700,
      speed_index_ms: strategy === "mobile" ? 2300 : 1400,
      tti_ms: strategy === "mobile" ? 2600 : 1600,
    },
    field_data: {
      overall_category: "FAST",
      lcp: { percentile: 2100, category: "FAST" },
      cls: { percentile: 0.03, category: "FAST" },
      inp: { percentile: 120, category: "FAST" },
      fcp: { percentile: 900, category: "FAST" },
    },
    top_opportunities: [
      { id: "properly-size-images", title: "Properly size images", savings_ms: 180 },
    ],
  };
}

if (require.main === module) {
  module.exports();
}
