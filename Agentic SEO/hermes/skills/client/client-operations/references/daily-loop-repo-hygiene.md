# {{SITE_NAME}} Daily Loop â€” Repo Hygiene Case

## Situation
A daily loop pre-flight was blocked because required repos were dirty:
- `/opt/client-sqlite`: `?? seo-agent.db`
- `/opt/client-agent`: `?? logs/`

## Resolution Pattern
- Do not delete `seo-agent.db`; SQLite is the project source of truth.
- Commit `seo-agent.db` in `/opt/client-sqlite` when it is the intended state artifact.
- Ignore runtime logs in `/opt/client-agent` by adding `logs/` to `.gitignore`; commit the ignore rule instead of committing logs.
- Push both repos, rerun pre-flight, then run `seo-agent daily`.

## Verification Commands
```bash
for repo in /opt/client-site /opt/client-sqlite /opt/client-obsidian /opt/client-agent; do
  echo "== $repo =="
  git -C "$repo" status --porcelain=v1
  git -C "$repo" rev-parse --short HEAD 2>/dev/null || true
done

df -h /opt
sqlite3 /opt/client-sqlite/seo-agent.db "SELECT 1;"
```

## Daily Loop Artifacts to Read
- `tools/out/runs/daily-observer-<timestamp>.json`
- `tools/out/executor/task-executor-<timestamp>.json`
- `tools/out/obsidian-sync/obsidian-sync-<timestamp>.json`
- `tools/out/reports/daily-YYYY-MM-DD.md`

## Reporting Notes
In the final report, include what changed, what was pushed, pre-flight status, pipeline status, task/outbox counts, and non-blocking issues. IMAP auth failure during `email_approvals` should be reported as an issue but not necessarily as a failed daily loop when heartbeat finish and final loop status are successful.
