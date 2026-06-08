---
id: core-web-vitals-audit
name: "Core Web Vitals Audit"
version: 1
schedule: "0 3 1 * *"
description: "Audit visual stability, load time, and input responsiveness (LCP, CLS, INP, TTFB) across money and template pages, and create performance-fix tasks. Page experience is a Google ranking and engagement signal, not an afterthought."
trigger:
  schedule: "0 3 1 * *"            # Monthly, 1st of month, 03:00 {{TIMEZONE_ABBR}}
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
  conditions:
    - "Run after any template, media, or script change"
    - "Run when GSC Core Web Vitals report flags poor URLs"
guardrails:
  max_tasks_created: 10
  max_risk_level: semi_safe
  require_human_review_for:
    - navigation_change
    - template_change
  max_duration_minutes: 45
  abort_on_error: false
async_behavior:
  supports_pause_resume: false
  poll_interval_seconds: 15
  max_wait_seconds: 120           # PageSpeed runs can take 30-90s per URL
  on_timeout: create_followup_task
retry_policy:
  max_attempts: 3
  backoff_strategy: exponential
  initial_delay_seconds: 30
  alert_after_attempts: 2
outputs:
  - name: "Performance tasks"
    type: tasks
    description: "LCP/CLS/INP/TTFB fix tasks with before metrics"
  - name: "CWV report"
    type: report
    description: "Per-URL lab + field metrics and top opportunities"
---

# Core Web Vitals Audit

> Audit visual stability, load times, and input responsiveness across the pages that matter, then
> turn the worst offenders into concrete fix tasks. Slow pages lose rankings **and** conversions â€”
> page experience is an input to ranking, not a vanity metric.

## Metrics & Targets

| Metric | Good | Needs improvement | Poor | What it measures |
|--------|------|-------------------|------|------------------|
| **LCP** â€” Largest Contentful Paint | < 2.5s | 2.5â€“4s | â‰¥ 4s | When the main content renders |
| **CLS** â€” Cumulative Layout Shift | < 0.1 | 0.1â€“0.25 | â‰¥ 0.25 | Visual stability (unexpected movement) |
| **INP** â€” Interaction to Next Paint | < 200ms | 200â€“500ms | â‰¥ 500ms | Responsiveness to user input |
| **TTFB** â€” Time to First Byte | < 0.8s | 0.8â€“1.8s | â‰¥ 1.8s | Server/caching responsiveness (LCP precursor) |

> Prefer **field data (CrUX)** over lab data when available â€” it reflects real users. Use lab
> (Lighthouse) data to diagnose *why* a field metric is poor. INP and TTFB come from the field
> section of the PageSpeed report (`field_data` in the tool output).

## Trigger

- **Scheduled:** Monthly.
- **Event:** After any template, hero-image, font, or script change.
- **Event:** When GSC's Core Web Vitals report shows poor/needs-improvement URLs.

## Pre-Flight Checks

```bash
v2 heartbeat start --job core-web-vitals-audit --json
```

1. Confirm a `PAGESPEED_API_KEY` (or `GOOGLE_API_KEY`) is set â€” anonymous PSI rate limits are low and
   will throttle a multi-URL run. The tool runs without a key but may fail under `retry_policy`.
2. Decide the URL set: every money/service template + the homepage + 1â€“2 representative blog posts.
   You do not need to test every URL â€” test one of each **template** plus the high-value pages.

---

## Step 1: Measure

Run PageSpeed Insights (Lighthouse + Core Web Vitals + CrUX field data) for each target URL:

```bash
# Homepage, both strategies
v2 speed-audit --url https://{{DOMAIN}}/ --strategy both --json

# Money / service pages (mobile-first â€” Google indexes mobile)
v2 speed-audit --url https://{{DOMAIN}}/services/{{NICHE}}-seo/ --strategy mobile --json
v2 speed-audit --url https://{{DOMAIN}}/services/seo-for-{{AUDIENCE}}/ --strategy mobile --json

# A representative blog template
v2 speed-audit --url https://{{DOMAIN}}/blog/<slug>/ --strategy mobile --json
```

The report includes, per run: Lighthouse category scores, `core_web_vitals` (lcp_ms, cls, tbt_ms,
fcp_ms, speed_index_ms, tti_ms), `field_data` (CrUX LCP/CLS/INP/FCP with category), and
`top_opportunities` (the highest-savings Lighthouse audits, in ms). Reports are written under
`tools/out/pagespeed/`.

