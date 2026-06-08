#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, boolArg, numberArg, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { loadBrain, compileBrain, resolveVaultRoot, compiledRoot } = require("../lib/obsidian_brain");

const TOOL = "brain-health";

const HELP = `
brain-health - Validate compiled Obsidian Agent Brain readiness

USAGE
  v2 brain health [options]

OPTIONS
  --vault <path>             Obsidian vault root.
  --brain-vault <path>       Alias for --vault.
  --compile                  Compile before checking.
  --strict                   Exit non-zero on stale/missing compiled Brain.
  --max-prompt-bytes <N>     Warn if compact Brain Markdown exceeds this size.
                            Default: 12288.
  --json                     JSON output.
  --table                    Table output.
  --sample                   Return sample data.
  --help                     Show help.
`.trim();

module.exports = function brainHealth() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput({
      ok: true,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      vault_root: "/opt/client-obsidian",
      compiled_exists: true,
      stale: false,
      no_go_terms_count: 2,
      risk_rules_count: 4,
      prompt_bytes: 4096,
      issues: [],
    }, getOutputFormat(args));
    return;
  }

  try {
    const vaultRoot = resolveVaultRoot(args.vault || args["brain-vault"]);
    if (boolArg(args, "compile")) compileBrain({ vaultRoot });

    const loaded = loadBrain({
      vaultRoot,
      mode: boolArg(args, "strict") ? "execution" : "read_only",
      autoCompile: !boolArg(args, "strict"),
      allowMissing: !boolArg(args, "strict"),
    });
    const brain = loaded.brain;
    const outDir = compiledRoot(vaultRoot);
    const mdPath = path.join(outDir, "BRAIN.md");
    const promptBytes = fs.existsSync(mdPath) ? fs.statSync(mdPath).size : 0;
    const maxPromptBytes = numberArg(args, "max-prompt-bytes", 12288);
    const issues = [];

    if (!brain) issues.push({ severity: "critical", type: "missing_brain", message: loaded.warning || "Compiled Brain is missing." });
    if (loaded.stale) issues.push({ severity: "warning", type: "stale_brain", message: loaded.warning || "Compiled Brain is stale." });
    if (brain && !(brain.blocked_terms || []).length) issues.push({ severity: "critical", type: "missing_no_go_terms", message: "No blocked terms are compiled." });
    if (promptBytes > maxPromptBytes) issues.push({ severity: "warning", type: "prompt_size", message: `BRAIN.md is ${promptBytes} bytes.` });

    const ok = !issues.some((issue) => issue.severity === "critical") && !(boolArg(args, "strict") && loaded.stale);
    const output = {
      ok,
      generated_at: new Date().toISOString(),
      tool: TOOL,
      vault_root: vaultRoot,
      compiled_dir: outDir,
      compiled_exists: fs.existsSync(path.join(outDir, "BRAIN.json")),
      stale: Boolean(loaded.stale),
      used_last_good: Boolean(loaded.used_last_good),
      warning: loaded.warning || null,
      source_hash: brain?.source_hash || null,
      no_go_terms_count: (brain?.no_go_terms || []).length,
      blocked_terms_count: (brain?.blocked_terms || []).length,
      risk_rules_count: (brain?.risk_rules || []).length,
      source_files_count: (brain?.source_files || []).length,
      prompt_bytes: promptBytes,
      max_prompt_bytes: maxPromptBytes,
      issues,
    };
    printOutput(output, getOutputFormat(args));
    if (!ok) process.exitCode = 1;
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
