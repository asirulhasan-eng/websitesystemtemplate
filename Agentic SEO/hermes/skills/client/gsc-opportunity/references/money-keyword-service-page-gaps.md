# Money Keyword â†’ Service Page Gap Detection

## Lesson captured
A GSC/SERP loop can see high-value commercial keywords but still mishandle them if it only creates monitor, content-refresh, or internal-link tasks. Money queries must be evaluated for page-type fit.

## Trigger examples
- `google maps seo for {{AUDIENCE}}`
- `{{NICHE}} full website seo audit services`
- `{{NICHE}} website seo audit`
- `{{AUDIENCE}} google maps ranking`
- `{{AUDIENCE}} google business profile seo`
- `{{NICHE}} seo audit`
- `{{AUDIENCE}} seo pricing`
- `{{NICHE}} seo services`

## Required decision check
For each commercial/service-intent query, ask:
1. Is the ranking URL a blog post, homepage, old generic page, or no URL in top 30?
2. Is there a dedicated service page that matches the query intent?
3. Should the task be a high-risk service-page architecture candidate instead of a monitor/content-refresh task?
4. Should the existing blog become support content linking to a service page?

## Candidate shape
Create an approval-gated task such as:

```json
{
  "task_type": "service_page_gap",
  "risk_level": "high_risk",
  "approval_required": true,
  "title": "Evaluate dedicated service page for \"google maps seo for {{AUDIENCE}}\"",
  "evidence": {
    "query": "google maps seo for {{AUDIENCE}}",
    "ranking_url": "/blog/google-maps-seo-for-{{AUDIENCE}}",
    "issue": "commercial_query_ranking_on_blog"
  }
}
```

## Priority floor guidance
Do not bury money keywords just because impressions are low.

- Service-intent query + wrong page type: minimum 850
- Service-intent query + position 4â€“30: minimum 900
- Service-intent query ranking on blog: minimum 900
- Service-intent query with no dedicated service page: minimum 875

## Watchdog rule
A money keyword should not remain in `monitored` for more than 48â€“72 hours without an explicit decision: service page, retarget existing page, content refresh, internal-link support, or reject.

## Implemented {{SITE_NAME}} files
- Detector library: `/opt/client-agent/tools/lib/money_page_gaps.js`
- Curated intent map: `/opt/client-agent/config/money_keyword_map.json`
- GSC integration: `/opt/client-agent/tools/analyze_gsc_opportunities.js`
- Routing/locking support: `/opt/client-agent/tools/lib/task_routing.js` and `/opt/client-agent/tools/lib/tasks.js`
- Regression tests: `/opt/client-agent/test/money-page-gaps.test.js` and `/opt/client-agent/test/gsc-opportunities.test.js`

## Verification commands
```bash
cd /opt/client-agent
node --test test/money-page-gaps.test.js test/gsc-opportunities.test.js test/task-routing-queues.test.js test/serp-db-persistence.test.js
node tools/analyze_gsc_opportunities.js --days 28 --row-limit 25000 --min-impressions 3 --max-position 30 --out /tmp/gsc-live-money-gap.json --json
```

## Related implementation pitfalls
- Preserve classifier fields from GSC analyzers: both snake_case and camelCase inputs should map correctly.
- Verify GSC snapshot persistence; non-fatal DB-write errors can silently destroy trend history.
- Resolve `_redirects` before declaring a page-type mismatch, or legacy `/pages/...` URLs will create false positives.
- Broad agency terms may be homepage-acceptable; specific service terms like Maps/GBP/audit/pricing usually require service-page review.
- New service pages and architecture decisions are high-risk and require approval/preview workflow before production.
