# {{SITE_NAME}} v2 SEO Agent Recommendations

This document combines the critical review of the existing v2 process playbooks with the additional enterprise SEO review notes. It is written as an implementation blueprint for upgrading the current process set into a full-stack SEO agency agent, excluding off-page link building.

The key recommendation is simple:

> Treat v2 as an SEO operating system, not a rank-tracking/content-production bot.

The agent should protect indexability, improve relevant organic visibility, prevent SEO debt, and prioritize work by search impact. Rankings and impressions matter, but they are inputs. The end goal is clean technical health, durable trust, relevant traffic growth, and controlled execution risk.

## 1. Current State Summary

The existing playbooks are strongest in these areas:

- Daily, bi-daily, weekly, and monthly SEO cadence.
- GSC and SERP monitoring.
- Task generation and task triage.
- Content gaps, wrong-page ranking, and cannibalization diagnosis.
- Service page and blog workflow discipline.
- Ranking emergency anti-panic guidance.
- Basic deployment safety through locks, branches, previews, and approvals.

The current process system is weakest in these areas:

- Machine-readable process consistency.
- Sub-process orchestration.
- Async/pause/resume handling.
- Retry, backoff, and failure-loop safeguards.
- Analytics data quality for organic traffic and engagement checks.
- Indexation, URL Inspection, Page Indexing, Crawl Stats, and sitemap validation.
- Core Web Vitals and page experience.
- Structured data validation and visible-content parity.
- Local SEO and geolocated SERP handling.
- E-E-A-T/trust asset auditing.
- Content pruning and consolidation.
- AI Overviews, AI Mode, and broader SERP feature visibility.
- Differentiated task lanes for automated fixes vs copy review vs human approval.

## 2. Guiding Principles For The Upgrade

Use these principles to decide how every process should behave.

1. Search impact beats vanity rankings.
   - A task that improves indexation, topical relevance, or relevant organic traffic is more important than a task that increases irrelevant impressions.
   - Weekly and monthly reporting should include crawl/indexation health, money keyword visibility, relevant organic clicks, and content quality signals, not only rank positions.

2. Indexability is the foundation.
   - Before content optimization, confirm the page is crawlable, returns HTTP 200, is not blocked, has indexable content, and has a sensible canonical.
   - Google documentation frames these as minimum technical requirements for Search eligibility.

3. GSC is delayed; live checks are required.
   - GSC performance data can lag by days.
   - Daily checks must include live status, crawl, robots, noindex, canonical, uptime, and analytics anomaly checks.

4. Do not optimize by formulas.
   - Remove keyword density targets.
   - Avoid arbitrary word count goals.
   - Use SERP intent, topical coverage, expertise, and user usefulness instead.

5. Use semantic relevance, not exact-match repetition.
   - Internal anchors should be varied and contextual.
   - Related pages should link only when the source page and destination page have meaningful topical overlap.

6. Risk is not only technical.
   - New content can create cannibalization.
   - Internal links can dilute or distort intent.
   - Schema can create manual-action risk if misleading.

7. Every task needs evidence.
   - No task should be created without source data, date range, affected URL, target keyword or topic, confidence, and expected outcome.

8. Separate task lanes.
   - Safe automated fixes should not wait behind copy review.
   - High-risk page, URL, navigation, robots, canonical, redirect, and schema changes need explicit review gates.

9. New content is the last resort when existing assets can be improved.
   - Prefer refresh, expansion, consolidation, or better internal linking when those solve the user intent better than creating another page.

10. Local and national SEO must be parameterized.
   - {{SITE_NAME}}.agency itself is an SEO agency.
   - Client local SEO playbooks may target {{AUDIENCE}} categories and local service keywords.
   - Do not hard-code "{{AUDIENCE}}" GBP categories or "emergency {{AUDIENCE}}" checks for the agency site unless the target client is actually a {{AUDIENCE}}.

## 3. Priority 0: Upgrade The Process Contract

Before adding many playbooks, make the process system reliable for agents and schedulers.

### 3.1 Normalize YAML Frontmatter

Several Markdown files are human-readable only and do not include the schema contract. Add YAML frontmatter to every process file.

Files that need frontmatter:

- `processes/weekly-review.md`
- `processes/task-triage.md`
- `processes/ranking-emergency.md`
- `processes/new-blog-creation.md`
- `processes/monthly-roadmap.md`
- `processes/content-gap-analysis.md`

Every playbook should include at minimum:

```yaml
---
id: ranking-emergency
name: "Ranking Emergency Response"
version: 2
description: "Investigate and respond to confirmed ranking, indexation, or traffic emergencies."
trigger:
  schedule: "event:ranking_drop"
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
guardrails:
  max_tasks_created: 8
  max_risk_level: semi_safe
  require_human_review_for:
    - url_change
    - redirect_setup
    - navigation_change
    - homepage_edit
    - schema_policy_risk
  max_duration_minutes: 90
  abort_on_error: false
outputs:
  - name: "Incident report"
    type: report
    description: "Root cause, evidence, actions, and follow-up checks"
---
```

### 3.2 Extend `schema.json`

Add fields for process orchestration, async execution, retry safeguards, task lanes, required evidence, and standard enums.

Recommended additions:

