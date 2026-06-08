# Preview branch review fix via isolated worktree

Use this when a review comment targets a {{SITE_NAME}} preview/agent branch and the main `/opt/client-site` checkout should remain on production `master` for autopilot/cron safety.

## Pattern
1. Classify the edit before touching files. Small compliance wording, typo, alt text, or markup-preserving fixes are usually Safe; content expansion/reframing remains semi-safe.
2. Keep `/opt/client-site` clean and on `master` when possible. Do not rely on switching the shared checkout to the preview branch if cron/autopilot may also use it.
3. Create a temporary detached worktree from the remote branch:
   ```bash
   cd /opt/client-site
   git fetch origin <branch>
   rm -rf /tmp/client-site-<short-topic>
   git worktree add --detach /tmp/client-site-<short-topic> origin/<branch>
   ```
4. Patch and validate inside the temp worktree:
   ```bash
   cd /tmp/client-site-<short-topic>
   npm test
   python3 - <<'PY'
   from html.parser import HTMLParser
   from pathlib import Path
   p = Path('blog/example.html')
   html = p.read_text()
   parser = HTMLParser(); parser.feed(html); parser.close()
   print('html_parser=ok')
   PY
   git diff --check
   ```
   Add a focused content assertion when the review requested specific wording (for example, check every copyable SMS template includes `Reply STOP to opt out.`).
5. Commit and push back to the same preview branch:
   ```bash
   git add <changed-files>
   git commit -m "<concise fix message>"
   git push origin HEAD:<branch>
   ```
6. Verify push and clean up:
   ```bash
   git ls-remote origin refs/heads/<branch>
   git worktree remove /tmp/client-site-<short-topic>
   git -C /opt/client-site status --short --branch
   ```
7. If the local branch should track the updated remote, refresh it explicitly from the shared checkout:
   ```bash
   git -C /opt/client-site branch -f <branch> origin/<branch>
   ```

## Pitfalls
- Checking out a preview branch in the shared `/opt/client-site` checkout can collide with generated/autopilot worktree state and, if mishandled, can leave unmerged paths on `master`. If that happens, first recover the shared checkout with `git reset --hard HEAD` only after confirming there are no local changes to preserve, then continue in a temp worktree.
- `git rev-parse --short local remote` is invalid for two revisions in one command; run two separate `git rev-parse --short` commands when comparing local and origin branch tips.
- For PR review fixes, report the pushed commit, branch, PR URL, validation commands, and that the main checkout remained clean.