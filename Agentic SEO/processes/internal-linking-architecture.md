---
id: internal-linking-architecture
name: "Semantic Internal Linking Architecture"
version: 1
schedule: "0 4 8 * *"
description: "Build and maintain internal links to grow topical authority â€” driven by user value and semantic relevance, not raw link counts. Finds orphan money pages, verifies source/destination topical overlap before linking, and enforces varied, contextual anchors."
trigger:
  schedule: "0 4 8 * *"            # Monthly, 8th of month, 04:00 {{TIMEZONE_ABBR}}
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
  conditions:
    - "Run after publishing new content"
    - "Run during service-page updates"
    - "Run when orphan / low-link pages are found"
guardrails:
  max_tasks_created: 12
  max_risk_level: semi_safe
  require_human_review_for:
    - navigation_change
  max_duration_minutes: 45
  abort_on_error: false
outputs:
  - name: "Internal-link tasks"
    type: tasks
    description: "Semantic, anchor-varied internal-link additions"
  - name: "Link architecture report"
    type: report
    description: "Orphans resolved, anchors varied, hub coverage"
---

# Semantic Internal Linking Architecture

> Maintain internal links to build topical authority â€” but link for the **reader** and for **semantic
> relevance**, never to hit a number. A low incoming-link count is a candidate signal, not a reason
> to link. Forced or irrelevant links dilute authority and blur topical signals.

## Trigger

- **Scheduled:** Monthly.
- **Event:** After publishing new content (new pages start orphaned).
- **Event:** During service-page updates.
- **Event:** When the opportunity scan or technical audit surfaces orphan / low-link pages.

## Pre-Flight Checks

```bash
v2 heartbeat start --job internal-linking-architecture --json
v2 lock list --json
```

---

## Step 1: Map the Current Link Graph

```bash
# Full internal link graph
v2 site-links --json

# Orphans (zero incoming internal links) â€” prioritize money/service orphans
v2 site-links --orphans --json

# Least-linked pages
v2 site-links --least-linked --limit 15 --json
```
*Tool note: `v2 site-links` is the aspirational wrapper. Today, derive the graph from
`node tools/crawl_local_site.js --site-root <repo> --base-url https://{{DOMAIN}}`, which
records internal links per page.*

Identify, in priority order:
1. **Orphan money/service pages** â€” highest priority. A money page with no internal links is a leak.
2. **Recently published content** not yet linked from relevant existing pages.
3. **Pages with < 3 incoming links** â€” candidates *only*; each must pass the semantic gate (Step 2).

---

## Step 2: Semantic Relevance Gate (do this before proposing any link)

> The core rule: **do not add a link just because a page is under-linked.** A link is only valid when
> the source and destination are genuinely about related topics and the link helps the reader move to
> a natural next step.

For each proposed (source â†’ destination) pair:

```bash
# Score topical overlap between source and destination
v2 semantic-match --source-url "<source>" --target-url "<target>" --json

# Confirm the destination is worth linking to (has search demand / strategic value)
v2 gsc-fetch --days 28 --url-contains "<target>" --json
```
`v2 semantic-match` is a deterministic topical-overlap gate. Treat a high score as necessary
evidence, not automatic approval: still confirm the source page naturally leads a reader to the
destination and that a real reader would click it.

Accept the link **only if all** hold:
- Source and destination share **meaningful topical overlap** (high semantic-match score / clear LLM yes).
- The link is a **natural next step** for the reader at that point in the source page.
- The anchor can be **contextual and varied** (see Step 3) â€” if the only natural anchor is a forced
  exact-match keyword, reconsider whether the link belongs.
- You are not creating cannibalization (don't cross-link two pages competing for the same query in a
  way that confuses the canonical target â€” see `content-gap-analysis.md`).

Reject (and log) links that fail the gate. A rejected low-link page stays under-linked on purpose
until a relevant source exists â€” that is the correct outcome.

---

## Step 3: Anchor-Text Rules

Vary anchors; never bulk-insert identical exact-match anchors (over-optimization risk):

