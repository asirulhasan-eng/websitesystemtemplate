---
name: client-preview-branch
description: Create GitHub branch and Cloudflare preview for semi-safe SEO changes
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Preview, Semi-safe]
    related_skills: [client-system-rules, client-high-risk-approval]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Preview Branch Creator

## When to Use
When a task is classified as semi-safe: title rewrites, meta rewrites, H1 rewrites, FAQ additions, small content refreshes, schema additions, CTA changes, minor CSS changes.

## Procedure
```bash
cd /opt/client-agent
seo-agent semi-safe --task-id <TASK_ID>
```

Or for just the preview branch part:
```bash
seo-agent preview --task-id <TASK_ID>
```

The pipeline:
1. Acquires file/url/keyword locks
2. Creates branch: `agent/SEO-YYYY-NNN-short-name`
3. Applies changes to website files
4. Runs local validation (crawler)
5. Pushes branch to GitHub
6. Cloudflare Pages auto-creates preview deployment when branch previews are enabled for the configured project
7. Waits for preview URL to be ready
8. Records preview_ready in SQLite (atomic transaction)
9. Creates outbox job for preview email
10. Outbox sends email with review links

## Preview Email Requirements
Preview-ready emails must include plain clickable URLs, not only branch names or JSON payloads:
- GitHub branch URL: `https://github.com/<owner>/<repo>/tree/<branch>`
- GitHub compare / open PR URL against the production base branch (`master` for `/opt/client-site`)
- Cloudflare preview root URL when Cloudflare returns a matching branch deployment
- Cloudflare live blog/page URL when a public path can be derived from `target_url`, `target_file`, or metadata
- Fallback preview reference such as `branch:agent/...` when Cloudflare has not produced a live URL yet

Use `tools/send_email_outbox.js` for email rendering and `tools/run_semi_safe_pipeline.js` for populating `github_branch_url`, `github_compare_url`, `cloudflare_preview_url`, and `cloudflare_blog_url` in the outbox payload. See `references/preview-email-links.md` for field details, verification checks, and GitHub URL pitfalls.

## Cloudflare Preview Diagnostics
Before promising a live Cloudflare blog URL, verify the configured Pages project and branch deployment. The durable project for {{SITE_NAME}} is `clientagency`; the site repo production branch is `master`. If Cloudflare lists only production deployments and no matching `agent/...` branch deployment, report that the email will include GitHub links and mark Cloudflare preview/blog URL as not available yet instead of fabricating a preview URL.

## After Preview is Created
Tell the user:
- Preview URL
- What files were changed
- What the change does
- How to approve (reply to email with approval token)
- How to reject

## Monitoring Preview
```bash
seo-agent deploy-wait --task-id <TASK_ID>
seo-agent url-check --url <PREVIEW_URL>
```

## If User Approves
The email approval checker will pick it up:
```bash
seo-agent email-check
```
Then the approved task will be merged to production.

## If User Rejects
Task is marked rejected. Branch stays for reference. Locks are released.