```json
{
  "subprocesses": {
    "type": "array",
    "items": {
      "type": "object",
      "required": ["process_id", "trigger_condition", "params"],
      "properties": {
        "process_id": { "type": "string" },
        "trigger_condition": { "type": "string" },
        "params": { "type": "object" },
        "inherit_context": { "type": "boolean", "default": true },
        "blocking": { "type": "boolean", "default": true }
      }
    }
  },
  "async_behavior": {
    "type": "object",
    "properties": {
      "supports_pause_resume": { "type": "boolean", "default": false },
      "poll_interval_seconds": { "type": "integer", "default": 30 },
      "max_wait_seconds": { "type": "integer", "default": 900 },
      "on_timeout": {
        "type": "string",
        "enum": ["abort", "alert", "continue", "create_followup_task"],
        "default": "alert"
      }
    }
  },
  "retry_policy": {
    "type": "object",
    "properties": {
      "max_attempts": { "type": "integer", "default": 3 },
      "backoff_strategy": {
        "type": "string",
        "enum": ["none", "linear", "exponential"],
        "default": "exponential"
      },
      "initial_delay_seconds": { "type": "integer", "default": 30 },
      "alert_after_attempts": { "type": "integer", "default": 2 }
    }
  },
  "task_lanes": {
    "type": "array",
    "items": {
      "type": "string",
      "enum": [
        "automated_safe",
        "technical_review",
        "copy_review",
        "client_approval",
        "high_risk",
        "monitoring"
      ]
    }
  },
  "evidence_requirements": {
    "type": "object",
    "properties": {
      "requires_source": { "type": "boolean", "default": true },
      "requires_date_range": { "type": "boolean", "default": true },
      "requires_url": { "type": "boolean", "default": true },
      "requires_keyword_or_topic": { "type": "boolean", "default": true },
      "requires_confidence": { "type": "boolean", "default": true },
      "requires_expected_outcome": { "type": "boolean", "default": true }
    }
  }
}
```

### 3.3 Standardize Risk Levels

Use one controlled set of risk labels everywhere.

Recommended risk enum:

- `safe`: additive, reversible, no ranking/indexation surface affected.
- `low`: minor metadata/content/internal link changes on non-money pages.
- `semi_safe`: existing page edits, service page edits, schema additions, internal link strategy changes.
- `high_risk`: URL changes, redirects, canonical changes, robots, sitemap strategy, navigation, homepage, ranking money page rewrites.
- `critical`: emergency fixes requiring fast action but still needing smoke tests and rollback.

Important correction:

- Do not call new content or internal links "no risk."
- New content can cannibalize.
- Internal links can distort relevance or over-optimize anchors.

### 3.4 Standardize Priority

Do not mix numeric and string priorities unless the CLI explicitly supports both.

Recommended model:

```yaml
priority:
  label: high
  score: 850
```

Priority labels:

- `critical`: 900-1000
- `high`: 750-899
- `medium`: 500-749
- `low`: 250-499
- `backlog`: 0-249

## 4. Amendments To Existing Playbooks

This section lists the concrete edits to make in each existing playbook.

### 4.1 `daily-workplan.md`

Current role:

- Core heartbeat.
- GSC opportunity scan.
- SERP checks.
- Task creation.

Problems:

- Too dependent on delayed GSC data.
- No live analytics anomaly checks.
- Alert thresholds can create alert fatigue.
- No real-time indexability or uptime checks.
- No sub-process spawning.

Required changes:

1. Add live technical checks before GSC analysis:

```bash
v2 health-check --url https://{{DOMAIN}} --json
v2 crawl --url https://{{DOMAIN}} --depth 1 --json
v2 page-meta --url https://{{DOMAIN}} --json
v2 sitemap-audit --url https://{{DOMAIN}}/sitemap.xml --json
v2 robots-check --url https://{{DOMAIN}}/robots.txt --json
```

2. Add optional GA4 traffic and engagement checks:

```bash
v2 ga4-fetch --days 3 --channel organic --metrics sessions,engaged_sessions,average_engagement_time --json
```

3. Add sub-process triggers:

```yaml
subprocesses:
  - process_id: ranking-emergency
    trigger_condition: "money_keyword_drop_confirmed == true"
    params:
      keyword: "{{keyword}}"
      url: "{{landing_page}}"
      old_position: "{{baseline_position}}"
      new_position: "{{current_position}}"
  - process_id: indexation-recovery
    trigger_condition: "new_money_page_not_indexed_after_7_days == true"
    params:
      url: "{{url}}"
  - process_id: technical-audit-response
    trigger_condition: "live_crawl_critical_issue == true"
    params:
      affected_urls: "{{affected_urls}}"
```

4. Tighten alert thresholds:

Alert only when at least one of these is true:

- Money keyword 7-day average drops 3 or more positions and impressions are at least 50/week.
- Money keyword exits page 1.
- Service page returns non-200, noindex, blocked canonical, or broken template.
- Manual action or security issue detected.
- Critical task stale for more than 7 days.

5. Change "Position 1 should be 25-35 percent CTR" to position-adjusted directional checks.

Use:

- Compare CTR against the page's own historical CTR.
- Compare CTR against SERP feature changes.
- Compare branded vs non-branded queries separately.
- Treat low CTR as hypothesis, not proof.

6. Add anti-noise logic for impression spikes:

Before creating a task from an impression spike, confirm:

- Query is relevant to buyer or authority strategy.
- Impressions persist for at least two comparable windows.
- CTR is not zero across all exposures unless position is very low.
- SERP intent matches target page type.
- GA4 landing sessions show at least some user engagement if the page receives clicks.

### 4.2 `opportunity-scan.md`

Current role:

- Bi-daily deeper scan.
- Emerging/declining keywords.
- Internal link opportunities.
- SERP landscape.

Problems:

- Can overreact to GSC impression tests.
- Internal linking rule is too mechanical.
- No semantic source/destination matching.
- No AI Overviews/AI Mode/SERP feature capture.

Required changes:

1. Add impression spike validation:

```markdown
Before treating a spike as demand, classify it:

- True demand: relevant query, persistent growth, matching SERP intent, clicks or improving position.
- Google testing: short-lived impressions, zero clicks, unstable landing page, unrelated query.
- Seasonal event: recurring industry pattern or known calendar effect.
- Noise: low impressions, unrelated intent, no persistence.
```

2. Add semantic internal link check:

```bash
v2 semantic-match --source-url "<source>" --target-url "<target>" --json
```

Only create internal link tasks when:

- Source page topic overlaps with destination topic.
- Link helps the reader.
- Destination is a natural next step.
- Anchor can be contextual, not forced.

3. Add SERP feature extraction:

```bash
v2 serp-check --from-tracked --include-features --include-paa --include-ai-overview --json
```

Track:

- Featured snippets.
- People Also Ask.
- Local packs.
- Video/image results.
- AI Overviews/AI Mode supporting links where available.
- Review stars/rich result competitors.

