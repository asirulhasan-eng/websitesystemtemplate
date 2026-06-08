# SERP target_file gap + dry-run executor diagnosis (2026-05-30)

## Trigger
User asked why {{SITE_NAME}} tasks were not automatically executing and then requested diagnosis/fix for SERP tasks with `target_file = null`.

## Findings
- System cron exists and runs the daily loop at 02:17 Dhaka:
  - `17 2 * * * cd /opt/client-agent && ./tools/cron/run-daily.sh >> logs/daily.log 2>&1`
- Hermes scheduler had no jobs, but Linux crontab had the {{SITE_NAME}} automation.
- `tools/cron/run-daily.sh` ran `node tools/run_task_executor.js ...` without `--apply`, so executor artifacts showed `"dry_run": true`.
- Safe tasks were selected but reported `no_action` because `target_file` was null:
  - `Target file not found: unknown`
- All current `source='serp_movement'` tasks had null `target_file`.

## Root cause
`tools/analyze_serp_movement.js` generated task candidates with `targetUrl` but no `targetFile`. By contrast, `tools/analyze_gsc_opportunities.js` already used `urlToLikelyFile(row.page)`.

Relevant old pattern:
```js
createTaskCandidate({
  source: "serp_movement",
  taskType: "protect_ranking_gain",
  targetUrl: result.current_url,
  targetKeyword: result.keyword,
});
```

## Fix pattern
Use TDD before patching:
1. Add Node test for URL-to-file mapping and SERP candidate `target_file`.
2. Verify RED with `node --test test/serp-target-file.test.js`.
3. Patch:
   - Import `urlToLikelyFile` in `analyze_serp_movement.js`.
   - Add `targetFile: urlToLikelyFile(result.current_url || result.previous_url)` for `ranking_recovery`.
   - Add `targetFile: urlToLikelyFile(result.current_url)` for `protect_ranking_gain`.
   - Improve `urlToLikelyFile` to check `/path` -> `path.html` when that file exists, while keeping `/path/` -> `path/index.html`.
4. Verify GREEN:
   - `node --test test/serp-target-file.test.js`
   - `node --check tools/lib/tasks.js`
   - `node --check tools/analyze_serp_movement.js`
   - Run sample SERP generation with a temp history dir and inspect output.

## Important nuance
Fixing `target_file` only fixes future task generation. Existing SQLite rows still need project-sanctioned backfill/refresh via CLI/atomic workflow, not raw SQLite updates.

Also, `protect_ranking_gain` may still be a design gap for the safe executor: after target resolution it can become `Task type protect_ranking_gain is not a deterministic safe edit` unless a deterministic safe action is defined for that task type.

## Commands that were useful
```bash
crontab -l
tail -120 /opt/client-agent/logs/daily.log
sqlite3 tools/out/state/seo-agent.db "SELECT ... FROM tasks WHERE source='serp_movement' ..."
node --test test/serp-target-file.test.js
node --check tools/lib/tasks.js
node --check tools/analyze_serp_movement.js
```
