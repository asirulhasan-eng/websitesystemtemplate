#!/usr/bin/env node
/**
 * intelligence-due — Which modules are due to run this session?
 *
 * Orchestrator helper for cron/run-intelligence.sh. Reads each module's last
 * successful run from analysis_reports and applies the cadence rules in
 * lib/intelligence.js (the single source of truth for cadence), so the shell
 * never re-implements cadence logic.
 *
 *   v2 intelligence due --session morning --json
 *   v2 intelligence due --session evening --force-all --json
 */
const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { printOutput, envelope, errorEnvelope } = require("../lib/output");
const { openStateDb } = require("../lib/state_db");
const { MODULES, normalizeSession, computeDueModules } = require("../lib/intelligence");

const TOOL = "intelligence-due";

const HELP = `
intelligence-due — List intelligence modules due to run this session.

USAGE
  v2 intelligence due --session <morning|evening|manual> [options]

OPTIONS
  --session <s>           Session to evaluate (required).
  --force-all             Treat every module as due (manual full run).
  --db <path>             SQLite DB path.
  --json | --table        Output format.
  --help                  Show help.

OUTPUT
  due       : array of module ids due now
  due_csv   : same, comma-joined (handy for shell loops)
  skipped   : modules not due, with the reason
`.trim();

module.exports = function intelligenceDue() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "due") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 intelligence due"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const session = normalizeSession(args.session || "morning");

    if (boolArg(args, "force-all", false)) {
      const due = MODULES.map((m) => ({ module_id: m.id, name: m.name, reason: "forced (--force-all)", last_run_at: null }));
      printOutput(envelope({
        session,
        due: due.map((d) => d.module_id),
        due_csv: due.map((d) => d.module_id).join(","),
        due_detail: due,
        skipped: [],
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    let lastRows;
    try {
      lastRows = db.prepare(`
        SELECT module_id, MAX(run_at) AS last_run
        FROM analysis_reports
        WHERE status != 'failed'
        GROUP BY module_id
      `).all();
    } finally {
      db.close();
    }

    const lastRuns = {};
    for (const row of lastRows) lastRuns[row.module_id] = row.last_run;

    const { due, skipped } = computeDueModules({ session, lastRuns });

    printOutput(envelope({
      session,
      due: due.map((d) => d.module_id),
      due_csv: due.map((d) => d.module_id).join(","),
      due_detail: due,
      skipped,
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
