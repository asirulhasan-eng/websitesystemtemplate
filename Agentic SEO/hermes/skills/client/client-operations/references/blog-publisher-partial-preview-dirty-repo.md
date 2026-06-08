# Blog publisher partial preview dirty-repo recovery

Use when `/opt/client-site` is dirty after a blog-publisher run and cron workers start refusing with messages like `Website repo is dirty; refusing to start blog publisher` or `Website repo is dirty; refusing to start task executor`.

## Class-level lesson

Unexpected dirty repos are a failure signal, not something to blindly clean. For blog-publisher runs, dirtiness may mean a valid semi-safe preview was generated but Hermes stopped before final integration/commit/state-recording. Preserve and finish legitimate preview work when validation passes; only discard after explicit user direction or clear evidence the draft is bad.

## Recovery sequence

1. Classify risk before acting:
   - Read-only inspection: Safe.
   - Completing a preview branch/PR: Semi-safe.
   - Merging/publishing production: High-risk unless already approved.
2. Inspect the site repo and identify whether the dirty files are generated preview artifacts:
   - `git status --short --branch`
   - `git diff --stat`
   - inspect article HTML, generated images, integration files, and task metadata.
3. If the article/images look legitimate, complete missing integration instead of resetting:
   - add blog card to `blog/index.html`
   - add canonical clean URL to `sitemap.xml`
   - add entry to `tools/link-registry.json`
   - remove leftover scaffold markers such as `FAQSCHEMA_MARKER`
   - restore noisy scaffold logs if they are not meaningful deliverables.
4. Validate before commit:
   - article exists, exactly one H1
   - no scaffold/TODO/placeholder markers
   - JSON-LD parses
   - all article images have alt text
   - referenced image files exist
   - index, sitemap, and link registry include the slug
   - infographic guard passes with the required AI manifest
   - floating CTA assets pass
   - local HTTP server returns 200 for blog index, article, and image assets.
5. Commit and push the preview branch; create a PR against `master`.
6. Wait/check for Cloudflare preview comment, then verify the preview article and image URLs return 200.
7. Record state with `tools/record_blog_preview_ready.js`, including real commit SHA, PR URL, changed files, validation evidence, and Cloudflare preview URLs when available.
8. Process Obsidian/email outbox jobs, then commit/push SQLite and Obsidian repo changes.
9. Return `/opt/client-site` to clean `master` and verify all {{SITE_NAME}} repos are clean.
10. Run a dry-run preflight of the blog publisher cron to prove dirty-repo guards are no longer blocking.

## Commands pattern

```bash
# Validate site artifacts locally
python3 -m http.server 8765 --bind 127.0.0.1
curl -L -s -o /tmp/body -w '%{http_code}' http://127.0.0.1:8765/blog/<slug>.html

# Create preview PR
git add <article> <images> blog/index.html sitemap.xml tools/link-registry.json
git commit -m "Add <topic> guide preview"
git push -u origin <branch>
gh pr create --base master --head <branch> --title "..." --body "..."

# Record preview state
node tools/record_blog_preview_ready.js \
  --db /opt/client-sqlite/seo-agent.db \
  --task <task_id> \
  --site-root /opt/client-site \
  --branch <branch> \
  --commit <sha> \
  --pr-url <pr_url> \
  --cloudflare-preview <preview_root_url> \
  --cloudflare-blog <preview_article_url> \
  --files "<comma-separated files>" \
  --validation-status passed \
  --validation-summary "<evidence>" \
  --json

# Sync state mirrors/outbox
node tools/sync_obsidian_outbox.js --db /opt/client-sqlite/seo-agent.db --obsidian-root /opt/client-obsidian --limit 25 --json
node tools/send_email_outbox.js --db /opt/client-sqlite/seo-agent.db --limit 5 --json
```

## Pitfalls

- Do not use `git reset --hard` or `git clean` as the first response. Inspect whether preview work is valuable.
- Do not commit scaffold logs unless they are intentional deliverables; restore noisy logs when they only record generation chatter.
- Do not leave the site repo on a preview branch after recovery. Checkout clean `master` so scheduled workers can pass preflight.
- If a dry-run cron selects a new task and dirties SQLite/Obsidian through normal worker side effects, process/commit those state changes too before declaring all repos clean.
- If the run stopped at the Hermes turn limit, increase the relevant cron default only in the worker script, keep the environment override behavior, and validate shell syntax/tests.
