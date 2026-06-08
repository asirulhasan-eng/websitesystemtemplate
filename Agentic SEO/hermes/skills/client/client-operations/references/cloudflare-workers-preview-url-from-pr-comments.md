# Cloudflare Workers preview URLs from GitHub PR comments

## When this applies
Use this when a {{SITE_NAME}} semi-safe site branch has a GitHub PR, but Wrangler is not authenticated or `wrangler deployments list` cannot be used from the server.

## Pattern
Cloudflare Workers Git integration posts a bot comment on the PR with preview URLs. The useful values are usually in the issue comments, not necessarily in GitHub Deployments or check-run APIs.

## Commands
From `/opt/client-site`:

```bash
# Inspect the PR and branch
gh pr view <PR_NUMBER> --json number,url,headRefName,baseRefName,mergeable,state --jq .

# Pull Cloudflare bot comments; look for "Commit Preview URL" and "Branch Preview URL"
gh api repos/asirulhasan-eng/client-site/issues/<PR_NUMBER>/comments \
  --jq '.[] | select(.user.login | test("cloudflare"; "i")) | {user:.user.login, body:.body, url:.html_url, created_at:.created_at}'
```

If `gh api repos/.../deployments` or check-run APIs return `Resource not accessible by personal access token`, do not treat that as a blocker. The Cloudflare bot PR comment can still contain the preview URL.

## Verification
Verify the branch preview root and at least one changed behavior before reporting:

```bash
curl -I --connect-timeout 10 --max-time 20 \
  'https://<branch-preview-host>/blog/call-tracking-for-{{AUDIENCE}}'

curl -I --connect-timeout 10 --max-time 20 \
  'https://<branch-preview-host>/blog/switch-monster-vs-callrail'
```

Expected for the Switch.monster redirect cleanup:

- Target guide: `HTTP/2 200`
- Redirected slug: `HTTP/2 301` with `location: /blog/call-tracking-for-{{AUDIENCE}}`
- Preview responses may include `x-robots-tag: noindex`; this is normal for preview hosts.

## Reporting
Report:

- Risk classification: Safe inspection only, unless you merge/deploy.
- Branch preview URL first.
- Commit preview URL second, if present.
- The exact HTTP status evidence for target and redirected pages.
- Source: Cloudflare bot comment on the PR.
