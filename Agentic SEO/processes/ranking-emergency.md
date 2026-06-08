---
id: ranking-emergency
name: "Ranking Emergency Response"
version: 2
schedule: "event:ranking_drop"
description: "Investigate and respond to a confirmed ranking, indexation, or traffic emergency on an important keyword. Checks for manual actions/security issues first, separates deindexing from algorithmic demotion, and gates emergency deploys behind smoke tests + rollback."
trigger:
  schedule: "event:ranking_drop"
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
  conditions:
    - "Affected keyword has >=50 impressions/week"
guardrails:
  max_tasks_created: 8
  max_risk_level: semi_safe
  require_explicit_approval:
    - delete_page
    - domain_change
    - ssl_change
    - dns_change
    - robots_disallow_all
    - sitemap_structure_change
  # Reversible high-impact changes (url_change, redirect_setup, navigation_change,
  # homepage_edit) are auto-approved â€” they go through branch/PR + deploy-rollback
  # pipeline and can be reverted. See config/guardrails.json.
  max_duration_minutes: 90
  abort_on_error: false
retry_policy:
  max_attempts: 3
  backoff_strategy: exponential
  initial_delay_seconds: 30
  alert_after_attempts: 2
outputs:
  - name: "Incident report"
    type: report
    description: "Root cause (deindex vs demotion vs other), evidence, actions taken, follow-up checks"
  - name: "Emergency / monitoring tasks"
    type: tasks
    description: "Fix and recovery-monitoring tasks"
---

# Ranking Emergency Response

> Rapid response protocol for significant ranking drops on important keywords.
> Speed matters here â€” but so does accurate diagnosis. Don't panic-react.

## Trigger

- **Automatic:** Daily Opportunity Scan detects a money keyword drop of â‰¥3 positions (7-day avg vs 28-day avg)
- **Automatic:** SERP check shows a tracked money keyword dropped off page 1
- **Manual:** Human reports a ranking concern
- **Threshold:** Only triggers for keywords with â‰¥50 impressions/week (ignore low-volume noise)

## Pre-Flight Checks

1. Confirm this is a real drop, not a data anomaly
2. Note when the drop was first detected
3. Check if an algorithm update has been reported industry-wide

```bash
v2 heartbeat start --job ranking-emergency --json
```

---

## Step 1: Detect and Confirm the Drop

```bash
# Fresh GSC data
v2 gsc-fetch --days 7 --min-impressions 5 --json

# 28-day baseline
v2 gsc-fetch --days 28 --min-impressions 5 --json

# Live SERP check
v2 serp-check --keywords "affected keyword" --domain {{DOMAIN}} --json

# Historical trend
v2 gsc-history --keyword "affected keyword" --days 90 --json
v2 serp-history --keyword "affected keyword" --days 30 --json
```

### AI Analysis â€” Confirm the Emergency

Before escalating, verify:

1. **Is the drop real or noise?**
   - Single-day fluctuations of Â±2 positions are NORMAL. Don't react.
   - Weekend data can be volatile (lower search volume = noisy positions).
   - If the 7-day average moved by â‰¥3 positions from the 28-day average, it's likely real.
   - If the SERP check shows a different position than yesterday but is within Â±2 of the 7-day GSC average, it may be personalization or localization.

2. **Is this a broad or isolated change?**
   - Did MULTIPLE keywords drop, or just one?
   - If multiple keywords across different pages dropped â†’ likely algorithm update or site-wide issue
   - If one keyword on one page dropped â†’ likely page-specific or competitor-specific

3. **How severe is it?**

| Severity | Criteria | Response Urgency |
|----------|----------|-----------------|
| **CRITICAL** | Money keyword dropped from page 1 to page 2+ (positions 1-10 â†’ 11+) | Immediate â€” within hours |
| **HIGH** | Money keyword dropped 3-5 positions but still on page 1 | Same day |
| **MEDIUM** | Supporting keyword dropped significantly | Within 2-3 days |
| **LOW** | Non-money keyword fluctuation | Normal triage cycle |
| **NOISE** | <3 position change, <50 impressions, or single-day blip | Ignore |

