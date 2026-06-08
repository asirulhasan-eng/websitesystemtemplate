---
name: client-gsc-opportunity
description: Analyze Google Search Console data to find SEO opportunities
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, GSC, Opportunities]
    related_skills: [client-system-rules, client-daily-loop]
    requires_tools: [terminal]
---
# {{SITE_NAME}} GSC Opportunity Finder

## When to Use
When user asks: "Check GSC", "Find opportunities", "What's ranking?", "Any CTR improvements?", or during the daily/bi-daily opportunity scan.

## Procedure
```bash
cd /opt/client-agent
seo-agent gsc
seo-agent opportunities
```

## Google Indexing / Recrawl Follow-through
When the user asks to request indexing for new or modified {{SITE_NAME}} pages, follow `references/google-indexing-follow-through.md`: identify changed public URLs, filter no-go sources, update/validate sitemap lastmod, verify live 200/indexable pages, submit the sitemap through Search Console with write scope, and report URL Inspection coverage states or the exact OAuth scope blocker.

## What It Looks For
1. High-impression, low-CTR pages (title/meta opportunity)
2. Keywords ranking positions 4-15 (push-to-top opportunity)
3. Keywords ranking 15-30 (content improvement opportunity)
4. Wrong URL ranking for a keyword
5. Pages losing position over time
6. New keywords appearing
7. Pages with impressions but no clicks
8. Money-keyword page-type mismatch: commercial/service intent ranking on a blog or homepage when a dedicated service page may be needed
9. Service-page gaps for queries like `google maps seo for {{AUDIENCE}}`, `{{NICHE}} website seo audit`, `{{NICHE}} full website seo audit services`, `{{AUDIENCE}} google business profile seo`, etc.

## Current Failure Modes to Check
- `analyze_gsc_opportunities.js` must preserve classifier fields (`task_type`, `risk_level`, `approval_required`). A camelCase/snake_case mismatch turns actionable GSC rows into generic `Monitor "keyword"` tasks with null `task_type`.
- GSC snapshot persistence must actually insert rows. If `gsc_snapshots` has no `task_type`/`risk_level`/`priority_score` columns but the tool tries to insert them, the write fails non-fatally and trend data is lost.
- Do not treat low-impression commercial terms as low value by default. Money keywords can deserve high-risk service-page candidates even with modest impressions.
- New service pages are high-risk: create/route as approval-gated candidates, not automatic production edits.

## Output
- Creates task candidates in SQLite
- Scores each opportunity 1-1000
- Classifies risk level
- Persists GSC rows in SQLite `gsc_snapshots` or an explicitly documented snapshot store; verify the write succeeded before reporting trend analysis

## References
- `references/google-indexing-follow-through.md` â€” recrawl/indexing follow-through.
- `references/money-keyword-service-page-gaps.md` â€” required checks for commercial queries that may need dedicated service pages instead of monitor/blog-refresh tasks.
- `references/money-keyword-service-page-gap-upgrade-2026-06-03.md` â€” implementation notes, verification commands, and the snapshot/current-ranking-URL pitfall from the money-keyword upgrade.

## Reporting to User
Summarize findings as:
- "X opportunities found"
- Top 5 by priority score
- Which ones are safe vs semi-safe vs high-risk
- Recommended next actions
