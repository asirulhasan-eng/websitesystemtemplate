#!/usr/bin/env node
/**
 * intelligence-search â€” Search historical analysis reports.
 *
 * This is how the system learns from past analysis: weekly reviews, the planner,
 * and humans can recall what a module found before making a new decision.
 *
 *   v2 intelligence search --query "{{NICHE}} SEO pricing" --json
 *   v2 intelligence search --module gsc-performance --days 30 --json
 *   v2 intelligence search --severity critical --days 14 --json
 *   v2 intelligence search --query competitor --modules competitor-watch,serp-monitor \
 *     --from 2026-05-01 --to 2026-06-01 --json
 */
const { parseArgs, listArg, numberArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { normalizeSeverity, isKnownModule } = require("../lib/intelligence");

const TOOL = "intelligence-search";

const HELP = `
intelligence-search â€” Full-text search over historical analysis reports.

USAGE
  v2 intelligence search [--query <text>] [filters] [options]

FILTERS
  --query <text>          Match headline OR report_json (case-insensitive LIKE).
  --module <id>           Single module id.
  --modules <a,b,c>       Multiple module ids.
  --severity <s>          normal | warning | critical.
  --session <s>           morning | evening | manual.
  --days <n>              Look back n days from now.
  --from <YYYY-MM-DD>     Start of run_at range (inclusive).
  --to <YYYY-MM-DD>       End of run_at range (inclusive).
  --include-failed        Include status='failed' rows (default: excluded).

OPTIONS
  --limit <n>             Max rows (default: 50).
  --db <path>             SQLite DB path.
  --json | --table        Output format.
  --help                  Show help.
`.trim();

module.exports = function intelligenceSearch() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "search") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 intelligence search"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const conds = [];
    const params = [];

    if (!args["include-failed"]) conds.push("status != 'failed'");

    if (args.query) {
      conds.push("(headline LIKE ? OR report_json LIKE ?)");
      const like = `%${String(args.query)}%`;
      params.push(like, like);
    }

    const modules = listArg(args, "modules", []);
    if (args.module) modules.push(String(args.module));
    if (modules.length) {
      conds.push(`module_id IN (${modules.map(() => "?").join(",")})`);
      params.push(...modules);
    }

    if (args.severity) {
      conds.push("severity = ?");
      params.push(normalizeSeverity(args.severity));
    }
    if (args.session) {
      conds.push("session = ?");
      params.push(String(args.session).toLowerCase());
    }

    if (args.days !== undefined) {
      const cutoff = new Date(Date.now() - numberArg(args, "days", 30) * 86400000).toISOString();
      conds.push("run_at >= ?");
      params.push(cutoff);
    }
    if (args.from) {
      conds.push("run_at >= ?");
      params.push(`${String(args.from)}T00:00:00Z`);
    }
    if (args.to) {
      conds.push("run_at <= ?");
      params.push(`${String(args.to)}T23:59:59Z`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = numberArg(args, "limit", 50);

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    let rows;
    try {
      rows = db.prepare(`
        SELECT id, module_id, session, run_at, status, severity, headline,
               markdown_path, brain_note_id, duration_ms
        FROM analysis_reports
        ${where}
        ORDER BY run_at DESC
        LIMIT ?
      `).all(...params, limit);
    } finally {
      db.close();
    }

    const results = rows.map((r) => ({
      ...r,
      known_module: isKnownModule(r.module_id),
    }));

    printOutput(envelope({
      query: args.query || null,
      filters: {
        modules: modules.length ? modules : null,
        severity: args.severity || null,
        session: args.session || null,
        days: args.days !== undefined ? numberArg(args, "days", 30) : null,
        from: args.from || null,
        to: args.to || null,
      },
      count: results.length,
      results,
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
