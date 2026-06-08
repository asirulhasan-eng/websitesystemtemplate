# Safe backlog cleanup: dedupe candidates and normalize target files

Use this when the {{SITE_NAME}} candidate queue contains repeated low-priority GSC/monitor tasks and/or `target_file` points to a non-existent `.../index.html` while the real static page is `....html`.

## Risk lane
Safe operational cleanup if limited to task-state rows, audit events, outbox, and Obsidian mirror notes. Do not edit production site content in this pass.

## Preconditions
- Use authoritative DB: `/opt/client-sqlite/seo-agent.db` unless the user explicitly says otherwise.
- SQLite is source of truth; Obsidian is mirror only.
- Make a SQLite `.backup` before applying.
- Check that task executor cron may be running; live candidate counts can change between analysis and apply. Re-read the DB just before apply and report current-state counts, not stale counts.

## Cleanup algorithm
For duplicate active tasks, prefer the maintained project tool:
```bash
cd /opt/client-agent
node tools/cleanup_duplicate_active_tasks.js \
  --db /opt/client-sqlite/seo-agent.db \
  --apply \
  --out tools/out/task-cleanup/manual-$(date -u +%Y%m%dT%H%M%SZ).json
```
The tool dedupes active actionable rows (`candidate`,`preview_ready`) by metadata `task_type` + normalized `target_keyword` + normalized `target_url`, keeps `preview_ready` first, then highest `priority_score`, and marks losers `cancelled` with `superseded_by` metadata, audit event, and Obsidian outbox update. It is now run by the daily observer after candidate generation and by `run-task-executor.sh` before preselect, so duplicate active rows should self-heal before task-list summaries and executor pickup.

Manual cleanup algorithm if the tool is unavailable:
1. Read current `status='candidate'` tasks from SQLite.
2. Normalize target file values when:
   - `target_url` is present,
   - current `target_file` does not exist under `/opt/client-site`, and
   - URL resolution with `urlToLikelyFile(target_url, { siteRoot })` points to an existing file.
   Common case: `blog/slug/index.html` -> `blog/slug.html`.
3. Preserve/update metadata locks so the `file_lock` resource matches the new `target_file`.
4. Group candidates by normalized `target_keyword` + normalized `target_url`.
5. Keep the highest `priority_score` candidate in each group (tie-break by older `created_at`, then `task_id`).
6. Mark losers as `cancelled`, not deleted. Add metadata such as `superseded_by`, `duplicate_reason`, and `duplicate_cancelled_at`.
7. For every change, insert immutable events and pending `update_obsidian_task_note` outbox jobs in the same transaction:
   - `task_target_file_normalized`
   - `task_duplicate_superseded`
8. Process Obsidian outbox with:
   ```bash
   node tools/sync_obsidian_outbox.js \
     --db /opt/client-sqlite/seo-agent.db \
     --obsidian-root /opt/client-obsidian \
     --limit 200 \
     --json
   ```
9. Run SQLite checkpoint/vacuum after writes:
   ```bash
   sqlite3 /opt/client-sqlite/seo-agent.db 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'
   ```
10. Commit/push durable state:
   - `/opt/client-sqlite`: `seo-agent.db`
   - `/opt/client-obsidian`: generated mirror notes and system logs

## Verification queries/checks
- Candidate count after cleanup.
- Duplicate candidate groups by `(lower(trim(target_keyword)), rtrim(target_url,'/'))` should be `0`.
- Missing candidate target files under `/opt/client-site` should be `0`.
- Outbox should have no `pending`, `retrying`, or `dead_letter` rows.
- Events should show expected cleanup counts:
  ```sql
  SELECT event_type, COUNT(*)
  FROM events
  WHERE source='safe_backlog_cleanup'
  GROUP BY event_type;
  ```
- Verify autopilot is still active:
  ```bash
  crontab -l | grep -F 'run-task-executor.sh'
  tail -40 /opt/client-agent/logs/task-executor.log
  ```

## Reporting
Report both intended and actual current-state counts when they differ because autopilot processed a task during the session. Include commit hashes for SQLite and Obsidian repos, backup path, verification counts, and the exact commands run.
