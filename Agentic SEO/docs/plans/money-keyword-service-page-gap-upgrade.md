# Money Keyword Service-Page Gap Upgrade Implementation Plan

> **For Hermes:** Implement with strict TDD. Do not create service pages or edit production site content. This upgrade creates approval-gated opportunity candidates only.

**Goal:** Ensure commercial/money keywords are never silently downgraded to generic monitoring when the ranking URL is the wrong page type; instead create high-risk, approval-required service-page/architecture review candidates with durable evidence.

**Architecture:** Add a small reusable detector that classifies query intent, normalizes/resolves ranking URLs, checks page-type mismatch, and turns mismatches into task candidates. Integrate it at GSC analysis time so daily/scan outputs and SQLite task insertion receive the upgraded candidate. Keep service-page creation high-risk and approval-gated; do not auto-edit the live site.

**Tech Stack:** Node.js CommonJS tools, SQLite state DB via `node:sqlite`, {{SITE_NAME}} static site inventory under `/opt/client-site`, Node `node:test` regression tests.

---

## System design

### Data flow after upgrade

1. `analyze_gsc_opportunities.js` receives GSC query/page rows.
2. Existing CTR/ranking classifier still computes a baseline task.
3. New `tools/lib/money_page_gaps.js` evaluates the row:
   - query intent (`audit_service`, `maps_gbp_service`, `pricing_service`, `core_seo_service`, `lead_generation_service`, `broad_agency`, `informational`)
   - ranking page type (`home`, `service_page`, `services_index`, `blog_post`, `utility`, `template_or_archive_ignore`, `unknown_or_stale`)
   - redirect-normalized path from `_redirects` where possible
   - expected/acceptable page targets
   - mismatch type and risk
4. If no mismatch: keep the baseline candidate.
5. If mismatch: replace baseline with `source='gsc_money_page_gap'`, `task_type='service_page_gap'`, `risk_level='high_risk'`, `approval_required=true`, and a priority floor.
6. `generate_task_candidates.js` continues to merge/filter/dedupe and insert into SQLite atomically.
7. `task_queue_audit.js` routes `service_page_gap` / `new_service_page` / `service_architecture_review` into general operational approval queue, not blog publishing.

### Why replace instead of append?

A single GSC row should not create both `Monitor "keyword"` and `Evaluate service-page gap...` for the same issue. Replacing the baseline prevents duplicate queues and makes the more strategic task win.

### Risk lane

- Detector/classification only: Safe code behavior.
- Candidate created for service-page decision: `high_risk`, `approval_required=true`.
- Actual new page, redirect, sitemap, nav, homepage, or service-page copy changes: still blocked until approval token/workflow.

---

## Edge cases and safeguards

### Query intent safeguards

- Use curated money-intent buckets, not broad `{{AUDIENCE}}|seo|agency` regex alone.
- Treat broad agency terms (`{{AUDIENCE}} seo agency`, `{{NICHE}} seo agency`) as homepage-acceptable.
- Treat informational modifiers as blog-acceptable:
  - `how to`, `what is`, `guide`, `checklist`, `statistics`, `template`, `tips`, `step by step`, `benefits`, `vs`, `comparison`, `examples`, `best agencies`.
- Money keywords with tiny impressions still get a priority floor because one lead can be valuable.
- `switch.monster` and other no-go terms remain blocked by existing Brain/no-go filters; detector should not weaken those filters.

### Page-type safeguards

- Normalize host, query string, hash, `.html`, trailing slash.
- Resolve `_redirects` before page-type judgment.
- Do not flag `/pages/pricing` if it redirects to `/services/pricing`.
- Do not flag homepage for broad agency intent.
- Do flag blog ranking for specific commercial intent.
- Do flag homepage/services index ranking for narrow service intent as service architecture review.
- Do not auto-create a duplicate page when an existing service page may satisfy the intent; preserve candidate target options in evidence.
- Treat unknown/stale paths as high-risk review, not auto page creation.

### Candidate safeguards

- `task_type`: `service_page_gap` by default.
- `risk_level`: `high_risk`.
- `approval_required`: `true`.
- Include evidence:
  - current ranking URL/page type
  - normalized/resolved path
  - query intent
  - candidate target paths/URLs
  - GSC clicks/impressions/CTR/position
  - mismatch type
  - confidence
  - reasons
- Locks:
  - keyword lock
  - current URL lock
  - target URL/file lock when available
  - money page cluster lock for `service_page_gap`, `new_service_page`, `service_architecture_review`.
- Dedupe remains stable through `candidate_id`/dedupe key.

### Operational safeguards

- No production site writes in this upgrade.
- Existing service-page candidates are review-only.
- New service-page candidates cannot be executed by deterministic safe/blog executor.
- Queue audit must surface them as approval-needed if no approval exists.
- Run tests against temp DBs; do not mutate authoritative DB during unit tests.
- After code tests, run analyzer on a temp DB and then a live read-only/output-only run to inspect classification.

---

## Implementation tasks

### Task 1: Tests for money-page detector library

