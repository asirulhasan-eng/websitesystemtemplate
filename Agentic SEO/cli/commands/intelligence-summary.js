#!/usr/bin/env node
/**
 * intelligence-summary — Aggregated intelligence the daily planner reads.
 *
 * This single command replaces Steps 2–4 of the old monolithic work plan. It
 * pulls the latest report from each module, sorts by severity, merges all
 * opportunities / threats / recommendations into one prioritized document, and
 * flags modules that are due this session but have no report yet (stale).
 *
 *   v2 intelligence summary --session morning --json
 *   v2 intelligence summary --session evening --markdown
 */
const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const {
  normalizeSession,
  isKnownModule,
  staleModules,
  aggregateSummary,
  renderSummaryMarkdown,
} = require("../lib/intelligence");

const TOOL = "intelligence-summary";

const HELP = `
intelligence-summary — Aggregate the latest reports into one planner brief.

USAGE
  v2 intelligence summary [--session <morning|evening|manual>] [options]

OPTIONS
  --session <s>           Session to evaluate cadence/staleness for. Default: morning.
  --include-failed        Include status='failed' rows when picking latest.
  --markdown              Render a human-readable markdown brief instead of JSON.
  --db <path>             SQLite DB path.
  --json | --table        Output format (json default).
  --help                  Show help.
`.trim();

module.exports = function intelligenceSummary() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "summary") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 intelligence summary"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const session = normalizeSession(args.session || "morning");
    const includeFailed = boolArg(args, "include-failed", false);

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    let rows;
    try {
      // Latest report per module, across all sessions (a morning-only module's
      // findings still matter in the evening). Same inner/outer predicate guard
      // as intelligence-latest.
      const statusCond = includeFailed ? "" : "WHERE status != 'failed'";
      const outerStatusCond = includeFailed ? "" : "WHERE ar.status != 'failed'";
      rows = db.prepare(`
        SELECT ar.*
        FROM analysis_reports ar
        JOIN (
          SELECT module_id, MAX(run_at) AS mx
          FROM analysis_reports
          ${statusCond}
          GROUP BY module_id
        ) latest ON ar.module_id = latest.module_id AND ar.run_at = latest.mx
        ${outerStatusCond}
        ORDER BY ar.run_at DESC
      `).all();
    } finally {
      db.close();
    }

    // Dedupe by module_id (same-second guard), keep newest id.
    const byModule = new Map();
    for (const r of rows) {
      const existing = byModule.get(r.module_id);
      if (!existing || String(r.id) > String(existing.id)) byModule.set(r.module_id, r);
    }

    const reports = [...byModule.values()].map((r) => {
      let report = null;
      try { report = JSON.parse(r.report_json); } catch { report = null; }
      return { ...r, report };
    });

    const lastRuns = {};
    for (const r of reports) lastRuns[r.module_id] = r.run_at;
    const stale = staleModules({ session, lastRuns });

    const summary = aggregateSummary(reports, { session, staleList: stale });
    summary.module_freshness = reports.map((r) => ({
      module_id: r.module_id,
      known_module: isKnownModule(r.module_id),
      run_at: r.run_at,
      session: r.session,
      severity: r.severity,
      report_id: r.id,
    }));

    if (boolArg(args, "markdown", false)) {
      console.log(renderSummaryMarkdown(summary));
      return;
    }

    printOutput(envelope({ summary }, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
