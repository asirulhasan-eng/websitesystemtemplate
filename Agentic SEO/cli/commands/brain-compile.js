#!/usr/bin/env node
const { parseArgs, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { compileBrain } = require("../lib/obsidian_brain");

const TOOL = "brain-compile";

const HELP = `
brain-compile - Compile Obsidian Agent Brain artifacts

USAGE
  v2 brain compile --vault <path> [options]

OPTIONS
  --vault <path>        Obsidian vault root. Defaults to CLIENT_BRAIN_VAULT.
  --brain-vault <path>  Alias for --vault.
  --json                JSON output.
  --table               Table output.
  --help                Show help.
`.trim();

module.exports = function brainCompile() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const result = compileBrain({ vaultRoot: args.vault || args["brain-vault"] });
    printOutput({
      ok: true,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      ...result,
    }, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
