#!/usr/bin/env node
/**
 * brain-recall â€” Recall relevant human-readable memory from the Obsidian Brain.
 *
 * This is the "remember when needed" half of the memory system. Processes call
 * it before deciding work to surface prior decisions, lessons, and observations
 * that bear on the current keyword / page / topic.
 *
 *   v2 brain recall --query "seo for {{AUDIENCE}} ranking drop"
 *   v2 brain recall --type lesson --tag serp --limit 5 --markdown
 *   v2 brain recall --task TSK-2026-06-03-ABCD1234
 */
const { parseArgs, numberArg, boolArg, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { nowIso } = require("../lib/dates");
const { recallMemory } = require("../lib/obsidian_brain");

const TOOL = "brain-recall";

const HELP = `
brain-recall - Recall relevant memory notes (decisions / lessons / observations)

USAGE
  v2 brain recall --query <text> [options]

OPTIONS
  --query <text>      Free-text query; ranks notes by relevance. Omit to list recent.
  --type <t>          Filter to decision | lesson | observation.
  --tag <tag>         Filter to notes carrying this tag.
  --task <id>         Filter to notes linked to a task id.
  --domain <d>        Filter by brain_domain (default memory notes use "memory").
  --limit <n>         Max results (default 8).
  --include-archived  Include archived memory notes.
  --vault <path>      Obsidian vault root.
  --markdown          Render a compact Markdown briefing instead of JSON.
  --json | --table    Output format.
  --help              Show help.
`.trim();

module.exports = function brainRecall() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const result = recallMemory({
      vaultRoot: args.vault || args["brain-vault"],
      query: sub && sub !== "recall" ? sub : args.query,
      type: args.type,
      tag: args.tag,
      domain: args.domain,
      related_task: args.task,
      limit: numberArg(args, "limit", 8),
      includeArchived: boolArg(args, "include-archived", false),
    });

    const output = {
      ok: true,
      generated_at: nowIso(),
      tool: TOOL,
      ...result,
    };

    if (boolArg(args, "markdown", false)) {
      console.log(renderMarkdown(output));
      return;
    }
    printOutput(output, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

function renderMarkdown(result) {
  const lines = [
    `# Memory Recall${result.query ? `: "${result.query}"` : ""}`,
    "",
    `Matched ${result.matched} of ${result.scanned} memory notes.`,
    "",
  ];
  if (!result.results.length) {
    lines.push("_No relevant memory found._");
    return lines.join("\n");
  }
  for (const r of result.results) {
    lines.push(`- **${r.title}** _(${r.memory_type}, ${r.created_at ? r.created_at.slice(0, 10) : "?"}${r.related_task ? `, ${r.related_task}` : ""})_`);
    if (r.snippet) lines.push(`  - ${r.snippet}`);
    lines.push(`  - \`${r.path}\``);
  }
  return lines.join("\n");
}

if (require.main === module) {
  module.exports();
}
