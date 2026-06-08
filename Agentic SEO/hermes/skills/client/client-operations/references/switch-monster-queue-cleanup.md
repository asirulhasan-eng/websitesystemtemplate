# Switch.monster Queue Cleanup Pattern

## Trigger
Use this when {{SITE_NAME}} task queues contain `switch.monster` keywords/tasks. These are fake/non-actionable impressions for {{SITE_NAME}} and should not remain in the active candidate queue.

## Risk Lane
Safe: task queue cleanup only. No production site files or deployments should be changed.

## Required Approach
- Do not delete task rows.
- Do not edit Obsidian directly.
- Use SQLite as source of truth and update task status atomically with event + outbox.
- Mark matching active queue tasks as `cancelled`, not `expired`, because this is intentional removal of fake/non-actionable tasks.
- Apply the cleanup to both known DB copies when present:
  - Operational DB: `/opt/client-agent/tools/out/state/seo-agent.db`
  - Durable repo DB: `/opt/client-sqlite/seo-agent.db`
- Process the Obsidian outbox after the DB update so mirrored task notes reflect the cancellation.

## Match Condition
Match tasks containing `switch.monster` in any task text field or metadata, commonly:
- `title`
- `description`
- `target_url`
- `target_file`
- `target_keyword`
- `metadata_json`

Only update active queue statuses such as `candidate` unless the user explicitly asks for a broader cleanup.

## Implementation Sketch
From `/opt/client-agent`, use project helpers rather than raw ad-hoc SQLite mutation:

```js
const { openStateDb, updateTaskStatusAtomic } = require('./tools/lib/state_db');
const dbs = ['tools/out/state/seo-agent.db', '/opt/client-sqlite/seo-agent.db'];
const patternSql = "lower(COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(target_url,'') || ' ' || COALESCE(target_file,'') || ' ' || COALESCE(target_keyword,'') || ' ' || COALESCE(metadata_json,'')) LIKE '%switch.monster%'";
for (const dbPath of dbs) {
  const db = openStateDb(dbPath);
  const tasks = db.prepare(`SELECT task_id, status, title FROM tasks WHERE status = 'candidate' AND ${patternSql} ORDER BY created_at`).all();
  for (const task of tasks) {
    updateTaskStatusAtomic(db, task.task_id, 'cancelled', {
      oldStatus: task.status,
      source: 'hermes_queue_cleanup',
      agentName: 'Hermes Agent',
      metadata: {
        reason: 'Removed switch.monster related task from queue at user request; switch.monster impressions are fake/non-actionable for {{SITE_NAME}}.',
        match: 'switch.monster'
      },
      outboxJobType: 'update_obsidian_task_note'
    });
  }
  db.close();
}
```

Then process outbox:

```bash
cd /opt/client-agent
node tools/sync_obsidian_outbox.js --db tools/out/state/seo-agent.db --obsidian-root /opt/client-obsidian --limit 200 --json
node tools/sync_obsidian_outbox.js --db /opt/client-sqlite/seo-agent.db --obsidian-root /opt/client-obsidian --limit 200 --json
```

Outbox processing may write additional generated `switch.monster` task notes into the Obsidian mirror. After the outbox is complete and SQLite has zero active matching candidates, clean only untracked fake mirror notes from the working tree; do not delete tracked notes and do not use Obsidian as authority:

```bash
cd /opt/client-obsidian
python3 - <<'PY'
import os, subprocess
raw = subprocess.check_output(['git', 'status', '--porcelain', '-z'])
removed = []
for entry in raw.split(b'\0'):
    if not entry:
        continue
    s = entry.decode('utf-8', 'replace')
    status = s[:2]
    path = s[3:]
    if status == '??' and ('switch-monster' in path.lower() or 'switch.monster' in path.lower()):
        if os.path.isfile(path):
            os.remove(path)
            removed.append(path)
print(f'removed_untracked_switch_monster_files={len(removed)}')
PY
```

Then verify the mirror is free of switch-monster local changes:

```bash
git -C /opt/client-obsidian status --porcelain | grep -i 'switch-monster\|switch.monster' | wc -l
```

## Verification
Report:
- Risk classification: Safe.
- Matching active candidate count before and after for both DB copies.
- Number of tasks changed to `cancelled`.
- Outbox processing count and pending Obsidian outbox count after processing.
- Number of untracked `switch-monster`/`switch.monster` mirror files removed, if any.
- Working tree changes caused by the mirror update; expected clean result is zero switch-monster local changes, though unrelated generated reports may remain.

Minimum verification SQL:

```sql
SELECT COUNT(*)
FROM tasks
WHERE status='candidate'
  AND lower(COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(target_url,'') || ' ' || COALESCE(target_file,'') || ' ' || COALESCE(target_keyword,'') || ' ' || COALESCE(metadata_json,'')) LIKE '%switch.monster%';
```