### Decision Gate

| Conclusion | Action |
|------------|--------|
| CRITICAL or HIGH severity confirmed | Continue to Step 2 |
| MEDIUM severity | Create a high-priority task, continue to Step 2 but don't rush |
| LOW severity | Create a medium-priority task, handle during normal triage |
| NOISE | Log and ignore. Do not create a task. |

---

## Step 2: Assess Scope and Context

### 2.0: First-Response Penalty & Indexation Checks (do these FIRST)

Before assuming an algorithm update or competitor â€” and **especially** if a money page dropped off
page 1 entirely â€” rule out the two causes that demand a completely different response: a Google
penalty, and the page being deindexed. These are fast, decisive checks.

```bash
# Manual Action and Security Issue reports (a manual action explains catastrophic drops)
v2 manual-actions-check --json
v2 security-issues-check --json

# Is the affected URL actually still indexed?
v2 index-inspect --url "https://{{DOMAIN}}/affected-page/" --json
```
Tool behavior: `v2 index-inspect` uses the GSC URL Inspection API when credentials are configured
and otherwise returns a clearly marked live technical fallback. `v2 manual-actions-check` and
`v2 security-issues-check` normalize exported evidence, but when no evidence file is supplied they
return `checked=false` with the exact GSC report URL to verify manually. Do not continue until those
reports are either checked in GSC or normalized from evidence.

**Decision gate (overrides everything below):**

| Finding | Meaning | Action |
|---------|---------|--------|
| **Manual action present** | Google has manually penalized the site/page | STOP normal diagnosis. Follow the manual-action remediation path: read the cited reason, fix the violation, file a reconsideration request. Do not make unrelated changes. |
| **Security issue present** | Hacked content / malware flagged | Treat as a security incident first: clean the site, then request review. Rankings recover after the flag clears. |
| **URL Inspection: not indexed / blocked / noindex / canonical elsewhere** | The page is **deindexed**, not merely demoted | Jump to the **Deindexed** branch in Step 3 â€” fix the technical/indexation cause immediately. |
| **URL Inspection: indexed, no manual/security action** | Page is still indexed â†’ this is a **demotion**, not a penalty/deindex | Continue with 2aâ€“2d to find the demotion cause. |

### 2a: Check for Algorithm Updates

This is crucial context. Many ranking drops are caused by Google algorithm updates, not anything you did.

```bash
# Check recent industry news (the AI should search for "Google algorithm update [current month/year]")
# This is a manual/knowledge-based check
```

**Signs of an algorithm update:**
- Multiple keywords/pages moved simultaneously
- Industry forums/Twitter are reporting widespread changes
- The drop happened on a known update rollout date
- The drop affected content quality signals (E-E-A-T related)

**If it IS an algorithm update:**
- Don't panic. Don't make hasty changes.
- Document the impact across all affected keywords
- Wait 1-2 weeks for the update to fully roll out before making significant changes
- Focus on understanding what the update targeted (content quality? links? specific niches?)

### 2b: Check for Technical Issues

```bash
# Crawl the affected page
v2 crawl --url "https://{{DOMAIN}}/affected-page/" --json

# Check page metadata
v2 page-meta --url "https://{{DOMAIN}}/affected-page/" --json

# Check page content
v2 page-read --url "https://{{DOMAIN}}/affected-page/" --json

# Check deployment history â€” was anything deployed recently?
v2 deploy status --json
```

**Technical issues to look for:**
- Page returning non-200 status code (301, 404, 500)
- Accidental `noindex` or `nofollow` tags added
- Canonical tag pointing to wrong URL
- Robots.txt blocking the page
- Major page speed regression
- Broken internal links to/from the page
- SSL certificate issues
- Server errors or downtime periods
- CDN or caching issues serving stale/wrong content

### 2c: Check for Content Changes

```bash
# Were any changes deployed to this page recently?
v2 task-search --keyword "affected keyword" --days 30 --json

# Check for recent tasks that modified this page
v2 db query --sql "SELECT * FROM tasks WHERE target_url LIKE '%affected-page%' AND status = 'completed' AND updated_at > datetime('now', '-30 days')" --json
```

