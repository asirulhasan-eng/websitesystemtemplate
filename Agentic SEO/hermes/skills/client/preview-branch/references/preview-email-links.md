# Preview-ready email links

## Reusable lesson
For {{SITE_NAME}} semi-safe previews, preview-ready emails should make the review action obvious with plain clickable URLs, not just branch names or raw JSON.

## Fields to populate in outbox payload
- `github_branch_url`: link to the pushed `agent/...` branch in `client-site`.
- `github_compare_url`: GitHub compare/open-PR link against production base branch (`master` for `/opt/client-site`).
- `cloudflare_preview_url`: Cloudflare Pages deployment URL when a matching branch deployment exists.
- `cloudflare_blog_url`: Cloudflare preview URL plus derived page path from `target_url`, `target_file`, or metadata.
- `preview_url`: may remain a fallback reference such as `branch:agent/...` when no live Cloudflare URL exists.

## Verification pattern
- Syntax-check email and semi-safe pipeline scripts.
- Run focused tests for preview email link rendering and Cloudflare validation URL behavior.
- Run the full Node test suite before pushing.
- Check Cloudflare Pages deployments before claiming a live preview exists; if no matching branch deployment is returned, say Cloudflare preview/blog URL is not available yet.

## Pitfall
Do not URL-encode the slash in GitHub branch names for `/tree/agent/...` and `/compare/master...agent/...` links. Keeping the slash path form produced usable, readable GitHub links for branch names like `agent/CAND-...`.
