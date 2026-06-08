# Money Keyword Service-Page Gap Upgrade â€” 2026-06-03

## Session lesson
The GSC/SERP opportunity loop was over-randomizing and over-monitoring: high-commercial-intent queries with modest impressions were being treated like generic monitor/content-refresh work. For {{SITE_NAME}}, one lead from a service-intent query can outweigh many informational impressions, so money keywords need their own page-type and priority rules.

## Durable workflow
When reviewing GSC opportunities, add an explicit page-type check before accepting the default classifier:

1. Detect commercial/service intent from the query.
2. Resolve redirects before comparing page types.
3. Compare the current ranking URL against expected page type:
   - blog ranking for service-intent query => service-page gap candidate
   - homepage ranking for broad agency terms => often acceptable
   - homepage ranking for specific service terms => service-page gap candidate
   - existing specific service page ranking => usually optimize existing page, not create a new one
4. Preserve both URLs in evidence:
   - `gsc_page` / current ranking URL from Search Console
   - proposed `target_url` service page
5. Route service-page architecture tasks as high-risk and approval-gated.
6. Add money-page cluster locks to prevent concurrent service-page architecture edits.
7. Verify with both unit tests and live GSC output before reporting success.

## Concrete implementation points from this session
- Detector: `/opt/client-agent/tools/lib/money_page_gaps.js`
- Intent map: `/opt/client-agent/config/money_keyword_map.json`
- GSC integration: `/opt/client-agent/tools/analyze_gsc_opportunities.js`
- Routing: `/opt/client-agent/tools/lib/task_routing.js`
- Locks: `/opt/client-agent/tools/lib/tasks.js`
- Plan doc: `/opt/client-agent/docs/plans/money-keyword-service-page-gap-upgrade.md`

## Verification commands used
```bash
cd /opt/client-agent
node --test test/money-page-gaps.test.js test/gsc-opportunities.test.js test/task-routing-queues.test.js test/serp-db-persistence.test.js
node --test test/*.test.js
node tools/analyze_gsc_opportunities.js --days 28 --row-limit 25000 --min-impressions 3 --max-position 30 --db /opt/client-sqlite/seo-agent.db --out /tmp/gsc-live-money-gap-final.json --json
```

## Important pitfall fixed
Do not overwrite the persisted GSC snapshot `page` with the proposed service-page `target_url`. Trend/snapshot tables need the original ranking URL from GSC, while the task candidate can target the proposed service URL. Store both in metadata/evidence.

## Example candidates generated
- `google maps seo for {{AUDIENCE}}` => service-page gap, current ranking URL was a blog page, target service page `/services/google-maps-seo-for-{{AUDIENCE}}`.
- `{{NICHE}} full website seo audit services` => service-page gap, current ranking URL was a blog page, target service page `/services/{{NICHE}}-seo-audit`.

## Safety rule
Creating or restructuring money/service pages is high-risk. Candidate generation may seed approval-gated tasks, but executors must not create or publish service pages without explicit approval and preview/validation workflow.