**Content-related causes:**
- Title tag changed (accidentally or as part of an optimization that backfired)
- Significant content removed or rewritten
- New content added that diluted keyword focus
- Internal linking structure changed
- Schema markup modified or broken

### 2d: Check for Competitor Movements

```bash
v2 serp-check --keywords "affected keyword" --domain {{DOMAIN}} --json
```

**Competitor-related causes:**
- A new strong competitor entered the SERP
- An existing competitor significantly improved their page
- A competitor gained major backlinks
- A large authority site (Forbes, LinkedIn, etc.) published content on the topic
- SERP layout changed (new featured snippet, PAA, local pack pushing organic down)

---

## Step 3: Diagnose Root Cause

### AI Analysis â€” Root Cause Determination

> **First fork the diagnosis: is this DEINDEXING or DEMOTION?**
> These look identical in a rank report (the page is gone) but have opposite responses. Conflating
> them is the most expensive mistake in an emergency. Use the Step 2.0 URL Inspection result to fork:
>
> - **DEINDEXED** â€” the page is no longer eligible to rank at all. It returned a 404/5xx, is blocked
>   in robots.txt, carries a `noindex`, failed a Googlebot crawl/render, or Google chose a different
>   canonical. **This is a bug. Fix it immediately** â€” content quality is irrelevant until the page
>   is indexable again.
> - **DEMOTED** â€” the page is still indexed but ranks lower. It was outcompeted, hit by a core/quality
>   update, lost links, or the SERP intent/layout shifted. **Do not panic-edit.** The response is
>   analysis and measured improvement, never a frantic rewrite.

#### Branch A â€” DEINDEXED (page not eligible to rank)

| Sub-cause | Signals | Response |
|-----------|---------|----------|
| **Returns 4xx/5xx** | Non-200 status on the affected URL | Restore the page / fix the server error immediately |
| **Robots blocked** | `Disallow` covers the URL in robots.txt | Remove the block, re-request crawl |
| **noindex present** | `noindex` meta/header (often accidental, post-deploy) | Remove `noindex`, re-request indexing |
| **Crawl/render failure** | Googlebot can't fetch/render; critical text missing in rendered HTML; JS error | Fix the render/template/JS issue |
| **Canonical points elsewhere** | Google indexed a different URL as canonical | Correct the canonical, align internal links/sitemap |

Response for all of Branch A: fix the technical/indexation cause, redeploy (see emergency-release
protocol below), then request re-indexing in GSC and monitor for the page to return to the index.
If the situation is complex, hand off to the `indexation-recovery` playbook.

#### Branch B â€” DEMOTED (still indexed, ranks lower)

| Root Cause | Probability Signals | Response Strategy |
|-----------|---------------------|-------------------|
| **Algorithm / core update** | Multiple keywords/pages moved together, industry reports, timing matches | Wait and observe (1-2 weeks), then compare quality to what now outranks you â€” no panic changes |
| **Content change (our side)** | Recent deployment or task modified the page | Review the change; revert if it was a mistake |
| **Competitor improvement** | New competitor in top 5, or an existing competitor's page improved | Analyze their improvements, plan a better (not copied) response |
| **Intent shift** | The *type* of result ranking changed (serviceâ†”guideâ†”local) | Adjust page/content strategy to the new intent |
| **SERP layout change** | Featured snippet/PAA/local pack/AI Overview pushed organic down | Adapt â€” optimize for the new feature; CTR may matter more than position |
| **Seasonal shift** | Cyclical keyword trend, matches prior-year pattern | Normal â€” adjust expectations |
| **Link loss** | Major referring domain removed | Investigate, build replacement links |

### Multiple Cause Assessment

Sometimes multiple factors combine (e.g. a deploy that both demoted content *and* introduced a
`noindex`). Always clear Branch A causes first â€” an unindexable page can't rank no matter how good
the content is â€” then address Branch B causes by probability.

---

## Step 4: Plan the Response

### Response: Algorithm Update

