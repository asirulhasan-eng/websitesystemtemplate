# Resume a Semi-Safe Preview Branch

Use this when a later session asks to â€œresumeâ€ or revisit a previously created semi-safe {{SITE_NAME}} branch/PR.

## Pattern
1. Start with a proportional risk note: **Semi-safe inspection only** if you are only checking repo/branch/redirect status. Do not merge or deploy without explicit approval.
2. Use session history to recover the branch, commit, and prior report if the user references an old PR/review URL.
3. In `/opt/client-site`, verify the branch state:
   ```bash
   git status --short --branch
   git log -1 --oneline
   git ls-remote --heads origin <branch>
   ```
4. Re-verify the actual change, not just the existence of the branch. For redirect branches, check `_redirects`, target page existence, sitemap validity, and removed sitemap URLs.
5. Compare against current `origin/master` before telling the user it is ready:
   ```bash
   git fetch origin master <branch>
   git rev-list --left-right --count origin/master...HEAD
   git diff --name-status origin/master...HEAD
   base=$(git merge-base origin/master HEAD)
   git merge-tree "$base" origin/master HEAD
   ```
   Report if the branch is behind/ahead and whether the merge-tree output contains conflict markers.
6. Run the same build/deploy dry-run validation used when the branch was created:
   ```bash
   npx wrangler deploy --dry-run
   ```
7. Check production behavior separately so the user knows whether the change is live:
   ```bash
   curl -I https://{{DOMAIN}}/<target>
   curl -I https://{{DOMAIN}}/<old-url>
   ```

## Reporting
Include:
- Risk classification and confirmation that no merge/deploy happened.
- Branch name, commit, and PR creation/review URL.
- Verification bullets for the actual content/redirect behavior.
- Production status separately from branch status.
- Commands run.
- Next action, usually review/merge the PR link.

## Pitfalls
- Do not infer that a pushed branch is live. Verify production URLs independently.
- Do not treat lack of `gh` or unauthenticated GitHub API access as a blocker to reporting branch status; use `git ls-remote`, local branch state, and the PR creation URL.
- Avoid recording branch names, commit SHAs, and PR URLs as durable memory; keep them in the session report or this reference only as examples of the workflow shape.
