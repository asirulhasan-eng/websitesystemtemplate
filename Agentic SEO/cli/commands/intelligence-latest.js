#!/usr/bin/env node
/**
 * intelligence-latest — Retrieve the most recent report per module.
 *
 * The planner (and other consumers) use this to see the freshest intelligence
 * without scanning history.
 *
 *   v2 intelligence latest --all --json
 *   v2 intelligence latest --modules gsc-performance,threat-detection --json
 *   v2 intelligence latest --session morning --json
 */
const { parseArgs, listArg, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { normalizeSession, isKnownModule } = require("../lib/intelligence");

const TOOL = "intelligence-latest";

const HELP = `
intelligence-latest — Latest report per module from analysis_reports.

USAGE
  v2 intelligence latest [--all | --modules <a,b>] [--session <s>] [options]

OPTIONS
  --all                   Latest report from every module (default if none given).
  --modules <a,b,c>       Only these module ids.
  --session <s>           Only reports recorded in this session (morning|evening|manual).
  --include-failed        Include status='failed' rows (default: excluded).
  --db <path>             SQLite DB path.
  --json | --table        Output format.
  --help                  Show help.
`.trim();

module.exports = function intelligenceLatest() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "latest") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 intelligence latest"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const modules = listArg(args, "modules", []);
    const session = args.session ? normalizeSession(args.session) : null;
    const includeFailed = boolArg(args, "include-failed", false);

    // Build the predicate once; apply it to BOTH the inner MAX() subquery and the
    // outer join target (with an `ar.` prefix) so a same-second failed/other-session
    // row can never shadow the real latest report.
    const conds = [];
    const params = [];
    if (!includeFailed) conds.push("status != 'failed'");
    if (session) { conds.push("session = ?"); params.push(session); }
    if (modules.length) {
      conds.push(`module_id IN (${modules.map(() => "?").join(",")})`);
      params.push(...modules);
    }
    const innerWhere = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const outerWhere = conds.length ? `WHERE ${conds.map((c) => `ar.${c}`).join(" AND ")}` : "";

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    let rows;
    try {
      rows = db.prepare(`
        SELECT ar.*
        FROM analysis_reports ar
        JOIN (
          SELECT module_id, MAX(run_at) AS mx
          FROM analysis_reports
          ${innerWhere}
          GROUP BY module_id
        ) latest ON ar.module_id = latest.module_id AND ar.run_at = latest.mx
        ${outerWhere}
        ORDER BY ar.run_at DESC
      `).all(...params, ...params);
    } finally {
      db.close();
    }

    // Dedupe by module_id (guard against identical run_at collisions), keep newest id.
    const byModule = new Map();
    for (const r of rows) {
      const existing = byModule.get(r.module_id);
      if (!existing || String(r.id) > String(existing.id)) byModule.set(r.module_id, r);
    }

    const reports = [...byModule.values()]
      .sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)))
      .map((r) => shapeRow(r));

    printOutput(envelope({
      session: session || "all",
      count: reports.length,
      modules: reports.map((r) => r.module_id),
      reports,
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function shapeRow(r) {
  let report = null;
  try { report = JSON.parse(r.report_json); } catch { report = null; }
  return {
    id: r.id,
    module_id: r.module_id,
    known_module: isKnownModule(r.module_id),
    session: r.session,
    run_at: r.run_at,
    status: r.status,
    severity: r.severity,
    headline: r.headline,
    markdown_path: r.markdown_path,
    brain_note_id: r.brain_note_id,
    duration_ms: r.duration_ms,
    report,
  };
}

if (require.main === module) {
  module.exports();
}