### 4.3 `task-triage.md`

Current role:

- Prioritize tasks with BIRD score.
- Manage queue.

Problems:

- Single queue creates bottleneck.
- New/internal link/content risk is underrated.
- Backlog can grow indefinitely.
- No lane-specific WIP limits.

Required changes:

1. Split the queue into lanes:

| Lane | Examples | WIP limit | Review |
|---|---|---:|---|
| `automated_safe` | missing alt, broken internal link, typo, minor metadata on low-risk page | 5 | automated smoke test |
| `technical_review` | schema, canonical, sitemap, CWV, render fixes | 3 | technical approval |
| `copy_review` | blog, service page copy, content refresh | 2 | editorial approval |
| `client_approval` | new service page, offer/pricing, homepage, case study | 2 | human approval |
| `high_risk` | redirects, URL changes, robots, navigation | 1 | explicit human approval |
| `monitoring` | post-publish checks, ranking follow-up | 10 | automated |

2. Replace "No risk: adding content, new internal links, new pages" with:

```markdown
Low to semi-safe risk: additions are usually reversible, but can still create cannibalization, dilute relevance, or blur page intent. Evaluate target page type, keyword overlap, and internal-link context before execution.
```

3. Add automatic pruning rule:

```markdown
If a low-priority task remains open for more than 30 days and its evidence has not improved, archive it unless it supports an active monthly focus area.
```

4. Add stale evidence rule:

```markdown
If source SERP/GSC evidence is older than 14 days for a high-priority task, refresh evidence before execution.
```

### 4.4 `weekly-review.md`

Current role:

- Weekly performance and task review.

Problems:

- Rankings/clicks heavy.
- No analytics quality or pipeline health by lane.
- Backlog growth loop not strict enough.

Required changes:

Add a weekly scorecard with:

| Metric | Source | Why it matters |
|---|---|---|
| Money keyword clicks | GSC | Qualified demand |
| Money page sessions | GA4, if available | Landing page traffic quality |
| Organic engaged sessions | GA4, if available | Whether search traffic is finding useful content |
| Indexed service pages | GSC/index inspect | Technical eligibility |
| Core Web Vitals poor URLs | GSC/PSI | UX and technical risk |
| Critical technical issues | Crawl | Immediate risk |
| Tasks created vs completed | DB | Agent sustainability |
| Tasks by lane | DB | Bottleneck visibility |

Add a weekly pruning section:

- Archive stale low-priority tasks.
- Refresh evidence for high-priority tasks older than 14 days.
- Escalate if tasks created exceed tasks completed for 2 consecutive weeks.

### 4.5 `monthly-roadmap.md`

Current role:

- Monthly strategy and planning.

Problems:

- Missing analytics data-quality review.
- Missing entity/trust footprint.
- Missing content pruning.
- Missing technical budget.

Required changes:

Add monthly sections:

1. Traffic quality and analytics health.
   - High-impression/low-click pages.
   - High-click/low-engagement pages, if GA4 is available.
   - Pages with GSC clicks but missing or suspicious analytics sessions.
   - Organic engagement by page and keyword cluster, if available.

2. Entity and trust health.
   - Brand searches.
   - About/contact/author/case study completeness.
   - Review/testimonial assets.
   - Knowledge panel or brand SERP changes where relevant.

3. Content lifecycle.
   - New content published.
   - Content refreshed.
   - Content merged.
   - Content pruned/noindexed/redirected.

4. Technical roadmap.
   - CWV priorities.
   - Indexation issues.
   - Sitemap/canonical/redirect issues.
   - Structured data coverage.

5. Resource planning.
   - Work by task lane.
   - Expected review bottlenecks.
   - Tasks that require human decisions.

### 4.6 `new-blog-creation.md`

Current role:

- Validate and produce strategic blog posts.

Problems:

- No source/fact policy.
- No SME review.
- No rich media requirement.
- "Semantic SEO / NLP" should be handled carefully.
- No explicit indexation/sitemap update.

Required changes:

1. Add source and claim policy:

```markdown
Every factual claim must be one of:

- First-hand company/client experience.
- Publicly verifiable source.
- Clearly framed opinion or recommendation.
- Common industry knowledge that does not require a hard citation.

Claims about rankings, ROI, timelines, prices, legal compliance, or Google behavior require evidence or cautious language.
```

2. Add SME review gate for high-trust content:

```markdown
If the post discusses technical SEO, local SEO, pricing, case studies, or business outcomes, route through `copy_review` or `client_approval` before publishing.
```

3. Replace "LSI" with entity/topic coverage:

```markdown
Identify entities, terms, and concepts that a helpful expert answer would naturally include. Do not inject terms mechanically. Include them only when they improve clarity, completeness, or user usefulness.
```

4. Add rich media brief:

Every blog brief should decide whether it needs:

- Comparison table.
- Checklist.
- Process diagram.
- Example screenshot.
- Calculator/template.
- Before/after example.
- Short video or visual embed.

5. Add post-publish technical steps:

```bash
v2 sitemap-audit --contains "/blog/<slug>/" --json
v2 index-inspect --url "https://{{DOMAIN}}/blog/<slug>/" --json
v2 schema-validate --url "https://{{DOMAIN}}/blog/<slug>/" --json
```

### 4.7 `service-page-update.md`

Current role:

- Optimize existing service pages.

Problems:

- Keyword density target is outdated.
- No renderability check.

Required changes:

1. Remove:

```markdown
Primary keyword density is 1-2%
```

Replace with:

```markdown
Primary and related terms appear naturally in prominent places when useful: title, H1, intro, headings, body, alt text, internal anchors, and schema where accurate.
```

2. Add verification:

```bash
v2 render-check --url "https://preview.{{DOMAIN}}/services/<slug>/" --user-agent googlebot --json
v2 schema-validate --url "https://preview.{{DOMAIN}}/services/<slug>/" --json
v2 link-check --url "https://preview.{{DOMAIN}}/services/<slug>/" --json
```

3. Add search-intent review:

- Is the value proposition clear in the first viewport?
- Does the page match commercial intent?
- Is the primary topic clear without relying on hidden or JavaScript-only content?
- Are supporting subtopics useful and non-duplicative?
- Are internal links helping the reader move to related resources?

### 4.8 `content-gap-analysis.md`

Current role:

- Wrong page, no page, cannibalization diagnosis.

Problems:

- Exact-match anchor instruction is too aggressive.
- Intent shifts are under-modeled.
- Redirect cleanup is incomplete.

Required changes:

1. Add top-10 intent distribution before choosing action:

```markdown
Classify the top 10 results by intent:

- Service/commercial.
- Comparison/pricing.
- Educational guide.
- Local/map.
- Directory/list.
- Tool/template.
- Mixed.

If Google currently prefers guides, do not force a service page unless the service page can genuinely satisfy the observed intent.
```

2. Replace exact-match anchor guidance with:

```markdown
Add internal links from relevant pages using contextual anchors. Use a mix of descriptive, partial-match, and natural anchors. Avoid repeated exact-match anchors across many pages.
```

3. Add redirect cleanup checklist:

When merging or redirecting:

- Create 301 redirect.
- Update internal links to point to final URL.
- Remove redirected URL from sitemap.
- Confirm canonical points to final URL.
- Check for redirect chains.
- Re-crawl affected URLs.
- Inspect old and new URLs in GSC.
- Monitor GSC for 2-4 weeks.

### 4.9 `ranking-emergency.md`

Current role:

- Ranking drop response.

Problems:

- Manual action/security checks missing.
- Deindexing and demotion are not separated enough.
- Emergency deploy lacks formal smoke tests.

Required changes:

1. Add first-response checks:

```bash
v2 manual-actions-check --json
v2 security-issues-check --json
v2 index-inspect --url "https://{{DOMAIN}}/<affected-page>/" --json
v2 crawl --url "https://{{DOMAIN}}/<affected-page>/" --json
v2 page-meta --url "https://{{DOMAIN}}/<affected-page>/" --json
```

2. Split root cause categories:

| Category | Signals | Response |
|---|---|---|
| Deindexed | not indexed, blocked, noindex, canonical elsewhere | fix technical/indexation immediately |
| Crawling failure | 4xx/5xx, robots block, DNS/CDN issue | emergency technical fix |
| Render failure | critical text not in rendered HTML, JS error | render/debug fix |
| Manual/security issue | GSC report | follow review/remediation protocol |
| Algorithmic demotion | broad query/page pattern, industry volatility | monitor, compare quality, avoid panic changes |
| Intent shift | top results changed type | adjust page/content strategy |
| Competitor improvement | specific competitor overtakes | competitive response |
| SERP layout change | feature pushes organic down | snippet/AIO/local/video response |

3. Add emergency release protocol:

Fast fixes may bypass full editorial review only when they restore a broken state. They still require:

- Diff summary.
- Smoke test.
- Live status check.
- Rollback command.
- Post-deploy monitor task.

### 4.10 `technical-audit-response.md`

Current role:

- Crawl issue response.

Problems:

- Too focused on title/meta/canonical basics.
- Missing sitemap, CWV, renderability, structured data, index coverage.

Required changes:

Add audit modules:

1. Crawl/indexability:
   - HTTP status.
   - Robots.
   - Noindex.
   - Canonical.
   - Redirect chain.
   - Sitemap inclusion.
   - Internal link depth.

2. Renderability:
   - Googlebot-rendered content.
   - JS errors.
   - Hidden/tabbed critical content.
   - Mobile rendering.

3. Structured data:
   - Valid JSON-LD.
   - Required properties.
   - Visible-content parity.
   - No misleading reviews or unsupported claims.

4. Performance:
   - LCP.
   - CLS.
   - INP.
   - TTFB.
   - Image/font/script diagnostics.

5. Sitemap:
   - No 404 URLs.
   - No redirected URLs.
   - No noindex URLs.
   - Canonical URLs only.
   - Important pages included.

### 4.11 `competitor-analysis.md`

Current role:

- Competitor identification and content gap tasks.

Problems:

- National SERPs only.
- No geolocation.
- No E-E-A-T/trust analysis.
- Assumes competitor keyword discovery without API.

Required changes:

1. Add geolocated rank checks:

```bash
v2 serp-check --keywords "<keyword>" --local-coords "<lat,long>" --device mobile --json
v2 serp-check --keywords "<keyword>" --location "Dallas, TX" --device desktop --json
```

2. Add trust comparison:

Audit competitors for:

- Clear business identity.
- Real authors/experts.
- Case studies.
- Reviews/testimonials.
- Contact details.
- Pricing/offer clarity.
- Credentials/associations.
- About page depth.
- Schema completeness.

3. Add tool dependency note:

```markdown
Competitor keyword gap discovery requires a third-party keyword/ranking provider such as DataForSEO, Semrush, Ahrefs, or a similar API. `v2 serp-check` can verify known keywords, but it cannot discover all competitor rankings by itself.
```

### 4.12 `monthly-roadmap.md`

Also add a "not to do" section:

- Do not create new content if existing content has unresolved cannibalization.
- Do not scale content production if indexation rate is poor.
- Do not optimize metadata if the page is not indexable or does not match search intent.
- Do not chase national terms if local/geolocated rankings drive the business case.

## 5. New Playbooks To Add

Create the following new process files after the schema/frontmatter cleanup.

### 5.1 `analytics-data-quality-audit.md`

Purpose:

- Make SEO decisions from clean traffic and engagement data, not only rankings.

Trigger:

- Weekly.
- After analytics or site template changes.
- When GSC clicks and analytics sessions diverge unexpectedly.
- When organic traffic rises but engagement quality drops.
- When reporting appears incomplete or inconsistent.

Required data:

```bash
v2 ga4-fetch --days 28 --channel organic --json
v2 gsc-fetch --days 28 --min-impressions 10 --json
v2 analytics-audit --url https://{{DOMAIN}} --json
```

Checks:

- GA4 or the chosen analytics tool is installed on all indexable templates.
- Organic traffic channel is correctly classified.
- Pageview/session tracking works on all major page types.
- GSC clicks roughly reconcile with analytics organic sessions, allowing for known differences.
- Landing page reports are available by URL.
- Engagement metrics are available if analytics supports them.
- Missing analytics coverage on indexable pages is flagged.
- Bot/spam anomalies are identified where possible.
- Analytics discrepancies are noted rather than treated as ranking changes.

Task examples:

```bash
v2 task create --title "Analytics: Fix missing pageview tracking on blog template" \
  --type analytics_fix --priority 700 --risk-level low \
  --target-file "blog/template.html" \
  --description "GSC shows clicks to blog URLs, but analytics sessions are missing for the blog template. Verify analytics script coverage and record before/after data." \
  --json
```

Acceptance criteria:

- All indexable templates have analytics coverage if analytics is in use.
- Organic traffic can be reviewed by landing page.
- GSC/analytics discrepancies are documented and understood.

### 5.2 `indexation-recovery.md`

Purpose:

- Diagnose and fix pages that Google is not indexing or has dropped from the index.

Trigger:

- Weekly.
- New service/blog page not indexed after 7 days.
- Ranking emergency indicates deindexing.
- GSC Page Indexing issue appears.

Required data:

```bash
v2 index-inspect --url "https://{{DOMAIN}}/<url>/" --json
v2 crawl --url "https://{{DOMAIN}}/<url>/" --json
v2 page-meta --url "https://{{DOMAIN}}/<url>/" --json
v2 sitemap-audit --contains "/<url>/" --json
v2 link-depth --url "/<url>/" --json
```

Diagnosis:

| Issue | Likely meaning | Action |
|---|---|---|
| Blocked by robots | Crawl blocked | fix robots or route |
| Noindex | Indexing explicitly blocked | remove noindex if page should rank |
| Alternate canonical | Google picked another URL | canonical/content/internal link review |
| Discovered, not indexed | Google knows URL but has not crawled | improve internal links, sitemap, crawl priority |
| Crawled, not indexed | Google saw page but chose not to index | improve uniqueness, depth, trust, canonical clarity |
| 404/soft 404 | Page unavailable or thin | restore, improve, redirect, or 410 |

Acceptance criteria:

- Important URL returns 200.
- Not blocked by robots.
- No noindex.
- Self-canonical unless intentionally canonicalized.
- In sitemap if indexable.
- Internally linked from relevant pages.
- URL Inspection shows crawl/index request submitted where appropriate.

### 5.3 `core-web-vitals-audit.md`

Purpose:

- Monitor and improve LCP, CLS, INP, and broader page experience.

Trigger:

- Monthly.
- After template/media/script changes.
- When GSC Core Web Vitals reports poor URLs.

Required data:

```bash
v2 speed-audit --url https://{{DOMAIN}} --strategy mobile --json
v2 speed-audit --url https://{{DOMAIN}}/services/{{NICHE}}-seo/ --strategy mobile --json
v2 crawl --url https://{{DOMAIN}} --performance-summary --json
```

Checks:

- LCP target: less than 2.5s.
- CLS target: less than 0.1.
- INP target: less than 200ms.
- TTFB problems.
- Render-blocking CSS/JS.
- Unoptimized hero images.
- Missing image dimensions.
- Lazy-loaded LCP image.
- Font loading shifts.
- Third-party script delays.

Task examples:

```bash
v2 task create --title "Perf: Improve LCP on homepage hero" \
  --type technical_fix --priority 750 --risk-level semi_safe \
  --target-file "index.html" \
  --description "Mobile speed audit shows hero image is the LCP element. Convert to WebP/AVIF, preload or fetchpriority high, and ensure it is not lazy-loaded." \
  --json
```

Acceptance criteria:

- No poor CWV URLs for money templates.
- Performance changes do not break layout, visible content, or internal navigation.
- Before/after metrics are recorded.

### 5.4 `structured-data-audit.md`

Purpose:

- Validate that structured data is accurate, eligible, complete, and aligned with visible content.

Trigger:

- Monthly.
- After page/template/schema changes.
- When rich result eligibility changes.
- During technical audit.

Required data:

```bash
v2 schema-validate --url https://{{DOMAIN}} --json
v2 schema-validate --url https://{{DOMAIN}}/services/{{NICHE}}-seo/ --json
v2 schema-validate --url https://{{DOMAIN}}/blog/<slug>/ --json
```

Checks:

- JSON-LD parses.
- Required properties present.
- Recommended properties considered.
- Schema type matches page purpose.
- Marked-up content is visible to users.
- No fake reviews, unsupported ratings, or misleading claims.
- Breadcrumb schema matches visible hierarchy.
- Organization/LocalBusiness/Service/Article/ProfilePage usage is appropriate.

Acceptance criteria:

- No syntax errors.
- No policy-risk schema.
- Money pages have correct primary schema.
- Blog posts have Article/BlogPosting and author linkage where appropriate.

### 5.5 `search-performance-diagnostics.md`

Purpose:

- Diagnose traffic, CTR, engagement, and SERP-feature anomalies using SEO and analytics evidence only.

Trigger:

- Monthly.
- When clicks drop while average position is stable.
- When impressions rise but CTR drops.
- When analytics sessions diverge from GSC clicks.
- Before and after major service page or content updates.

Required data:

```bash
v2 gsc-fetch --days 28 --url-contains "/services/<slug>/" --json
v2 ga4-fetch --days 28 --url "/services/<slug>/" --json
v2 serp-check --keywords "<target-keyword>" --include-features --json
v2 page-read --url "https://{{DOMAIN}}/services/<slug>/" --json
```

Checks:

- Query intent matches page intent.
- Title/meta match the observed SERP and page content.
- CTR changes align with position or SERP-feature changes.
- Page topic is clear in visible rendered content.
- Internal links support the target topic.
- Analytics engagement, if available, is not obviously anomalous.
- Page matches query intent.
- No intrusive UX elements.

Task examples:

```bash
v2 task create --title "Search performance: Diagnose CTR drop on {{NICHE}} SEO service page" \
  --type performance_diagnostic --priority 750 --risk-level low \
  --target-url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" \
  --description "GSC shows stable position but declining CTR for a money keyword. Check title/meta, SERP feature changes, snippet eligibility, and whether the ranking page still matches observed search intent." \
  --json
```