```
DO NOT make panic changes to content.

IMMEDIATE:
1. Document all affected keywords and their position changes
2. Identify common characteristics of affected pages (content type, age, quality signals)
3. Monitor for 7-14 days as the update settles

AFTER UPDATE SETTLES:
4. Compare your content quality to what's now ranking above you
5. Identify specific improvements aligned with what the update seems to reward
6. Plan content improvements based on analysis, not guesswork
7. Execute improvements one at a time, measuring impact
```

```bash
v2 task create \
  --title "Algorithm Update Response: Monitor and assess impact on [keyword cluster]" \
  --type investigation \
  --priority 800 \
  --risk-level safe \
  --target-keyword "affected keyword" \
  --description "Suspected algorithm update detected. [X] keywords affected. Monitoring period: 14 days. Do NOT make hasty content changes. After monitoring period, analyze what's ranking above us and plan strategic improvements." \
  --evidence "7-day vs 28-day position changes: [list]. Industry reports: [status]. Affected pages: [list]." \
  --json
```

### Response: Technical Issue

```
FIX IMMEDIATELY.

1. Identify the specific technical issue
2. Determine when it was introduced
3. Fix or revert the change
4. Verify the fix is deployed
5. Monitor for recovery over the next 48-72 hours
6. Set up monitoring to prevent recurrence
```

> **Emergency-release protocol.** A fast fix may skip full *editorial* review because it only
> restores a broken state â€” but it must **never** skip validation. Every emergency deploy still
> requires: (1) a diff summary of exactly what changed, (2) a smoke test on the preview/live URL,
> (3) a live status/indexability re-check, (4) a known rollback command, and (5) a post-deploy
> monitoring task. "Deploy immediately with no checks" is how a one-line fix becomes a second outage.

```bash
# Example: Accidental noindex tag
v2 lock acquire --type content --resource "affected-page" --json

# Apply the fix on a branch (specific edit depends on the issue)
v2 deploy branch --branch "fix/remove-noindex-affected-page" --message "Emergency fix: Remove accidental noindex from [page]" --json

# 1. SMOKE TEST before promoting â€” verify the fix and that nothing else broke
v2 health-check --url "https://preview.{{DOMAIN}}/affected-page/" --json
node tools/check_url_health.js --url "https://preview.{{DOMAIN}}/affected-page/"
# Confirm: 200 status, no noindex, canonical correct, key content present

# 2. Promote only after the smoke test passes
v2 deploy promote --branch "fix/remove-noindex-affected-page" --message "Deploy emergency fix" --json

# 3. Post-deploy live re-check
node tools/check_url_health.js --url "https://{{DOMAIN}}/affected-page/"

# 4. Rollback is pre-staged in case the deploy regresses
#    node tools/rollback_deployment.js --deployment-id <id> --db tools/out/state/seo-agent.db --apply --push

v2 lock release --id <lock-id> --json
```

```bash
v2 task create \
  --title "EMERGENCY FIX: [Technical issue] on [page]" \
  --type technical_fix \
  --priority 900 \
  --risk-level safe \
  --target-url "https://{{DOMAIN}}/affected-page/" \
  --description "Detected [technical issue] causing ranking drop. Fix deployed. Monitoring for recovery." \
  --evidence "Page was returning [issue]. Rankings dropped [X] positions. Fix deployed at [time]." \
  --json
```

### Response: Content Change (Our Side)

```
ASSESS whether to revert or adjust.

1. Review what was changed and why
2. If the change was a mistake â†’ revert immediately
3. If the change was intentional but caused a drop:
   a. Check if the new content is genuinely better for users
   b. If yes, wait 2 weeks â€” Google may need time to re-evaluate
   c. If no, revert and re-plan the optimization
```

### Response: Competitor Improvement

```
STRATEGIC RESPONSE â€” don't rush.

1. Analyze what the competitor did differently
2. Determine if our content needs improvement regardless of the competitor
3. Plan improvements to our content quality, depth, and uniqueness
4. Don't copy the competitor â€” beat them with a better angle
5. Consider complementary strategies: better schema, featured snippet optimization, E-E-A-T signals
```