- Use a **mix** of descriptive, partial-match, and natural-phrase anchors across source pages.
- Let the **surrounding sentence** carry relevance â€” the anchor doesn't have to be the keyword.
- **Avoid sitewide exact-match** links (e.g. a footer/template link with the same money anchor on
  every page).
- Cap exact-match anchors to one or two of the highest-relevance source pages per destination.
- The anchor must read naturally to a human; if it sounds keyword-stuffed, rewrite it.

---

## Step 4: Architecture Patterns

Apply the right link direction for each page type:

- **Service / money pages** should *receive* links from relevant guides, case studies, and related
  service pages (they are link destinations, not sources of authority outflow).
- **Blog posts** should link *to* the service or strategic page they support, where it helps the
  reader (the monetization path).
- **Hub / pillar pages** link out to their supporting cluster, and the cluster links back to the hub â€”
  but only within a genuine topical cluster.
- **Avoid** linking unrelated pages just to raise a count, and avoid deep orphan chains.

---

## Step 5: Create Tasks

> **Executable evidence contract (required).** The deterministic ops executor
> (`task-execute-safe` â†’ semi-safe lane) reads `evidence.links` and inserts each link
> automatically. For a task to auto-run you MUST give it:
> - **`--target-url` / `--target-file` = the SOURCE page being edited** (where the link is
>   inserted), NOT the orphan destination. Resolving one orphan from 3 sources = **3 tasks**,
>   one per source page.
> - **`evidence.links: [{ "anchor_text": "...", "to_url": "..." }]`** â€” one entry per link to add.
>   - `to_url` = the destination's **final, non-redirecting** URL.
>   - `anchor_text` = a phrase **that already appears as plain text on the source page**. The
>     executor only converts an existing, unlinked mention into a link inside a paragraph that
>     has no link yet â€” it never fabricates new sentences. If no natural mention exists, pick a
>     different source page, or omit `links` so the task surfaces for manual/AI handling instead
>     of silently no-op'ing.
> - Type `internal_link_opportunity` or `internal_linking` (both route to `general_operational`).
> - Keep the strategic fields (`semantic_matches`, `page_type`, `incoming_links`) for the audit
>   trail â€” they don't affect execution but document why the link passed the gate.

```bash
# One task PER SOURCE PAGE. This one edits the local-SEO service page to link to the orphan.
v2 task create --title "Internal link: /services/local-seo-for-{{AUDIENCE}}/ â†’ reputation-management" \
  --type internal_link_opportunity --priority 800 --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/local-seo-for-{{AUDIENCE}}/" \
  --description "Orphan money page /services/reputation-management/ (0 incoming links). Add ONE contextual link from this source, which passed the semantic gate (0.82). Anchor must already appear on the source page; vary anchors across sources (no repeated exact-match)." \
  --evidence '{"source":"site-links","page_type":"service","incoming_links":0,"semantic_matches":[{"source":"/services/local-seo-for-{{AUDIENCE}}/","score":0.82}],"links":[{"anchor_text":"online reputation","to_url":"https://{{DOMAIN}}/services/reputation-management/"}]}' \
  --json
```

> Internal-link changes are `semi_safe` (they edit page markup): route through the preview lane and
> verify the links render and point to final (non-redirecting) URLs before promoting.

---

## Step 6: Report & Finish

```bash
v2 report format --template custom --data '{
  "report_type": "internal_linking_architecture",
  "date": "YYYY-MM-DD",
  "orphans_found": N,
  "orphans_resolved": N,
  "candidates_rejected_low_relevance": N,
  "tasks_created": N
}' --json

v2 heartbeat finish --job internal-linking-architecture --json
```

---

## Acceptance Criteria

- **No orphan money/service pages** remain.
- Internal links added only where source/destination are semantically related and the link helps users.
- Anchors are **varied and contextual**; no new sitewide exact-match anchors.
- Link changes point to **final** (non-redirecting) URLs and are documented with their rationale.
- Low-link pages that failed the semantic gate are logged (left under-linked intentionally), not
  force-linked.
