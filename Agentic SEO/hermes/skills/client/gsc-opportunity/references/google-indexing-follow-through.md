# Google indexing follow-through for new/modified {{SITE_NAME}} pages

Use this when the user asks to request indexing/recrawl for new or modified {{SITE_NAME}} site pages, or after publishing pages where Google discovery matters.

## Risk lane
- Safe if limited to reading Search Console, updating `sitemap.xml` lastmod for already-published URLs, submitting the sitemap, and verifying live indexability.
- Semi-safe/high-risk rules still apply if content, robots, canonical, redirects, or production page behavior must change.

## Workflow
1. Load `client-system-rules` first.
2. Identify new/modified public HTML pages from production git history and sitemap:
   - `cd /opt/client-site`
   - `git log --since=<window> --name-status --pretty=format:'COMMIT %H %cd %s' -- '*.html' 'sitemap.xml'`
   - Include the homepage (`index.html` -> `https://{{DOMAIN}}/`) and blog/service/page URLs as appropriate.
   - Exclude no-go sources such as `switch.monster` unless the user explicitly overrides.
3. Ensure each target URL is in `sitemap.xml` and update its `<lastmod>` to the publish/modify date if stale. Validate XML before committing.
4. Run site validation before pushing:
   - `python3` XML parse / URL-presence check.
   - `npm test` in `/opt/client-site` when available.
5. Commit/push safe sitemap-only updates to `master` after validation.
6. Wait for Cloudflare production deployment and verify:
   - Live `sitemap.xml` contains the updated `lastmod` values.
   - Each target URL returns HTTP 200.
   - No `X-Robots-Tag: noindex` and no robots meta `noindex` in the body.
7. Submit updated sitemap to Google Search Console API:
   - Use `tools/lib/env.js` and `tools/lib/gsc.js` from `/opt/client-agent`.
   - Endpoint: `PUT https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{sitemapUrl}`.
   - `siteUrl` is usually `sc-domain:{{DOMAIN}}`; `sitemapUrl` is `https://{{DOMAIN}}/sitemap.xml`.
8. Verify with Search Console read APIs:
   - `GET .../sitemaps/{sitemapUrl}` for sitemap status.
   - URL Inspection API `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` for target URLs.

## OAuth scope pitfall
- The existing {{SITE_NAME}} GSC token may be read-only (`https://www.googleapis.com/auth/webmasters.readonly`). That can inspect URLs but cannot submit sitemaps.
- If sitemap submit returns `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`, generate a Google OAuth consent URL requesting `https://www.googleapis.com/auth/webmasters`, ask the user to approve, and exchange the returned code for an updated refresh token. Do not present this as a permanent tool limitation.
- The deprecated public Google sitemap ping (`https://www.google.com/ping?sitemap=...`) returns 404 and should not be relied on.

## Reporting
Report:
- Risk classification.
- Target URL list and any no-go exclusions.
- Sitemap commit hash if changed.
- Live deployment verification: sitemap updated, HTTP 200, no noindex.
- GSC submit result or exact blocker (`read-only token scope`) plus the OAuth URL/action needed.
- URL Inspection coverage states for key URLs when available.