**Files:**
- Create: `test/money-page-gaps.test.js`
- Create later: `tools/lib/money_page_gaps.js`

**Tests:**
- `google maps seo for {{AUDIENCE}}` ranking `/blog/google-maps-seo-for-{{AUDIENCE}}` => mismatch, high-risk, targets Maps/GBP service options.
- `{{AUDIENCE}} seo agency` ranking homepage => no mismatch.
- `{{NICHE}} full website seo audit services` ranking `/blog/{{NICHE}}-seo-audit-process` => mismatch, audit-service targets.
- `how to do seo for {{AUDIENCE}}` ranking blog => no mismatch.
- `/pages/pricing` for `{{AUDIENCE}} seo pricing` resolves to `/services/pricing` and is not a mismatch.

### Task 2: Implement detector library

**Files:**
- Create: `tools/lib/money_page_gaps.js`
- Create: `config/money_keyword_map.json`

**Functions:**
- `loadMoneyKeywordMap(options)`
- `normalizeRankingUrl(url, options)`
- `classifyPageType(url, options)`
- `classifyQueryIntent(query, map)`
- `detectMoneyPageGap(row, options)`
- `moneyPageGapToCandidate(row, gap, options)`

### Task 3: Integrate detector into GSC analyzer

**Files:**
- Modify: `tools/analyze_gsc_opportunities.js`
- Modify: `test/gsc-opportunities.test.js`

**Behavior:**
- `toOpportunity(row)` returns money-page-gap candidate when detector finds mismatch.
- Existing baseline classification remains for non-gap rows.
- Titles include `Evaluate service-page gap for "keyword"`.
- Snapshot metadata stores task type/risk/priority.

### Task 4: Add routing/locking for service-page tasks

**Files:**
- Modify: `tools/lib/tasks.js`
- Modify: `tools/lib/task_routing.js`
- Modify: `test/task-routing-queues.test.js`

**Behavior:**
- `inferLocks()` adds `money_page_cluster_lock` and relevant locks for `service_page_gap`, `new_service_page`, `money_page_refresh`, `service_architecture_review`.
- `routeTask()` classifies service-page gap tasks as `general_operational` with high confidence.
- Approval-required tasks remain blocked in `approval_needed` until approved.

### Task 5: End-to-end candidate generation test

**Files:**
- Add tests to `test/money-page-gaps.test.js` or `test/gsc-opportunities.test.js`.

**Behavior:**
- A GSC report containing `google maps seo for {{AUDIENCE}}` on a blog generates exactly one high-risk service-page-gap candidate, not a monitor task.
- Candidate insertion into a temp SQLite DB preserves metadata/evidence and `task_type`.

### Task 6: Validation

**Commands:**
- `node --test test/money-page-gaps.test.js`
- `node --test test/gsc-opportunities.test.js test/task-routing-queues.test.js test/serp-db-persistence.test.js`
- `node tools/analyze_gsc_opportunities.js --sample --json --db /tmp/test.db --out /tmp/gsc.json`
- `node tools/analyze_gsc_opportunities.js --days 28 --row-limit 25000 --min-impressions 3 --max-position 30 --out /tmp/gsc-live-money-gap.json --json`

**Expected proof:**
- Tests pass.
- Sample output contains a `service_page_gap` candidate.
- Live output includes high-risk candidates for examples such as Google Maps SEO/audit when mismatch exists.

---

## What may go wrong

- **False positives:** Broad agency keywords on homepage may be wrongly flagged. Guard with `broad_agency` acceptable homepage rule.
- **Duplicate/cannibal pages:** Exact-match blog and proposed service page can overlap. Keep as approval-gated review and list alternatives instead of auto-creating.
- **Redirect confusion:** Legacy `/pages/...` URLs can look wrong. Resolve `_redirects` first.
- **Low-volume suppression:** High-intent terms may have few impressions. Use priority floors by intent.
- **No-go leakage:** No-go terms might become higher-priority candidates. Existing Brain/no-go filters must still run after detector output.
- **Executor misuse:** Service-page-gap tasks must not route into blog publisher or deterministic safe executor. Route to general approval queue.
- **DB schema drift:** Snapshot persistence must use actual schema and store detector fields in metadata JSON.
- **Target file mis-resolution:** Proposed static service page paths should use explicit `.html` target files when available/desired.
- **Over-specific config:** Too many exact rules can miss variants. Use curated patterns plus exact examples; update map as new terms appear.
- **Over-broad regex:** Too broad rules can flood the queue. Keep informational negatives and broad-agency exceptions.

---

## Completion criteria

- Money GSC rows no longer become `Monitor "keyword"` when page-type mismatch is detected.
- `google maps seo for {{AUDIENCE}}` on a blog becomes a high-risk `service_page_gap` candidate.
- `{{NICHE}} full website seo audit services` on a blog becomes a high-risk audit service-page-gap candidate.
- Broad agency homepage rows are not falsely flagged.
- Informational blog rows are not falsely flagged.
- Service gap tasks require approval and are not picked up as blog draft/edit work.
- GSC snapshots persist with detector task metadata.
- Focused tests and relevant regression tests pass.
