# {{SITE_NAME}} Rank Tracking Persistence + Dashboard

Use this reference when rank tracking appears partial, SERP movement JSON files exist but SQLite `serp_checks` is sparse/broken, or the user asks to expand/operationalize rank tracking.

## Risk lane
- Safe operational work if limited to rank-tracking tools, SQLite `serp_checks`, generated JSON artifacts, Obsidian dashboard notes, tests, and commits.
- Do not edit production site content during rank-tracking persistence/dashboard work.

## Proven workflow
1. Inspect the live `serp_checks` schema before patching writer code.
   - The live schema used in this session was:
     - `serp_check_id`
     - `keyword`
     - `provider`
     - `position`
     - `url`
     - `domain`
     - `snapshot_json`
     - `checked_at`
     - `created_at`
     - `metadata_json`
   - Avoid stale columns such as `check_id`, `position_delta`, `movement_type`, `top_result_url`, and `competitor_count` unless the schema has actually changed.
2. Patch `tools/analyze_serp_movement.js` to persist checks directly to the real schema, keeping movement classifications in JSON/snapshot/metadata rather than nonexistent columns.
3. Make keyword-file parsing ignore blank lines and comment lines beginning with `#`; otherwise config comments can become fake tracked keywords and dirty the database.
4. Back up authoritative SQLite before writes:
   ```bash
   sqlite3 /opt/client-sqlite/seo-agent.db \
     ".backup '/opt/client-backups/seo-agent-before-serp-backfill-$(date -u +%Y%m%dT%H%M%SZ).db'"
   ```
5. Backfill idempotently from both historical artifact roots:
   ```bash
   cd /opt/client-agent
   node tools/backfill_serp_checks.js \
     --db /opt/client-sqlite/seo-agent.db \
     --movement-dir tools/out/serp-movement \
     --history-dir tools/out/serp-history \
     --json
   ```
6. Keep expanded tracked keywords in:
   ```text
   /opt/client-agent/config/rank_tracking_keywords.txt
   ```
   Include seed terms, clean candidate/GSC opportunity keywords, homepage/service terms, and buyer-intent {{NICHE}} SEO keywords. Keep comments for human organization, but ensure parser skips them.
7. Patch daily/opportunity runners to use the expanded keyword file by default:
   - `tools/run_daily_observer.js`
   - `tools/run_opportunity_scan.js`
8. Generate an Obsidian dashboard at:
   ```text
   /opt/client-obsidian/04-Dashboards/Rank Tracking Dashboard.md
   ```
   Include latest checks, found/not-found counts, gain/drop/lost counts, notable rankings, and the ranked URL.
9. Preserve task automation behavior:
   - ranking gain / entered SERP -> safe `protect_ranking_gain`
   - ranking drop / lost SERP -> semi-safe `ranking_recovery` investigation/preview
   - high-risk production changes still require explicit approval
10. Run candidate generation against the new SERP output and verify duplicate handling; existing tasks should be skipped, not duplicated.
11. Process Obsidian outbox if any DB/task/dashboard writes queued mirror updates.
12. Commit/push affected repos and verify clean/synced:
   - `/opt/client-agent`
   - `/opt/client-sqlite`
   - `/opt/client-obsidian`
   - `/opt/client-site` should remain unchanged for pure rank-tracking work.

## Verification commands
```bash
cd /opt/client-agent
node --test test/serp-db-persistence.test.js test/rank-dashboard.test.js
node --test test/*.test.js
sqlite3 /opt/client-sqlite/seo-agent.db 'PRAGMA integrity_check;'
```

Useful DB spot checks:
```sql
SELECT COUNT(*) FROM serp_checks;
SELECT COUNT(DISTINCT keyword) FROM serp_checks;
SELECT COUNT(*) FROM serp_checks WHERE keyword LIKE '#%';
SELECT keyword, position, url, checked_at
FROM serp_checks
ORDER BY checked_at DESC
LIMIT 20;
```

## Reporting checklist
Report:
- Risk classification and that no production content was edited.
- Schema fix made and bad/stale columns avoided.
- Backfill source directories and final `serp_checks`/distinct keyword counts.
- Keyword expansion location and total tracked keywords.
- Dashboard path and top current rankings with URL being ranked.
- Automation behavior still intact for gains/drops/high-risk items.
- Tests run and pass/fail counts.
- Repos committed/pushed and clean/synced.

## Pitfalls
- Do not assume the SERP JSON artifact shape equals the SQLite schema; inspect both.
- Do not let config comments become keywords.
- Do not backfill into repo-local or temporary DBs when the authoritative DB is `/opt/client-sqlite/seo-agent.db`.
- Do not create duplicate ranking tasks when candidate generation already has a matching task.
- Keep one-off task IDs, commit hashes, and timestamped artifact names in the session report, not in the skill body.
