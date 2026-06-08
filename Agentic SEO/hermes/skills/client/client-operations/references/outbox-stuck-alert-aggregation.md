# Outbox stuck alert aggregation

## Context
When the {{SITE_NAME}} dead-man monitor sees many stale `outbox_jobs`, per-job `outbox_stuck` alerts can create an email storm. This is especially bad when the generated `send_monitor_alert` jobs themselves remain pending long enough to be detected as stuck, creating a feedback loop.

## Durable lesson
For outbox monitoring, alert at the class/group level rather than the row level:

- Group stuck jobs by `job_type` and `status`.
- Emit one `outbox_stuck` alert per group.
- Include `count`, `oldest_outbox_id`, `oldest_created_at`, and a small `sample_outbox_ids` list in metadata.
- Keep a regression test proving multiple stale rows produce grouped alerts, not one alert per row.

## Useful verification pattern
Use strict TDD for monitor behavior changes:

1. Add a `node:test` fixture DB using `openStateDb()`.
2. Insert multiple old `outbox_jobs` of the same type/status plus another type/status.
3. Run:
   ```bash
   node tools/run_deadman_monitor.js --db <tmp-db> --dry-run --json --out <tmp-report>
   ```
4. Assert the output has one `outbox_stuck` alert per `(job_type, status)` group.
5. Run the real operational DB in dry-run mode and compare alert count before/after.

## Example grouped message
```text
Outbox jobs stuck: 2053 pending update_obsidian_page_note job(s); oldest OUT-... from 2026-05-30T22:15:02.124Z
```

## Pitfalls

- Do not solve an email flood by deleting outbox rows or raw-editing SQLite. Follow the project rule: SQLite is the source of truth, and code fixes should be verified with dry-run monitor output and tests first.
- After grouping alerts, still inspect whether the largest group is `send_monitor_alert`. If alert-delivery jobs are themselves stuck, grouped alerts reduce noise but do not fully remove monitor-on-monitor feedback; consider suppressing or separately handling stuck alert-delivery jobs and adding auto-resolution for groups whose oldest/sample jobs are no longer pending/retrying/processing.
