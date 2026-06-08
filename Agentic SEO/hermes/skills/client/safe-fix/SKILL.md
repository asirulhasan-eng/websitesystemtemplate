---
name: client-safe-fix
description: Execute safe technical SEO fixes that can auto-push to production
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Safe, Fix]
    related_skills: [client-system-rules]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Safe Fix Runner

## When to Use
When executing tasks classified as "safe" risk level.

## What Qualifies as Safe
- Broken internal link fix
- Broken asset reference fix
- Typo fix
- Missing image alt text
- Sitemap update after approved page
- Malformed schema syntax fix
- Known canonical correction
- Known accidental noindex removal

## What is NOT Safe (even if it seems minor)
- Title rewrite â†’ semi-safe
- Meta description rewrite â†’ semi-safe
- New page â†’ high-risk
- Navigation change â†’ high-risk
- Robots.txt change â†’ high-risk

## Procedure
```bash
cd /opt/client-agent
seo-agent safe-fix --task <TASK_ID> --site-root /opt/client-site
```

Note: older notes may mention `--task-id`, but the current `execute_safe_task.js` requires `--task`. On Linux, pass `--site-root /opt/client-site`; otherwise the script falls back to a Windows development path.

Before reporting success, inspect the execution artifact under `tools/out/executor/`. `status: no_action` is blocked, not completed. For SERP tasks such as `protect_ranking_gain`, verify both prerequisites before rerunning: `target_file` must be populated (for the home page this should resolve to `index.html`) and the executor must have a deterministic safe handler for that task type. If either is missing, report blocked/no production change rather than claiming completion.

The script internally:
1. Acquires required locks
2. Edits files in /opt/client-site
3. Runs local validation (crawler)
4. Commits to production branch
5. Pushes to GitHub
6. Waits for Cloudflare deployment
7. Checks live page health
8. Records deployment in SQLite (atomic transaction)
9. Creates outbox job for Obsidian update
10. Releases locks

## Verification After Fix
```bash
seo-agent deploy-check
seo-agent url-check --url <AFFECTED_URL>
```

## If Validation Fails
- Rollback the commit
- Release all locks
- Mark task as validation_failed in SQLite
- Create alert event
- Report failure to user
