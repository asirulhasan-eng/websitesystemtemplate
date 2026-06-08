#!/usr/bin/env node
/**
 * brain-init â€” Scaffold the Obsidian Agent Brain on a fresh vault.
 *
 * Creates the memory folders (Decisions / Lessons / Observations), an index
 * note, and â€” if a seed directory exists at processes/brain-seed/01-Agent-Brain
 * â€” copies any missing policy notes. Never overwrites existing notes.
 *
 *   v2 brain init --vault /opt/client-obsidian
 */
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { ensureDir } = require("../lib/io");
const { nowIso } = require("../lib/dates");
const { resolveVaultRoot, brainRoot, MEMORY_FOLDERS } = require("../lib/obsidian_brain");

const TOOL = "brain-init";

const HELP = `
brain-init - Scaffold the Obsidian Agent Brain (memory folders + index + seed)

USAGE
  v2 brain init [--vault <path>] [--seed-dir <path>]

OPTIONS
  --vault <path>     Obsidian vault root. Defaults to CLIENT_BRAIN_VAULT.
  --seed-dir <path>  Directory of seed policy notes to copy if missing.
                     Default: processes/brain-seed/01-Agent-Brain.
  --json | --table   Output format.
  --help             Show help.
`.trim();

const INDEX_NOTE = `---
title: Memory Brain
type: brain
brain_domain: index
status: active
managed_by: client-agent
---

# ðŸ§  {{SITE_NAME}} Memory Brain

This folder is the agent's **human-readable memory**. It is read before decisions
and written as work happens.

- **Decisions/** â€” what was decided each session and *why*.
- **Lessons/** â€” causeâ†’effect learnings ("X moved rankings", "Y backfired").
- **Observations/** â€” notable signals (gaps, competitor moves) worth remembering.
- **Policy notes** (No-Go Sources, Operating Rules, Risk Lanes, â€¦) â€” long-lived rules.

> SQLite remains the source of truth for live state (task status, deployments).
> The Brain holds reasoning, policy, and lessons â€” never live metrics/status.

Recall with \`v2 brain recall --query "..."\`. Record with \`v2 brain note add ...\`.
`;

module.exports = function brainInit() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const vaultRoot = resolveVaultRoot(args.vault || args["brain-vault"]);
    const root = brainRoot(vaultRoot);
    const created = [];

    ensureDir(root);
    for (const folder of Object.values(MEMORY_FOLDERS)) {
      const dir = path.join(root, folder);
      if (!fs.existsSync(dir)) {
        ensureDir(dir);
        // .gitkeep-style marker so empty folders persist in git-backed vaults.
        const keep = path.join(dir, ".keep");
        if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
        created.push(`${folder}/`);
      }
    }

    const indexPath = path.join(root, "Memory Brain.md");
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, INDEX_NOTE, "utf8");
      created.push("Memory Brain.md");
    }

    const seedDir = path.resolve(
      process.cwd(),
      args["seed-dir"] || path.join("processes", "brain-seed", "01-Agent-Brain"),
    );
    const seeded = [];
    if (fs.existsSync(seedDir)) {
      for (const entry of fs.readdirSync(seedDir)) {
        if (!entry.endsWith(".md")) continue;
        const dest = path.join(root, entry);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(seedDir, entry), dest);
          seeded.push(entry);
        }
      }
    }

    printOutput({
      ok: true,
      generated_at: nowIso(),
      tool: TOOL,
      vault_root: vaultRoot,
      brain_dir: root,
      created,
      seeded,
      seed_dir_found: fs.existsSync(seedDir),
      note: created.length || seeded.length ? "Brain scaffolded." : "Brain already initialized; nothing to do.",
    }, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
