# Merge a Semi-Safe {{SITE_NAME}} PR and Verify Production

Use this when the user explicitly approves merging a semi-safe {{SITE_NAME}} PR/preview branch.

## Pattern
1. State risk clearly before acting: **Semi-safe, approved by user** â€” merging can change public production behavior once Cloudflare deploys the default branch.
2. Pre-merge checks in `/opt/client-site`:
   ```bash
   git status --short --branch
   gh pr view <PR> --json number,state,title,url,isDraft,mergeable,baseRefName,headRefName,reviewDecision
   gh pr status
   ```
   Proceed only if the PR is open, mergeable, and checks are passing.
3. Merge with a clean history and remove the remote branch:
   ```bash
   gh pr merge <PR> --squash --delete-branch --subject '<clear subject> (#<PR>)'
   ```
4. Sync local default branch:
   ```bash
   git checkout master
   git pull --ff-only origin master
   git log -1 --oneline
   git status --short --branch
   ```
5. Verify production, not just GitHub. For redirect changes, test both the target page and old URLs:
   ```bash
   curl -sS -I https://{{DOMAIN}}/blog/call-tracking-for-{{AUDIENCE}} | sed -n '1,12p'
   curl -sS -I https://{{DOMAIN}}/blog/switch-monster-vs-callrail | sed -n '1,16p'
   curl -sS -I -L --max-redirs 5 https://{{DOMAIN}}/blog/switch-monster-vs-callrail | sed -n '1,40p'
   ```
6. Verify sitemap from production. If Python `urllib` gets a bot/security 403, retry with curl and a browser-like User-Agent:
   ```bash
   curl -sS -L -A 'Mozilla/5.0 Hermes verification' https://{{DOMAIN}}/sitemap.xml -o /tmp/client-sitemap.xml -w 'http_code=%{http_code}\n'
   python3 - <<'PY'
   from pathlib import Path
   import xml.etree.ElementTree as ET
   data = Path('/tmp/client-sitemap.xml').read_text(errors='ignore')
   ET.fromstring(data)
   print('sitemap_xml_valid=true')
   print('switch_monster_count=', data.count('switch-monster'))
   PY
   ```

## Pitfalls
- Do not report success immediately after `gh pr merge`; Cloudflare may need a short time before production behavior changes. Verify production headers.
- Before merging production, check for scheduled blog/executor workers and a dirty `/opt/client-site`. If a preview-only blog worker is actively dirtying the repo, either wait briefly or stop it, preserve partial work with `git stash push -u`, and hold `/tmp/client-blog-publisher.lock` plus `/tmp/client-task-executor.lock` while merging so cron does not start a competing writer.
- When merging multiple blog PRs one after another, later PRs commonly conflict in `blog/index.html`, `sitemap.xml`, and `tools/link-registry.json`. Resolve by keeping both blog cards, both sitemap `<url>` entries, and both link-registry objects; validate no conflict markers, JSON parses, sitemap XML parses, each new slug appears once in sitemap and registry, then push the updated PR branch before merging.
- Avoid mixing `curl -D -` with `-o /tmp/file` when parsing response headers from a file; `-D -` writes headers to stdout, not the file. Use `curl -sS -I` for simple header verification, or `-D /tmp/headers` if you need to parse later.
- Keep preview status, PR merge status, and production status separate in the report.

## Reporting Checklist
Include:
- Risk classification and user approval.
- PR URL, merged state, merge commit, and whether branch deletion happened.
- Production target page status.
- Redirect status and `location` header for changed URLs.
- Sitemap validity and removed URL count.
- Local repo branch/status after sync.
- Commands run.
