#!/usr/bin/env node
/**
 * brain-note â€” Write a human-readable memory note into the Obsidian Agent Brain.
 *
 * Memory is recorded the same way every other state change is: a row + an
 * Outbox job inside one atomic SQLite transaction. The Outbox worker
 * (`v2 outbox obsidian`) is the only writer to the vault, so this command never
 * touches the filesystem directly â€” it queues a `write_obsidian_brain_note` job.
 *
 *   v2 brain note add --type decision --title "Defend 'SEO for {{AUDIENCE}}'" \
 *     --body "Held position 3; chose not to touch the page this week." \
 *     --task TSK-... --tags "serp,defend" --links "SEO Strategy"
 */
const fs = require("node:fs");
const { parseArgs, requireArg, boolArg, listArg, getOutputFormat } = require("../lib/cli");
const { printOutput, errorEnvelope } = require("../lib/output");
const { resolveDbPath } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { openStateDb, makeId, insertEventWithOutboxAtomic } = require("../lib/state_db");
const { normalizeMemoryType, memoryNoteRelativePath, renderMemoryNoteMarkdown } = require("../lib/obsidian_brain");

const TOOL = "brain-note";

const HELP = `
brain-note - Record a human-readable memory note (decision / lesson / observation)

USAGE
  v2 brain note add --type <decision|lesson|observation> --title <text> --body <text> [options]

OPTIONS
  --type <t>          Memory type: decision, lesson, or observation. (required)
  --title <text>      Short title. (required)
  --body <text>       Note body (Markdown allowed).
  --body-file <path>  Read the body from a file instead of --body.
  --task <id>         Related task id (becomes a [[wikilink]] + event link).
  --tags <a,b,c>      Comma-separated tags for later recall.
  --links <a,b,c>     Comma-separated note titles to wikilink under "Related".
  --session <name>    Session label (e.g. workplan-morning).
  --source <name>     Origin (e.g. daily-workplan, analyst-2h). Default: cli.
  --confidence <0-1>  Optional confidence for lessons.
  --db <path>         SQLite DB path.
  --no-outbox         Record the event only; do not queue the vault write.
  --json | --table    Output format.
  --help              Show help.
`.trim();

module.exports = function brainNote() {
  const args = parseArgs();
  const sub = args._positional && args._positional[0];

  if (args.help || (!sub && !args.type)) {
    console.log(HELP);
    return;
  }
  if (sub && sub !== "add") {
    printOutput(errorEnvelope(new Error(`Unknown subcommand "${sub}". Did you mean "v2 brain note add"?`), { tool: TOOL }), "json");
    process.exitCode = 1;
    return;
  }

  try {
    const memoryType = normalizeMemoryType(requireArg(args, "type", "--type is required (decision|lesson|observation)"));
    const title = requireArg(args, "title", "--title is required");

    let body = args.body || "";
    if (args["body-file"]) {
      body = fs.readFileSync(args["body-file"], "utf8");
    }
    if (!body.trim()) throw new Error("Provide --body or --body-file with the memory content.");

    const createdAt = nowIso();
    const memoryId = makeId("MEM");
    const memory = {
      memory_id: memoryId,
      memory_type: memoryType,
      title,
      body,
      created_at: createdAt,
      session: args.session || null,
      related_task: args.task || null,
      source: args.source || "cli",
      confidence: args.confidence || null,
      tags: listArg(args, "tags", []),
      links: listArg(args, "links", []),
    };

    const relativePath = memoryNoteRelativePath(memory);
    const markdown = renderMemoryNoteMarkdown(memory);

    const skipOutbox = boolArg(args, "no-outbox", false);
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    try {
      const eventData = {
        eventType: "brain_memory_written",
        taskId: memory.related_task,
        resourceType: "brain_memory",
        resourceId: memoryId,
        newValue: memoryType,
        source: memory.source,
        agentName: "Obsidian Memory Writer",
        metadata: {
          memory_id: memoryId,
          memory_type: memoryType,
          title,
          relative_path: relativePath,
          tags: memory.tags,
          links: memory.links,
          session: memory.session,
        },
      };

      if (skipOutbox) {
        const { insertEventAtomic } = require("../lib/state_db");
        insertEventAtomic(db, eventData);
      } else {
        insertEventWithOutboxAtomic(db, eventData, {
          jobType: "write_obsidian_brain_note",
          entityType: "brain_memory",
          entityId: memoryId,
          payload: {
            memory_id: memoryId,
            memory_type: memoryType,
            title,
            relative_path: relativePath,
            markdown,
          },
        });
      }
    } finally {
      db.close();
    }

    printOutput({
      ok: true,
      generated_at: nowIso(),
      tool: TOOL,
      memory_id: memoryId,
      memory_type: memoryType,
      title,
      note_path: relativePath,
      related_task: memory.related_task,
      tags: memory.tags,
      queued: !skipOutbox,
      note: skipOutbox ? "Event recorded; vault write skipped (--no-outbox)." : "Queued for vault write via the Outbox worker.",
    }, getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