Acceptance criteria:

- Diagnosis distinguishes ranking, CTR, SERP-feature, analytics, and intent issues.
- Any recommended page change has clear search evidence.
- Follow-up monitoring task exists.

### 5.6 `content-pruning-consolidation.md`

Purpose:

- Remove or improve low-value index bloat and consolidate duplicate/thin assets.

Trigger:

- Twice per year.
- Monthly if content production is high.
- When many pages have zero clicks and low impressions.

Required data:

```bash
v2 gsc-fetch --days 180 --min-impressions 0 --json
v2 site-pages --json
v2 site-links --orphans --json
v2 sitemap-audit --json
v2 backlink-check --url "<url>" --json
```

Decision matrix:

| Action | Use when |
|---|---|
| Refresh | Topic is valuable, page is outdated or thin |
| Merge and 301 | Another stronger page satisfies same intent |
| Noindex | Page has user/business value but no search value |
| Delete and 410 | No traffic, no links, no business value, no replacement |
| Keep | Low traffic but strategically important trust/legal/utility page |

Important safeguards:

- Do not prune pages with backlinks without review.
- Do not prune pages supporting trust, legal requirements, or internal navigation without review.
- Update internal links and sitemap after any redirect/noindex/delete.

Acceptance criteria:

- No redirected/noindex/deleted URLs remain in sitemap.
- Internal links point to final URLs.
- GSC monitoring task created.

### 5.7 `eeat-trust-signal-audit.md`

Purpose:

- Improve trust, transparency, expertise, and brand credibility.

Trigger:

- Quarterly.
- After Google core update.
- Before scaling content.
- When competitor trust assets are stronger.

Checks:

- About page exists and is credible.
- Contact page has clear public organization details appropriate to the business.
- Author bios exist for blog posts.
- Author profile pages exist for recurring authors.
- Case studies show real outcomes without unsupported claims.
- Testimonials/reviews are visible and legitimate.
- Privacy, terms, and policies are accessible.
- Organization schema is accurate.
- Team/author credentials are not fabricated.

Task examples:

```bash
v2 task create --title "Trust: Add author profile for recurring SEO content author" \
  --type trust_asset --priority 650 --risk-level low \
  --description "Create an author profile page with professional background, topical expertise, social links, and links to published posts." \
  --json
```

Acceptance criteria:

- Every new expert article has author attribution.
- Trust pages are internally linked.
- Claims are supportable.

### 5.8 `internal-linking-architecture.md`

Purpose:

- Build internal links based on user value, semantic relevance, and topic architecture.

Trigger:

- Monthly.
- After publishing new content.
- During service page updates.
- When orphan/low-link pages are found.

Required data:

```bash
v2 site-links --json
v2 site-links --orphans --json
v2 semantic-match --source-url "<source>" --target-url "<target>" --json
v2 gsc-fetch --days 28 --url-contains "<target>" --json
```

Rules:

- Do not add links just because a page has fewer than 3 incoming links.
- Source and destination must overlap topically.
- Anchor text should be natural and varied.
- Service pages should receive links from relevant guides, case studies, and related service pages.
- Blog posts should link to service or strategic pages where it helps the reader.
- Avoid sitewide exact-match links.

Acceptance criteria:

- No orphan money pages.
- Internal links help users.
- Anchors are varied.
- Link changes are documented.

### 5.9 `local-seo-gbp-optimization.md`

Purpose:

- Audit and improve local entity signals for clients with local businesses.

Important caveat:

- Use this playbook for {{AUDIENCE}} clients or local-service clients.
- Do not hard-code {{AUDIENCE}} categories for {{SITE_NAME}}.agency unless the target property is a {{NICHE}} company.
- Parameterize the playbook by `client_business_type`, `service_area`, `primary_category`, `locations`, and `target_keywords`.

Trigger:

- Weekly for active local SEO clients.
- When map pack ranking drops.
- When NAP changes.
- When adding a new service area.

Required data:

```bash
v2 local-config --client "<client-id>" --json
v2 serp-check --keywords "<keyword>" --local-coords "<lat,long>" --device mobile --json
v2 page-meta --url "<client-homepage>" --json
v2 schema-validate --url "<client-homepage>" --json
```

Checks:

- NAP consistency.
- GBP primary/secondary category fit.
- GBP URL and UTM tagging.
- Website NAP matches GBP.
- LocalBusiness subtype schema where appropriate.
- geo and areaServed accuracy.
- Location/service area pages are not thin duplicates.
- Reviews are represented accurately and not marked up misleadingly.

Acceptance criteria:

- Local rank checks are geolocated.
- NAP conflicts create manual outreach tasks.
- Schema reflects visible business data.

### 5.10 `serp-features-ai-visibility.md`

Purpose:

- Track and optimize visibility across modern SERP features, including AI Overviews and AI Mode where data is available.

Trigger:

- Monthly.
- When CTR drops while position is stable.
- When SERP layout changes.
- During content brief creation.

Required data:

```bash
v2 serp-check --keywords "<keyword>" --include-features --include-paa --include-ai-overview --json
v2 page-meta --url "<target-url>" --json
v2 schema-validate --url "<target-url>" --json
```

Checks:

- Featured snippet format.
- PAA questions.
- AI Overview supporting links where visible.
- Image/video presence.
- Local pack.
- Review/rich result competitors.
- Snippet eligibility.
- Query fan-out opportunities.

Optimization rules:

- Be indexable and snippet-eligible.
- Answer core questions clearly.
- Use concise definitions where useful.
- Add tables/checklists/process steps when they help users.
- Use structured data only when valid.
- Do not hide content from users just to influence snippets.

Acceptance criteria:

- SERP feature changes are stored by keyword.
- CTR drops are interpreted in context of SERP layout.
- Content briefs include SERP feature targets only when realistic.

### 5.11 `site-migration-url-change.md`

Purpose:

- Govern high-risk URL, navigation, redirect, or domain changes.

