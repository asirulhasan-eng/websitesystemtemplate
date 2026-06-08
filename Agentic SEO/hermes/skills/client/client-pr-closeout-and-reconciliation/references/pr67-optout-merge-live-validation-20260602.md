# PR 67 opt-out wording merge + live validation notes (2026-06-02)

Session-specific evidence for the class-level {{SITE_NAME}} PR closeout workflow.

## Context

- Repo: `/opt/client-site`
- PR: `#67` â€” Email/SMS follow-up {{AUDIENCE}} blog
- Target file: `blog/email-sms-follow-up-{{AUDIENCE}}-unsold-estimates-maintenance-plans.html`
- User ask: fix/push/merge, solving conflict if any; ensure SMS templates include opt-out wording such as `Reply STOP to opt out.`

## Durable workflow lessons

1. **Do exact conflict marker checks.**
   - A broad scan for `=======` falsely matched decorative HTML separator comments.
   - Use anchored markers: `grep -R -n -E '^(<<<<<<<|=======|>>>>>>>)' <files>`.

2. **Preserve unrelated dirty work before PR merge, then restore it.**
   - The repo had unrelated Atlanta branch work in the worktree.
   - Safe path used `git stash push -u` before checkout/merge, then restored the stash back onto the original branch after PR 67 merged.
   - Report remaining dirty paths as unrelated evidence, not as PR merge failure.

3. **Post-merge live checks can briefly lag.**
   - GitHub merge succeeded and `origin/master` contained the article, sitemap, and index references.
   - The first production URL fetch returned 404; a short cache-busted poll then returned HTTP 200 with the expected article content.
   - Do not immediately escalate to manual Cloudflare deploy if origin proof is good and the first live check is just-after-merge 404.

4. **Close out SQLite/Obsidian with evidence.**
   - Run live deployment validation once production is visible.
   - Mark the related deployment/task as deployed and enqueue/sync Obsidian outbox.
   - For terminal task closeout, ensure a `task_status_changed` event exists with source/proof metadata and `completed_at` set.

## Evidence shape from this session

- PR state: `MERGED`
- Merge commit: `46cfd2f64c205f2cbc6bd4f15d044e607cb7419b`
- Live URL: `https://{{DOMAIN}}/blog/email-sms-follow-up-{{AUDIENCE}}-unsold-estimates-maintenance-plans`
- Live validation: HTTP 200; title present; meta description present; canonical present; no noindex; content size OK.
- SMS opt-out evidence: live body contained `Reply STOP to opt out.` 8 times.