```bash
v2 task create \
  --title "Competitive Response: [Competitor] now outranking for '[keyword]'" \
  --type content_optimization \
  --priority 800 \
  --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/affected-page/" \
  --target-keyword "affected keyword" \
  --description "Competitor [name/domain] has moved above us for '[keyword]'. Their page: [url]. Analysis: they improved [specific aspects]. Our response plan: [specific improvements that make our content better, not a copy]." \
  --evidence "Our position: [X] (was [Y]). Competitor position: [Z]. Their content appears to have [specific advantages]." \
  --json
```

---

## Step 5: Execute and Monitor

### Immediate Actions (within 2 hours of detection)

1. âœ… Confirmed the drop is real (not noise)
2. âœ… Diagnosed the root cause
3. âœ… For technical issues: deployed fix
4. âœ… Created appropriate task(s)
5. âœ… Notified admin if severity is CRITICAL

```bash
# Critical alert
v2 email send \
  --to {{ADMIN_EMAIL}} \
  --subject "ðŸš¨ RANKING EMERGENCY: '[keyword]' dropped from position [X] to [Y]" \
  --body "Root cause assessment: [CAUSE]\nAction taken: [ACTION]\nMonitoring plan: [PLAN]\n\nAffected page: [URL]\nBusiness impact: [estimated click/traffic loss per week]" \
  --json
```

### Monitoring Protocol

Set up follow-up checks:

```bash
# Check every day for the next 7 days
v2 task create \
  --title "Monitor: '[keyword]' ranking recovery â€” Day [1-7]" \
  --type monitoring \
  --priority 800 \
  --risk-level safe \
  --target-keyword "affected keyword" \
  --description "Daily SERP and GSC check for '[keyword]' following ranking emergency. Track: position, impressions, clicks. Report any further changes." \
  --json
```

### Recovery Assessment Timeline

| Timeframe | Check | Expected If Fix Worked |
|-----------|-------|----------------------|
| 24 hours | SERP check | May see initial movement for technical fixes |
| 3 days | GSC + SERP | Position should be stabilizing |
| 7 days | Full GSC analysis | Should see trend reversal |
| 14 days | Comprehensive review | Should be back to baseline or improving |
| 28 days | Close monitoring | Declare recovered or escalate to deeper investigation |

```bash
# Daily monitoring check
v2 serp-check --keywords "affected keyword" --domain {{DOMAIN}} --json
v2 gsc-fetch --days 3 --min-impressions 3 --json
```

---

## Post-Flight

```bash
v2 heartbeat finish --job ranking-emergency --json
```

### Post-Incident Review

After the emergency is resolved (position recovered or stabilized), document:

1. **What happened:** Root cause and timeline
2. **How we detected it:** Which process flagged it
3. **What we did:** Actions taken and their effectiveness
4. **What we learned:** How to prevent similar emergencies
5. **System improvements:** Any monitoring or process changes needed

---

## Decision Quick-Reference: Is This Actually an Emergency?

| Situation | Emergency? | Action |
|-----------|-----------|--------|
| Money keyword drops from #3 to #15 | YES â€” CRITICAL | Full emergency response |
| Money keyword drops from #5 to #8 | YES â€” HIGH | Investigate same day |
| Money keyword drops from #1 to #2 | NO â€” NOISE | Monitor, don't react |
| Supporting keyword drops 5 positions | NO â€” MEDIUM | Task triage handles it |
| Keyword we've never tracked drops | NO | Daily scan handles it |
| Multiple keywords drop simultaneously | YES â€” likely algorithm update | Follow algorithm update protocol |
| One keyword drops but impressions are stable | MAYBE â€” could be localized | Check if it's a SERP layout change |
| Position drops but clicks are stable | NO â€” likely SERP change | Monitor, may not need action |
| Position stable but clicks drop significantly | YES â€” CTR problem | Check meta tags, SERP features, competition |

### What NOT to Do in a Ranking Emergency

- âŒ Don't rewrite the entire page in a panic
- âŒ Don't change the URL structure
- âŒ Don't add a bunch of new keywords to the page
- âŒ Don't buy spammy backlinks
- âŒ Don't make multiple major changes simultaneously (you won't know which one helped)
- âŒ Don't ignore it and hope it comes back on its own (it might, but you should understand why)
