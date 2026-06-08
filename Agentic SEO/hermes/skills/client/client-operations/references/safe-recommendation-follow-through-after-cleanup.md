# Safe Recommendation Follow-Through After {{SITE_NAME}} Cleanup

## Trigger
Use when a {{SITE_NAME}} cleanup/fix leaves local repo changes or the user asks whether all recommendations should be completed.

## Risk Lane
Safe if changes are limited to durable data backup, agent tooling/tests, and generated mirror cleanup. Keep production site files/deployments separate and do not merge/deploy content changes without the normal risk lane.

## Pattern
1. Re-audit all four repos before acting:
   ```bash
   for repo in /opt/client-site /opt/client-sqlite /opt/client-obsidian /opt/client-agent; do
     git -C "$repo" status --short --branch
     git -C "$repo" rev-list --left-right --count HEAD...@{u} 2>/dev/null || true
   done
   ```
2. If operational SQLite changed, sync it to the durable SQLite repo with SQLite backup, not copy/manual DB edits:
   ```bash
   cd /opt/client-agent
   sqlite3 tools/out/state/seo-agent.db ".backup '/opt/client-sqlite/seo-agent.db'"
   sqlite3 /opt/client-sqlite/seo-agent.db 'PRAGMA integrity_check;'
   ```
3. Verify the domain-specific invariant that motivated the cleanup before committing. For switch.monster cleanup:
   ```sql
   SELECT COUNT(*)
   FROM tasks
   WHERE status='candidate'
     AND lower(COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(target_url,'') || ' ' || COALESCE(target_file,'') || ' ' || COALESCE(target_keyword,'') || ' ' || COALESCE(metadata_json,'')) LIKE '%switch.monster%';
   ```
4. Commit/push durable SQLite if changed:
   ```bash
   cd /opt/client-sqlite
   git add seo-agent.db
   git commit -m "Backup SEO agent state after <cleanup-name>"
   git push
   ```
5. For `/opt/client-agent` local code/test changes, run focused tests plus smoke test before committing:
   ```bash
   cd /opt/client-agent
   node --test <focused-test-file>
   bash hermes/smoke-test.sh
   git add <changed-files>
   git commit -m "fix: <short description>"
   git push
   ```
6. For `/opt/client-obsidian`, inspect any remaining untracked files. If a file is only a generated stub/noise note (for example an 8-line `send_daily_email_summary` JSON stub rather than the real daily report), remove the untracked mirror file instead of committing it. Commit/push only valid generated mirror artifacts.
7. Final verification:
   - all four repos `ahead=0 behind=0` and clean
   - operational and durable DB `PRAGMA integrity_check` return `ok`
   - cleanup invariant still holds
   - relevant outbox queues have no pending/retrying jobs
   - focused tests still pass

## Reporting
Report exact commands, commits, and what was intentionally not pushed. Keep it clear whether production was untouched.