Trigger:

- Any URL slug change.
- Navigation restructure.
- Domain/subdomain move.
- CMS/template migration.
- Bulk redirect work.

Required data:

```bash
v2 site-pages --json
v2 gsc-fetch --days 90 --json
v2 backlink-check --all --json
v2 sitemap-audit --json
```

Required steps:

- Build URL map.
- Preserve high-value URLs where possible.
- Map old URLs to best equivalent new URLs.
- Avoid redirect chains.
- Update canonicals.
- Update internal links.
- Update sitemap.
- Validate robots/noindex.
- Deploy preview.
- Crawl old and new URLs.
- Monitor GSC for 4-8 weeks.

Acceptance criteria:

- 100 percent of valuable old URLs have a final destination.
- No important old URLs 404 unexpectedly.
- Sitemap contains only canonical 200 URLs.
- Human approval recorded.

### 5.12 `editorial-qa-sme-review.md`

Purpose:

- Ensure AI-assisted content is accurate, useful, differentiated, and trustworthy.

Trigger:

- Before publishing any new blog.
- Before major service page rewrite.
- Before case study or claim-heavy content.

Checks:

- Intent match.
- Audience fit.
- Original angle.
- Specific examples.
- Unsupported claims.
- Factual accuracy.
- Source quality.
- Author/SME review.
- Relevant internal next step for the reader.
- Internal links.
- No duplicate overlap with existing pages.

Acceptance criteria:

- Reviewer notes stored.
- Claims are supported or softened.
- Content is not generic.
- Content has a clear next step for the user.

## 6. CLI And Tooling Requirements

The playbooks above require more CLI capability than currently described.

### 6.1 Required CLI Additions

| Command | Purpose |
|---|---|
| `v2 ga4-fetch` | Pull GA4 organic sessions and engagement, if GA4 is in use |
| `v2 analytics-audit` | Validate analytics coverage on indexable templates |
| `v2 index-inspect` | URL Inspection API or equivalent indexing status |
| `v2 sitemap-audit` | Validate sitemap URLs, status, canonical, indexability |
| `v2 robots-check` | Validate robots rules against target URLs |
| `v2 speed-audit` | PSI/Lighthouse/WebPageTest metrics |
| `v2 schema-validate` | Rich Results/schema validation wrapper |
| `v2 render-check` | Render with Googlebot/mobile user agent and compare content |
| `v2 semantic-match` | Score topical relevance between source and target page |
| `v2 link-check` | Find internal links to a target URL and broken local internal links |
| `v2 link-depth` | Measure clicks from homepage/nav to target URL |
| `v2 manual-actions-check` | Normalize GSC Manual Actions evidence or require UI verification |
| `v2 security-issues-check` | Normalize GSC Security Issues evidence or require UI verification |
| `v2 competitor-keyword-gap` | Third-party keyword gap provider |
| `v2 backlink-check` | Link data provider for pruning/migration risk |

### 6.2 SERP Check Enhancements

Enhance `v2 serp-check` with:

- `--local-coords`
- `--location`
- `--device`
- `--language`
- `--include-features`
- `--include-paa`
- `--include-ai-overview`
- `--top`
- `--search-type` for web/image/video/local if supported

### 6.3 Data Model Additions

Add tables or fields for:

- Process runs.
- Sub-process parent/child relationships.
- Async step state.
- Retry attempts.
- Task lane.
- Evidence JSON.
- Expected outcome.
- Actual outcome.
- Organic traffic and engagement metrics by URL, if analytics is in use.
- Indexation status by URL.
- CWV metrics by URL/template.
- SERP features by keyword/location/device.
- Content lifecycle status.

Minimum task evidence JSON:

```json
{
  "source": "gsc",
  "date_range": "2026-05-06..2026-06-02",
  "url": "https://{{DOMAIN}}/services/{{NICHE}}-seo/",
  "keyword": "{{NICHE}} SEO services",
  "metric_snapshot": {
    "clicks": 14,
    "impressions": 340,
    "ctr": 0.041,
    "position": 7.2
  },
  "serp_snapshot_id": "serp_2026_06_03_kw_123",
  "confidence": "medium",
  "expected_outcome": "Improve CTR and position within 2-4 weeks"
}
```

## 7. Recommended Implementation Sequence

### Phase 1: Make The Existing Agent Reliable

Implement first:

1. Normalize frontmatter across all existing playbooks.
2. Extend `schema.json` with subprocess, async, retry, task lanes, evidence.
3. Standardize priority and risk values.
4. Update `task-triage.md` for lane-based execution.
5. Add evidence requirements to task creation examples.

Success criteria:

- Every playbook validates against schema.
- Every process can be scheduled or manually invoked consistently.
- Every task has lane, risk, priority, evidence, and expected outcome.

### Phase 2: Add Analytics Data Quality And Indexation

Implement:

1. `analytics-data-quality-audit.md`
2. `indexation-recovery.md`
3. CLI: `v2 ga4-fetch`, `v2 analytics-audit`, `v2 index-inspect`, `v2 sitemap-audit`
4. Amend daily/weekly/monthly playbooks to include analytics data quality and indexation metrics.

Success criteria:

- Weekly report includes organic traffic quality, if analytics is available.
- New pages are monitored for indexing.
- Money pages have live indexability checks.

### Phase 3: Harden Technical SEO

Implement:

1. `core-web-vitals-audit.md`
2. `structured-data-audit.md`
3. CLI: `v2 speed-audit`, `v2 schema-validate`, `v2 render-check`
4. Expand `technical-audit-response.md`.

Success criteria:

- Technical audit covers crawl, index, render, schema, sitemap, CWV.
- Schema changes are validated against policy and visible page content.
- Money templates have CWV monitoring.

### Phase 4: Protect Content Quality

Implement:

1. `search-performance-diagnostics.md`
2. `editorial-qa-sme-review.md`
3. Amend `service-page-update.md`
4. Amend `new-blog-creation.md`

Success criteria:

- Service page updates preserve search intent, rendered content, internal links, and schema validity.
- Blog posts require source/claim review.
- Content briefs include rich media when useful.

