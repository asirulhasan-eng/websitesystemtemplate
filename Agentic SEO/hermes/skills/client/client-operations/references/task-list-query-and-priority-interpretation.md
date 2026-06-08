# {{SITE_NAME}} Task List Query & Interpretation (Conversation-Learned)

## Canonical query source
Use the authoritative DB directly:
- `/opt/client-sqlite/seo-agent.db`
- `status`, `risk_level`, `priority_score`, `approval_required`, `target_url`, `target_file`

## Fast lane status view
```bash
sqlite3 /opt/client-sqlite/seo-agent.db <<'SQL'
SELECT status, COUNT(*)
FROM tasks
GROUP BY status;
SQL
```

## Priority-oriented queue snapshot
```bash
sqlite3 /opt/client-sqlite/seo-agent.db <<'SQL'
SELECT task_id,title,status,risk_level,priority_score,approval_required,target_url,target_file
FROM tasks
WHERE status IN ('monitored','preview_ready','candidate','executed','deployed','cancelled')
ORDER BY
  CASE status WHEN 'monitored' THEN 1 WHEN 'preview_ready' THEN 2 WHEN 'candidate' THEN 3 ELSE 4 END,
  priority_score DESC,
  created_at ASC
LIMIT 80;
SQL
```

## Interpretation rules
- Treat `candidate` as queued, `monitored` as active investigation/watch mode, `preview_ready` as ready-but-not-published content changes, `executed`/`deployed` as already completed.
- Prioritize by `priority_score` first, then oldest first (`created_at`) within equal priority.
- `approval_required = 1` tasks are blocked for automatic execution even if queued at high priority.
- Always exclude or flag `switch.monster` as fake/no-op content before surfacing as actionable work.

## Safe reporting template
Return to user:
- **Top active queued items (ID â†’ URL â†’ status â†’ risk â†’ approval requirement â†’ priority)**
- **Counts by status**
- **Any no-go/noise tasks filtered**
- **Potential next 3 actions** with exact IDs.