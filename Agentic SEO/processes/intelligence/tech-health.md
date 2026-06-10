---
id: intel-tech-health
name: "Technical Health"
version: 1
type: intelligence_module
description: "Monthly technical scan: Core Web Vitals, indexing, crawl status, sitemap health. Report-only."
schedule: "0 1 1 * *"
trigger:
  schedule: "0 1 1 * *"
  timezone: {{TIMEZONE}}
  can_run_manually: true
cadence:
  monthly_day: 1
  sessions: [morning]
guardrails:
  max_duration_minutes: 20
  abort_on_error: false
outputs:
  - name: "Intelligence report"
    type: report
    description: "Saved via v2 intelligence report (no tasks created)"
---

# Technical Health

> 1st of the month: is the site technically sound â€” fast, indexed, crawlable?

## Scope (REPORT-ONLY)
You are an intelligence module. **Do NOT create, update, or approve tasks** and do NOT apply
fixes. Report technical regressions and risks. Deeper playbooks:
`processes/core-web-vitals-audit.md`, `processes/technical-audit-response.md`.

## Data Gathering
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"
SITE="--site-root /opt/client-site"

node $V2 speed-audit --json
node $V2 index-inspect --json
node $V2 sitemap-audit $SITE --json
node $V2 crawl $SITE --json
node $V2 manual-actions-check $DB --json
node $V2 security-issues-check $DB --json
```

## AI Analysis
- **Core Web Vitals** â€” LCP / INP / CLS regressions vs prior; pages failing thresholds.
- **Indexing** â€” pages dropped from the index, "discovered not indexed", coverage errors.
- **Crawl** â€” crawl errors, redirect chains, crawl-budget waste (low-value URLs being crawled).
- **Sitemap** â€” invalid/missing/orphan URLs in the sitemap.
- **Manual actions / security** â€” any GSC manual action or security issue (escalate hard if present).

Recall Brain memory for known technical issues (`brain recall --query "core web vitals"`).

Severity:
- `critical` â€” manual action / security issue, or money pages deindexed.
- `warning` â€” CWV regressions or indexing/crawl problems on important pages.
- `normal` â€” clean.

### Coverage Block (REQUIRED in every report)
Include a `coverage` object in your report JSON:
```json
{
  "coverage": {
    "scanned_count": "<number of technical metrics examined>",
    "surfaced_top": "<number of items included in opportunities/threats>",
    "floor_applied": "<description of any min-impression or position filter>",
    "deprioritized_reason": "<why some items were excluded, if any>"
  }
}
```
A thin report with coverage data is distinguishable from an empty market. Never omit this block.

## Report Output
```bash
node $V2 intelligence report \
  --module tech-health \
  --session morning \
  --severity "<normal|warning|critical>" \
  --headline "<e.g. 'LCP regressed on 3 service pages; 1 page discovered-not-indexed'>" \
  --report-json '{
    "threats":[{"type":"serp_change","keyword":"<url>","severity":"warning","recommendation":"LCP 4.1s â€” investigate render-blocking resources"}],
    "observations":["No manual actions","Sitemap valid, 2 orphan URLs"],
    "recommendations":[{"priority":"high","action":"Planner: queue a cwv_fix task (risk=safe, general_operational lane — the safe executor lazy-loads below-fold images and defers render-blocking head scripts deterministically) for <pages>","evidence":"LCP > 2.5s on 3 service pages"}],
    "data":{"cwv":{},"indexing":{},"crawl":{},"sitemap":{},"manual_actions":[],"security":[]},
    "coverage":{"scanned_count":"...","surfaced_top":"...","floor_applied":"...","deprioritized_reason":"..."}
  }' \
  $DB --json
```
