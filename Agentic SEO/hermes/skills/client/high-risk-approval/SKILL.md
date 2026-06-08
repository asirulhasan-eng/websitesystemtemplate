---
name: client-high-risk-approval
description: Prepare approval requests for high-risk SEO changes
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, High-risk, Approval]
    related_skills: [client-system-rules]
    requires_tools: [terminal]
---
# {{SITE_NAME}} High-Risk Approval

## When to Use
When a task involves: new pages, page deletion, redirects, robots.txt changes, navigation changes, header/footer changes, large rewrites, site architecture changes, mass updates.

## Procedure
```bash
cd /opt/client-agent
seo-agent high-risk --task-id <TASK_ID>
```

This creates:
1. Task brief in SQLite
2. Approval request with unique token
3. Outbox job to send approval email
4. Obsidian approval note

## What the Approval Email Contains
- Task summary and why it matters
- Files affected
- URLs affected
- Risk level and classification reason
- Preview plan (branch + Cloudflare preview)
- Rollback plan
- Approval token
- Instructions: reply with token to approve, "REJECT" to reject

## What Hermes Should Tell the User
When reporting high-risk tasks:
1. Clearly state this is HIGH-RISK
2. Explain what will change
3. Show the preview URL (if preview was created)
4. Show the rollback plan
5. Tell user to check email for approval link
6. Do NOT proceed without explicit approval

## After Approval is Received
```bash
seo-agent email-check
seo-agent approvals --task-id <TASK_ID> --action process
```

## Critical Rules
- NEVER auto-approve high-risk tasks
- NEVER bypass the approval token system
- NEVER merge to production without validated approval
- Always record approval in SQLite before proceeding
