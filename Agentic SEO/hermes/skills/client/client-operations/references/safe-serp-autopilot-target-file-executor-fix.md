# Safe SERP autopilot: target-file resolution and deterministic executor logic

Use this when {{SITE_NAME}} safe SERP tasks remain candidates or `no_action` even though cron is running.

## Durable lesson
Safe SERP autopilot requires three parts to be true at the same time:
1. Candidate generation/storage can derive `target_file` from `target_url`.
2. Existing candidates with null/empty `target_file` can be backfilled without raw SQLite writes.
3. The safe executor has a deterministic action for the SERP task type before cron is switched to apply mode.

Do not simply add `--apply` to cron first. If targeting and executor logic are missing, cron will run but keep producing `no_action` or unresolved-target output.

## Implementation pattern
- In task creation/storage code, compute an effective file target:
  - `candidate.target_file || urlToLikelyFile(candidate.target_url)`
  - Prefer existing static paths where the helper supports them, e.g. homepage URL -> `index.html`, extensionless URL -> existing `path.html` or `path/index.html`.
- When inserting duplicate candidates with previously missing `target_file`, backfill only through the project DB helper/atomic transaction path:
  - update `target_file`
  - update metadata locks/evidence using the effective target
  - create a task event such as `task_target_file_backfilled`
  - enqueue an Obsidian outbox update
- In `execute_safe_task.js`, resolve target file again as a fallback from `target_url`; use the resolved value for file lookup and diagnostics.
- Add a deterministic safe action for `protect_ranking_gain` that can complete without arbitrary copy changes:
  - verify target HTML exists
  - inspect title/meta/H1/body/internal signal presence as applicable
  - record evidence and recommendation/protection action
  - if no file change is necessary, mark safe task executed rather than `no_action`
  - preserve rollback/validation guard behavior for any future file-changing variant
- Only after these checks pass should daily cron use:
  ```bash
  node tools/run_task_executor.js \
    --db tools/out/state/seo-agent.db \
    --site-root "${CLIENT_SITE_ROOT:-/opt/client-site}" \
    --apply \
    --validate-live \
    --rollback-on-failure
  ```

## Regression tests to add
- SERP movement candidates include a `target_file` derived from target URL.
- The safe executor resolves a missing task `target_file` from `target_url` and executes `protect_ranking_gain` deterministically.
- Candidate insertion/backfill updates existing rows that had missing `target_file`.
- Daily cron invokes executor with `--apply --validate-live --rollback-on-failure`.

## Verification pattern
Run tests first:
```bash
cd /opt/client-agent
node --test test/*.test.js
```

Validate against a copied DB before real state changes:
```bash
TMPDB=$(mktemp /tmp/seo-agent-executor-fix-XXXXXX.db)
cp tools/out/state/seo-agent.db "$TMPDB"
node tools/run_task_executor.js \
  --db "$TMPDB" \
  --site-root /opt/client-site \
  --limit 2 \
  --apply \
  --validate-live \
  --rollback-on-failure \
  --json
```

After real execution, verify:
```bash
sqlite3 -header -column tools/out/state/seo-agent.db \
  "SELECT task_id,status,target_file,target_keyword FROM tasks WHERE source='serp_movement' ORDER BY updated_at DESC LIMIT 10;"
sqlite3 -header -column tools/out/state/seo-agent.db \
  "SELECT status, COUNT(*) AS count FROM outbox_jobs GROUP BY status ORDER BY status;"
```

Then process the Obsidian outbox through the project sync tool and sync durable repos using the established `.backup`/rsync workflow; avoid raw DB edits.
