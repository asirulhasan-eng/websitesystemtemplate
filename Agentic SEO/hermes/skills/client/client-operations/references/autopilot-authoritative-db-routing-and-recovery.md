# Autopilot authoritative DB routing and mistaken local DB recovery

Use this when {{SITE_NAME}} automation appears to be picking/completing tasks but the visible backlog does not match, or when cron/executor output references the repo-local DB instead of the durable SQLite repo.

## Durable rule
- Authoritative task state is `/opt/client-sqlite/seo-agent.db`.
- Repo-local `/opt/client-agent/tools/out/state/seo-agent.db` is stale/forensic unless a command is intentionally running against a copied test DB.
- Runtime scripts should resolve the DB in this order: explicit `--db`, then `CLIENT_DB_PATH` / `SEO_AGENT_DB`, then `/opt/client-sqlite/seo-agent.db`.

## Diagnostic pattern
1. Classify as Safe for read-only diagnosis; code/script fixes are Safe or Semi-safe depending on whether they alter automation behavior.
2. Compare DB paths and row counts before changing anything:
   ```bash
   readlink -f /opt/client-agent/tools/out/state/seo-agent.db
   readlink -f /opt/client-sqlite/seo-agent.db
   test /opt/client-agent/tools/out/state/seo-agent.db -ef /opt/client-sqlite/seo-agent.db && echo SAME_DB || echo DIFFERENT_DB
   ```
3. Inspect cron wrappers and Node defaults for hard-coded `tools/out/state/seo-agent.db`.
4. Add/keep regression tests that fail if cron scripts or Node tool defaults fall back to the repo-local DB.
5. Run syntax checks and Node tests before pushing.

## Fix pattern
- Patch cron wrappers to set:
  ```bash
  DB_PATH="${CLIENT_DB_PATH:-/opt/client-sqlite/seo-agent.db}"
  ```
  and pass `--db "$DB_PATH"` into child tools.
- Patch Node tools to default to:
  ```js
  args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db"
  ```
- Keep explicit `--db` support so tests and copied-DB dry runs still work.

## Recovery for old mistaken rows
1. Do not blindly replace the authoritative DB from the mistaken repo-local DB.
2. Compare task IDs between the mistaken DB and authoritative DB.
3. Skip rows already present, cancelled rows, and no-go rows such as `switch.monster`.
4. Import only legitimate missing rows into the authoritative DB with an audit event like `task_recovered_from_mistaken_db` and an outbox task-note update.
5. Convert any mistaken `preview_ready` rows back to `candidate` unless the preview branch/remote/commit has been independently verified. Then let the real executor process it through the corrected DB path.
6. For old local preview branches, delete only after verifying no remote branch and no unique diff/commits versus the default branch.
7. Process outbox to zero and run `PRAGMA integrity_check;` before committing/pushing the durable DB repo.

## Verification checklist
- `node --test` or targeted cron/executor tests pass.
- `bash -n tools/cron/*.sh` passes.
- Search finds no runtime default of `args.db || "tools/out/state/seo-agent.db"`.
- `./tools/cron/run-task-executor.sh` processes at most one task from the authoritative DB.
- `./tools/cron/run-outbox-worker.sh` drains pending outbox jobs.
- `/opt/client-sqlite/seo-agent.db` passes `PRAGMA integrity_check;`.
- Final report includes commands run, commits pushed, remaining candidate count, pending outbox count, and whether any recovered rows were skipped for no-go/cancelled reasons.
