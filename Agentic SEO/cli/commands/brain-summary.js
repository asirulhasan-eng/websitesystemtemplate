#!/usr/bin/env node
const { parseArgs, boolArg, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { loadBrain } = require("../lib/obsidian_brain");

const TOOL = "brain-summary";

const HELP = `
brain-summary - Read compact Obsidian Agent Brain summary

USAGE
  v2 brain summary [options]

OPTIONS
  --vault <path>        Obsidian vault root.
  --brain-vault <path>  Alias for --vault.
  --domain <name>       Filter notes by brain_domain.
  --markdown            Print Markdown summary instead of JSON.
  --json                JSON output.
  --help                Show help.
`.trim();

module.exports = function brainSummary() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const loaded = loadBrain({
      vaultRoot: args.vault || args["brain-vault"],
      mode: "read_only",
      autoCompile: args.compile !== false,
      allowMissing: true,
    });
    const brain = loaded.brain;
    if (!brain) throw new Error(loaded.warning || "Compiled Brain is missing.");
    const notes = (brain.notes || []).filter((note) => !args.domain || note.brain_domain === args.domain);
    const output = {
      ok: true,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      stale: Boolean(loaded.stale),
      used_last_good: Boolean(loaded.used_last_good),
      warning: loaded.warning || null,
      source_hash: brain.source_hash,
      brain_generated_at: brain.generated_at,
      no_go_terms: brain.no_go_terms || [],
      blocked_terms: brain.blocked_terms || [],
      risk_rules: brain.risk_rules || [],
      notes,
    };

    if (boolArg(args, "markdown")) {
      console.log(renderMarkdown(output));
      return;
    }
    printOutput(output, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function renderMarkdown(summary) {
  const lines = [
    "# {{SITE_NAME}} Agent Brain Summary",
    "",
    `Generated: ${summary.brain_generated_at}`,
    `Source hash: ${summary.source_hash}`,
    "",
    "## No-go Terms",
  ];
  for (const term of summary.blocked_terms) {
    lines.push(`- ${term.term} (${term.match_type}, ${term.severity}) - ${term.reason || term.rule_id}`);
  }
  lines.push("", "## Notes");
  for (const note of summary.notes) {
    lines.push("", `### ${note.title}`, "", note.body_summary || "");
  }
  return `${lines.join("\n")}\n`;
}

if (require.main === module) {
  module.exports();
}
