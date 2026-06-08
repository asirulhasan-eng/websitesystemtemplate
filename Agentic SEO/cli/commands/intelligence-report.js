#!/usr/bin/env node
/**
 * intelligence-report â€” Save an intelligence module's analysis report.
 *
 * Called by each module at the end of its run. Persists the report three ways
 * in one shot:
 *   1. a structured row in the SQLite `analysis_reports` table
 *   2. a rendered Markdown file at cron/intelligence/{date}/{HHMM}-{module}.md
 *   3. (if noteworthy) an Obsidian Brain observation note, queued via the Outbox
 *
 * REPORT-ONLY: modules never create or approve tasks. The daily planner reads
 * these reports (via `v2 intelligence summary`) and is the sole task producer.
 *
 *   v2 intelligence report --module gsc-performance --session morning \
 *     --severity warning --headline "2 money keywords dropped >3 positions" \
 *     --report-json '{"opportunities":[...],"threats":[...]}' --json
 */
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, requireArg, numberArg, boolArg, jsonArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb, recordAnalysisReportAtomic } = require("../lib/state_db");
const { ensureDir } = require("../lib/io");
const { nowIso } = require("../lib/dates");
const {
  isKnownModule,
  moduleName,
  normalizeSeverity,
  normalizeSession,
  makeReportId,
  reportMarkdownRelativePath,
  renderReportMarkdown,
  buildBrainObservation,
} = require("../lib/intelligence");

const TOOL = "intelligence-report";

const HELP = `
intelligence-report â€” Save an intelligence module's analysis report (report-only).

USAGE
  v2 intelligence report --module <id> --session <morning|evening|manual> \\
    --severity <normal|warning|critical> --headline <text> \\
    --report-json '<json>' [options]

REQUIRED
  --module <id>           Module id (e.g. gsc-performance, threat-detection).
  --session <s>           morning | evening | manual.
  --headline <text>       One-line summary for the planner.

OPTIONS
  --severity <s>          normal | warning | critical. Default: normal.
  --status <s>            completed | failed | skipped. Default: completed.
  --report-json <json>    Full structured report body (opportunities/threats/
                          observations/recommendations/data). Default: {}.
  --report-json-file <p>  Read the report body JSON from a file instead.
  --duration-ms <n>       How long the module took, in milliseconds.
  --error <text>          Error message (use with --status failed).
  --no-brain              Do not write a Brain observation note.
  --reports-root <dir>    Base dir for markdown reports (default: cwd or
                          CLIENT_AGENT_ROOT). File goes under
                          <root>/cron/intelligence/{date}/{HHMM}-{module}.md
  --db <path>             SQLite DB path.
  --json | --table        Output format.
  --help                  Show help.
`.trim();

module.exports = function intelligenceReport() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "report") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 intelligence report"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const moduleId = requireArg(args, "module", "--module is required (module id)");
    const session = normalizeSession(requireArg(args, "session", "--session is required (morning|evening|manual)"));
    const headline = requireArg(args, "headline", "--headline is required");
    const severity = normalizeSeverity(args.severity || "normal");
    const status = String(args.status || "completed").toLowerCase();

    let body = {};
    if (args["report-json-file"]) {
      body = JSON.parse(fs.readFileSync(args["report-json-file"], "utf8"));
    } else if (args["report-json"]) {
      body = jsonArg(args, "report-json", {});
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("--report-json must be a JSON object.");
    }

    const runAtDate = new Date();
    const runAt = nowIso();
    const reportId = makeReportId(runAtDate);
    const mdRelPath = reportMarkdownRelativePath(moduleId, runAtDate);

    // Full structured report stored in report_json (envelope + module body).
    const reportJson = {
      module_id: moduleId,
      module_name: moduleName(moduleId),
      session,
      run_at: runAt,
      severity,
      status,
      headline,
      opportunities: Array.isArray(body.opportunities) ? body.opportunities : [],
      threats: Array.isArray(body.threats) ? body.threats : [],
      observations: Array.isArray(body.observations) ? body.observations : [],
      recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
      data: body.data && typeof body.data === "object" ? body.data : {},
    };

    // Object used for markdown rendering + brain note building.
    const reportObj = {
      id: reportId,
      module_id: moduleId,
      session,
      severity,
      status,
      headline,
      run_at: runAt,
      markdown_path: mdRelPath,
      opportunities: reportJson.opportunities,
      threats: reportJson.threats,
      observations: reportJson.observations,
      recommendations: reportJson.recommendations,
      data: reportJson.data,
    };

    // 1. Render + write the Markdown report (skip for failed runs).
    let mdWritten = null;
    if (status !== "failed") {
      const reportsRoot = path.resolve(process.cwd(), args["reports-root"] || process.env.CLIENT_AGENT_ROOT || ".");
      const absPath = path.join(reportsRoot, mdRelPath);
      ensureDir(path.dirname(absPath));
      fs.writeFileSync(absPath, renderReportMarkdown(reportObj), "utf8");
      mdWritten = absPath;
    }

    // 2. Build the Brain observation note (unless suppressed or failed).
    const skipBrain = boolArg(args, "no-brain", false) || status === "failed";
    const brainNote = skipBrain ? null : buildBrainObservation(reportObj);

    // 3. Atomic persist: row + event(s) (+ brain outbox job).
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    try {
      recordAnalysisReportAtomic(db, {
        id: reportId,
        module_id: moduleId,
        session,
        run_at: runAt,
        status,
        severity,
        headline,
        report_json: JSON.stringify(reportJson),
        markdown_path: status === "failed" ? null : mdRelPath,
        duration_ms: args["duration-ms"] !== undefined ? numberArg(args, "duration-ms", null) : null,
        error: args.error || null,
        created_at: runAt,
      }, brainNote);
    } finally {
      db.close();
    }

    printOutput(envelope({
      report_id: reportId,
      module: moduleId,
      known_module: isKnownModule(moduleId),
      session,
      severity,
      status,
      headline,
      markdown_path: status === "failed" ? null : mdRelPath,
      markdown_written: mdWritten,
      brain_note_id: brainNote ? brainNote.memory_id : null,
      brain_note_queued: Boolean(brainNote),
      counts: {
        opportunities: reportJson.opportunities.length,
        threats: reportJson.threats.length,
        recommendations: reportJson.recommendations.length,
      },
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