### Phase 5: Improve Strategy And Cleanup

Implement:

1. `content-pruning-consolidation.md`
2. `internal-linking-architecture.md`
3. Amend `content-gap-analysis.md`
4. Add monthly content lifecycle reporting.

Success criteria:

- Low-value pages are refreshed, merged, noindexed, or pruned.
- No redirected/noindex URLs remain in sitemap.
- Internal linking is semantic and user-first.

### Phase 6: Add Local And Modern SERP Coverage

Implement:

1. `local-seo-gbp-optimization.md`
2. `serp-features-ai-visibility.md`
3. Amend `competitor-analysis.md`
4. Enhance `v2 serp-check`.

Success criteria:

- Local clients can be tracked by coordinate/device.
- SERP feature changes explain CTR/ranking anomalies.
- AI Overview/AI Mode visibility is monitored where available.

## 8. Red Flags To Remove From The Current Docs

Remove or rewrite these ideas:

1. Keyword density targets.
   - Replace with natural usage and topical completeness.

2. Exact-match anchor repetition.
   - Replace with contextual, varied anchors.

3. "New content is no risk."
   - Replace with cannibalization and index bloat risk.

4. "Word count competitive with ranking competitors" as a target.
   - Word count can be an observation, not a goal.

5. "Deploy immediately with no preview" without smoke tests.
   - Emergency fixes can be fast, but require validation and rollback.

6. Hard-coded local SEO settings.
   - Parameterize by client and business type.

7. Competitor keyword discovery without third-party data.
   - State dependency clearly.

## 9. Reporting Model

### Daily Report

Include:

- System health.
- Live crawl/indexability issues.
- GSC opportunities and threats.
- Analytics organic traffic anomaly, if analytics is available.
- New/updated tasks by lane.
- Emergencies spawned.
- Items needing human review.

### Weekly Report

Include:

- Money keyword performance.
- Money page sessions and engagement, if analytics is available.
- Technical health summary.
- Indexation changes.
- CWV issues.
- Tasks created vs completed.
- Backlog by lane.
- Pruned/archived tasks.
- Next week's top priorities.

### Monthly Roadmap

Include:

- Organic visibility and traffic quality.
- Content lifecycle.
- Technical debt.
- Competitive landscape.
- SERP feature changes.
- Trust/E-E-A-T gaps.
- Resource plan by lane.
- Strategic bets for the month.

## 10. Official Reference Links

Use these as baseline guidance when implementing:

- Google Search Essentials: https://developers.google.com/search/docs/essentials
- Google technical requirements: https://developers.google.com/search/docs/essentials/technical
- Helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Structured data guidelines: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- AI features and your website: https://developers.google.com/search/docs/appearance/ai-features
- Page experience: https://developers.google.com/search/docs/appearance/page-experience
- Manual actions report: https://support.google.com/webmasters/answer/9044175
- Security issues report: https://support.google.com/webmasters/answer/9044101

## 11. Final Implementation Checklist

Use this checklist as the work queue.

### Schema And System

- [ ] Add frontmatter to all Markdown playbooks.
- [x] Extend schema with subprocess orchestration.
- [x] Add async behavior.
- [x] Add retry/backoff policy.
- [ ] Add task lanes.
- [ ] Add evidence requirements.
- [ ] Normalize risk labels.
- [ ] Normalize priority labels/scores.

### Existing Playbooks

- [ ] Amend `daily-workplan.md`.
- [x] Amend `opportunity-scan.md`.
- [ ] Amend `task-triage.md`.
- [ ] Amend `weekly-review.md`.
- [ ] Amend `monthly-roadmap.md`.
- [ ] Amend `new-blog-creation.md`.
- [ ] Amend `service-page-update.md`.
- [x] Amend `content-gap-analysis.md`.
- [x] Amend `ranking-emergency.md`.
- [x] Amend `technical-audit-response.md`.
- [ ] Amend `competitor-analysis.md`.

### New Playbooks

- [ ] Add `analytics-data-quality-audit.md`.
- [ ] Add `indexation-recovery.md`.
- [x] Add `core-web-vitals-audit.md`.
- [ ] Add `structured-data-audit.md`.
- [ ] Add `search-performance-diagnostics.md`.
- [ ] Add `content-pruning-consolidation.md`.
- [ ] Add `eeat-trust-signal-audit.md`.
- [x] Add `internal-linking-architecture.md`.
- [ ] Add `local-seo-gbp-optimization.md`.
- [ ] Add `serp-features-ai-visibility.md`.
- [ ] Add `site-migration-url-change.md`.
- [ ] Add `editorial-qa-sme-review.md`.

### CLI

- [ ] Add `v2 ga4-fetch`.
- [ ] Add `v2 analytics-audit`.
- [x] Add `v2 index-inspect`.
- [x] Add `v2 sitemap-audit`.
- [ ] Add `v2 robots-check`.
- [x] Add `v2 speed-audit`.
- [ ] Add `v2 schema-validate`.
- [ ] Add `v2 render-check`.
- [x] Add `v2 semantic-match`.
- [x] Add `v2 link-check`.
- [ ] Add `v2 link-depth`.
- [x] Add `v2 manual-actions-check`.
- [x] Add `v2 security-issues-check`.
- [ ] Add geolocated SERP support.
- [ ] Add competitor keyword gap integration if needed.

### Acceptance Criteria For The Full Upgrade

- [ ] The agent can identify and fix indexation failures before waiting for ranking data.
- [ ] Weekly reports show indexation, technical health, and relevant search performance, not only rankings.
- [ ] Emergency response distinguishes deindexing from demotion.
- [ ] Service page updates preserve rendered content, schema validity, and internal-link intent.
- [ ] Internal links are added only with semantic relevance.
- [ ] Content creation is gated by intent, evidence, differentiation, and review.
- [ ] Technical audits include CWV, structured data, sitemap, render, crawl, and index checks.
- [ ] Task backlog cannot grow indefinitely without pruning.
- [ ] Local SEO is parameterized by client/location/business type.
- [ ] SERP features and AI visibility are monitored where available.
