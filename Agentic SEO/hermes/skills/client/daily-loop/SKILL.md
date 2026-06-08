---
name: client-daily-loop
description: Run the complete daily SEO operations loop for {{SITE_NAME}}
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Daily, Automation]
    related_skills: [client-system-rules, client-safe-fix, client-preview-branch]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Daily Loop

## When to Use
When the user says: "Run the daily SEO loop", "Check the site today", "Do the daily run", or any variant.

## Pre-Flight Checks
Before running, verify:
```bash
# 1. Check repo status (no dirty state)
cd /opt/client-site && git status --porcelain
cd /opt/client-sqlite && git status --porcelain
cd /opt/client-obsidian && git status --porcelain
cd /opt/client-agent && git status --porcelain

# 2. Check disk usage
df -h /opt

# 3. Check SQLite is not locked
sqlite3 /opt/client-sqlite/seo-agent.db "SELECT 1;"
```

If any repo is dirty, STOP and report. Do not proceed.

## Procedure
Run the full daily pipeline:
```bash
cd /opt/client-agent
seo-agent daily
```

Or run individual steps:
```bash
# Step 1: Daily observer (GSC + SERP + Crawler + Task creation)
seo-agent gsc
seo-agent serp
seo-agent crawl
seo-agent tasks

# Step 2: Execute tasks
seo-agent execute

# Step 3: Process outbox
seo-agent outbox

# Step 4: Generate summary
seo-agent daily-summary
```

## Reporting
After completion:
- Summarize what was checked
- List safe fixes applied
- List previews created
- List approval requests sent
- Report any failures or blocked tasks
- Show disk usage and lock status

## Pitfalls
- If GSC pull fails, continue with SERP + crawler (don't abort entire run)
- If a lock can't be acquired, skip that task and report it
- If outbox has dead-letter jobs, report them but don't block
- Never run this while another daily loop is in progress
- Do not assume `cronjob(action='list')` covers {{SITE_NAME}} automation; also inspect system cron with `crontab -l` and the scripts in `/opt/client-agent/tools/cron/`.
- `run_task_executor.js` is dry-run unless `--apply` is present. If daily logs say tasks were processed but nothing changed, read the executor JSON and verify `dry_run`, selected lanes, task status, and each task execution report.
- Safe SERP tasks can be selected but produce `no_action` if `target_file` is missing or if the SERP task type has no deterministic safe edit. Diagnose candidate generation before enabling auto-apply.