> **Async note.** Each run takes ~30â€“90s. If a run times out, do not block the whole audit â€”
> per `async_behavior.on_timeout: create_followup_task`, defer that URL to a follow-up and continue.

---

## Step 2: Diagnose

For each URL, read `field_data.overall_category` first (the real-user verdict), then use the lab
metrics and `top_opportunities` to find the cause:

| Symptom | Likely cause | Diagnostic clue |
|---------|--------------|-----------------|
| **High LCP** | Heavy/late hero image, slow TTFB, render-blocking resources | LCP element is an image; large `largest-contentful-paint` audit; opportunities list image/server items |
| **High CLS** | Images/embeds without dimensions, late-loading fonts/ads, injected banners | `layout-shift` culprits; missing width/height; FOIT/FOUT |
| **High INP** | Heavy JavaScript on interaction, long tasks | High TBT in lab data; third-party scripts |
| **High TTFB** | Slow server response, no caching/CDN | TTFB in field data; `server-response-time` audit |

Common, high-leverage fixes:
- Compress and convert the hero image to **WebP/AVIF**; serve responsive sizes.
- Mark the LCP image `fetchpriority="high"` and ensure it is **not** lazy-loaded.
- Assign explicit `width`/`height` (or `aspect-ratio`) to all images and media slots â†’ kills CLS.
- Defer or async render-blocking CSS/JS; inline critical CSS.
- Preload/`font-display: swap` for web fonts to stop text-shift.
- Reduce or defer third-party scripts (chat widgets, analytics, tag managers).
- Improve TTFB with caching / CDN edge config.

---

## Step 3: Create Fix Tasks

Create one task per distinct fix on the worst-scoring pages. Always record the **before** metric so
the follow-up can prove the gain.

```bash
v2 task create --title "Perf: Improve LCP on homepage hero (3.9s mobile)" \
  --type technical_fix --priority 750 --risk-level semi_safe \
  --target-file "index.html" \
  --description "Mobile PSI shows the hero image is the LCP element at 3.9s (poor). Convert to WebP/AVIF, add fetchpriority=high, ensure not lazy-loaded, and preload it. Re-measure after deploy." \
  --evidence '{"source":"pagespeed","strategy":"mobile","url":"https://{{DOMAIN}}/","lcp_ms":3900,"cls":0.04,"field_category":"NEEDS_IMPROVEMENT","top_opportunity":"properly-size-images"}' \
  --json

v2 task create --title "Perf: Eliminate layout shift on /services/{{NICHE}}-seo/ (CLS 0.21)" \
  --type technical_fix --priority 700 --risk-level semi_safe \
  --target-file "services/{{NICHE}}-seo/index.html" \
  --description "CLS of 0.21 (needs improvement) from images without dimensions and a late-loading testimonial widget. Add explicit width/height to all images, reserve space for the widget. Re-measure after deploy." \
  --evidence '{"source":"pagespeed","strategy":"mobile","url":"https://{{DOMAIN}}/services/{{NICHE}}-seo/","cls":0.21,"field_category":"NEEDS_IMPROVEMENT"}' \
  --json
```

> Performance fixes are `semi_safe`, not `safe`: they touch templates/markup and can regress layout
> or visible content. Route them through the preview lane (`v2 semi-safe --task <id> --apply --push`)
> and re-run `v2 speed-audit` against the preview URL before promoting.

---

## Step 4: Report & Finish

```bash
v2 report format --template custom --data '{
  "report_type": "core_web_vitals_audit",
  "date": "YYYY-MM-DD",
  "urls_tested": N,
  "poor_urls": [...],
  "needs_improvement_urls": [...],
  "tasks_created": N,
  "key_opportunities": [...]
}' --json

v2 heartbeat finish --job core-web-vitals-audit --json
```

---

## Acceptance Criteria

- No money/template page remains in the **poor** CWV range (LCP, CLS, INP).
- Every performance fix records before/after metrics (re-run `v2 speed-audit` post-deploy).
- Performance changes do **not** break layout, visible content, or internal navigation (verified on
  the preview URL).
- Recurring offenders (same template flagged two audits in a row) are escalated for a template-level
  fix rather than per-page patches.
