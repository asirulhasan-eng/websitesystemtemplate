# Obsidian Mirror Coverage + Dashboard Repair Pattern

Use this when the Obsidian vault is technically in sync according to the outbox/consistency checker, but the vault is not useful to navigate: missing task notes, stale tracked notes, no wikilinks, no Bases, no Canvas, or no dashboard/MOC.

## Core rule
SQLite remains the source of truth. Repair direction is always SQLite â†’ Obsidian. Do not repair SQLite from Obsidian content.

## Coverage audit pattern
From `/opt/client-agent`, compare active SQLite tasks against files in `/opt/client-obsidian/02-Tasks`.

Recommended checks:
- Pending/retrying/processing Obsidian outbox jobs should be `0` before and after repair.
- Active non-noise candidate tasks in SQLite should each have a task note in `02-Tasks`.
- Any tracked mirror note whose frontmatter `sqlite_status` differs from SQLite should be refreshed from SQLite.
- Generated/noisy domains should not be reintroduced as active navigation content; if such tasks are already cancelled in SQLite, only refresh the existing tracked note status from SQLite.

## Queue missing/stale task notes safely
Use the project state helper to insert an event and an outbox job in one transaction, then process the outbox. Do not write task notes directly except for human-authored dashboard/MOC artifacts.

```js
const { openStateDb, insertEventWithOutboxAtomic } = require('./tools/lib/state_db');
const db = openStateDb('tools/out/state/seo-agent.db');

insertEventWithOutboxAtomic(db, {
  eventType: 'obsidian_sync_repair_queued',
  taskId,
  resourceType: 'task',
  resourceId: taskId,
  oldValue,
  newValue,
  source: 'hermes_obsidian_sync_repair',
  agentName: 'Hermes Agent',
  metadata: { reason: 'Refresh missing/stale Obsidian task note from SQLite.' }
}, {
  jobType: 'update_obsidian_task_note',
  entityType: 'task',
  entityId: taskId,
  payload: { reason: 'obsidian_mirror_coverage_repair' }
});
```

Process the queue:

```bash
cd /opt/client-agent
node tools/sync_obsidian_outbox.js \
  --db tools/out/state/seo-agent.db \
  --obsidian-root /opt/client-obsidian \
  --limit 200 \
  --json
```

## Dashboard/navigation artifacts
If the vault has task/report/log notes but no connections, create lightweight navigation artifacts under `00-Dashboard/` using existing mirror data only:

- `{{SITE_NAME}} Home.md` â€” dashboard/MOC with wikilinks to task boards, reports, logs, and top active candidates.
- `Task Board.base` â€” Obsidian Base scoped to `02-Tasks`, grouped by risk/status.
- `System Logs.base` â€” Obsidian Base scoped to `12-Reports` and `14-System-Logs`.
- `{{SITE_NAME}} Overview.canvas` â€” JSON Canvas linking the home note, Bases, and a SQLite-wins warning node.

All dashboard content must include the SQLite-wins warning and must avoid presenting Obsidian as authority.

## Validation checklist
Before committing:
- Parse every `.base` file as YAML.
- Parse every `.canvas` file as JSON and verify unique IDs plus non-dangling edges.
- Count wikilinks; expect the dashboard/MOC to introduce internal links.
- Confirm pending Obsidian outbox jobs are `0` in both operational and durable DBs after backup.
- Confirm active non-noise candidates have missing note count `0`.
- Confirm stale tracked notes count `0` by comparing frontmatter status to SQLite.
- Run SQLite `PRAGMA integrity_check` on operational and durable DBs.
- Commit/push the Obsidian repo, then backup operational SQLite to `/opt/client-sqlite/seo-agent.db` and commit/push that repo if changed.

## Pitfalls
- A consistency check can be green enough for sync health while the vault is still poor for human navigation. Also inspect Bases, Canvas, wikilinks, and dashboard/MOC presence.
- Do not bulk-copy all generated Obsidian output into the vault if it would reintroduce cancelled/noisy tasks. Queue/update notes from SQLite intentionally.
- Do not mark a note fixed just because the file exists; compare the frontmatter status against SQLite.
