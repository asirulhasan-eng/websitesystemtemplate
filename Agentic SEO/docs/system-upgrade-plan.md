# {{SITE_NAME}} Agentic System â€” Comprehensive Upgrade Plan

_Authored 2026-06-04. Scope: the active system (`cli/`, `processes/`, `cron/`, `config/`, `hermes/`). Legacy v1 tooling has been removed from the active tree._

---

## 0. Why this plan exists (the corrected diagnosis)

This plan was triggered by one question: _why didn't the system go after the money keyword "{{NICHE}} website seo audit service" with a dedicated/upgraded service page?_

The first diagnosis was **wrong** and the way it was wrong is itself a finding:

- **Claimed:** the keyword had 0 impressions and was "structurally invisible" â€” the system is "100% demand-side blind."
- **Reality (verified against the DB):** the keyword cluster has **~95 impressions over 28 days**, ranking at **position ~33â€“43 through a blog post (`/blog/{{NICHE}}-seo-audit-process`) and the homepage**, with **0 clicks**.

So the true failure class is **not** "we can't see this demand." It is:

1. **Wrong-page mapping** â€” a commercial "audit service" query is answered by a blog post + the homepage, not a dedicated service page.
2. **Deep position with a coverage gap** â€” at ~#41 it's outside every module's "quick win (4â€“15)" and "near-threshold" lens, and no module owns "high-intent + wrong page + deep position."
3. **No clustering** â€” six near-identical variants (25/18/13/31/5/3 impr) are treated as separate sub-threshold rows instead of one ~95-impr money cluster.
4. **No money-keyword registry** â€” "money keyword" exists only as prose in the planner playbook (Bucket 1), not as a tracked DB entity, so by-name tracking is at the mercy of each run's GSC summarization.
5. **Lossy digest, no drill-down** â€” the planner reads only pre-digested reports and is explicitly told _not_ to query raw data. If a module's AI summary drops a keyword, the planner can never recover it. (This is the exact "absence in the report = absence in reality" trap that produced the wrong first diagnosis â€” the architecture institutionalizes it.)
6. **No strategy/campaign layer** â€” even when a money keyword is identified, nothing turns it into a multi-step campaign (decide create-vs-upgrade â†’ brief â†’ produce via the content engine â†’ internal links â†’ track over weeks). The planner only plans the next 12 hours.

The content engine is the strongest asset, but it is only ever _aimed_ by GSC summaries, so it reinforces ground already held instead of deliberately taking new money-keyword territory.

---

## 1. Design principles (encode these so the failure can't recur)

1. **Verify before asserting.** Any load-bearing claim about a keyword's presence/position is confirmed against source (`gsc-fetch --query-contains`, DB) before it drives a decision. "Not surfaced in a report" â‰  "not in the data."
2. **Registry is the source of truth.** Money keywords are a tracked DB entity, not prose. Tracking is by-name and independent of any single run's summarization.
3. **Cluster before you threshold.** Aggregate query variants into intent clusters _before_ applying impression floors, so real demand isn't fragmented into noise.
4. **Decisions are content-aware.** Any module or planner step that decides "create vs upgrade a page" must see the current page/blog inventory.
5. **Separate identify from strategize.** Discovery (find + score money keywords) and strategy (turn a keyword into a campaign) are distinct processes with distinct cadences.
6. **Digests carry coverage, not just conclusions.** Every report states what it scanned and what it deprioritized, so a thin report is distinguishable from an empty market.
7. **Preserve the architecture.** Intelligence modules stay **report-only**; the planner stays the **sole task producer**; ops/blog pipelines stay the **sole executors**. Every change below respects this.

---

## 2. Workstreams

Each workstream: **Problem â†’ What changes â†’ How (concrete files/commands/schema) â†’ Effort â†’ Depends on.**

### WS1 â€” Money-Keyword Registry (the backbone) â­ highest leverage

- **Problem:** `keyword list` is empty (today's reports: "0 tracked keywords"). This breaks `serp-monitor` (critical), `threat-detection`'s global check, `competitor-watch` (`serp-check --from-tracked`), and forces `money-keyword-deep` to re-infer money keywords from GSC every run. "Money keyword" lives only as prose in `processes/daily-workplan.md` Step 5.
- **What changes:** A curated, structured registry of money keywords â€” including **aspirational** ones with thin/zero current presence (e.g. the audit cluster) â€” that every SERP/threat/money module tracks **by name**.
- **How:**
  - Seed via `cli/commands/keyword-track.js` (`--add-file`). Build the seed list from: (a) the Bucket-1 taxonomy already in `daily-workplan.md:185`, (b) GSC mining (`gsc-fetch --days 90` filtered to commercial intent), (c) the audit cluster and siblings we just found.
  - Extend the keyword schema (in `cli/lib/state_db.js` / the keyword table) with: `intent_tier` (money/authority/info/noise), `cluster`, `target_url`, `target_page_type` (service|blog|home), `status` (ranking|aspirational), `best_ever_position`, `source` (gsc|serper|manual).
  - Add a weekly **registry maintenance** step (fold into `money-keyword-deep` or a new light module): promote newly-emerging GSC clusters into the registry; mark dead ones.
- **Effort:** S (seed) + M (schema fields). **Depends on:** nothing â€” do first.
- **Immediately fixes:** serp-monitor critical, threat-detection global check, competitor-watch, money-keyword-deep by-name tracking.

### WS2 â€” Query Clustering primitive

- **Problem:** Variants are fragmented; the audit cluster (~95 impr) reads as six sub-threshold rows. No module clusters. `gsc-fetch` only has `--group-by query|page`, which is exact grouping, not semantic.
- **What changes:** A clustering capability that groups query variants into intent clusters and aggregates impressions/clicks/position to the cluster, mapping each cluster to the page(s) it ranks through.
- **How:**
  - New command `cli/commands/keyword-cluster.js`, reusing the tokenization already in `cli/lib/site_analysis.js` (the same primitives `semantic-match` uses: `tokenize`, `termFrequency`, `cosineSimilarity`, `jaccardSimilarity`). Start lexical (stem + n-gram + Jaccard â‰¥ threshold); leave a hook for an embeddings backend later.
  - Output shape per cluster: `{ head_term, variants[], total_impressions, weighted_position, ranking_urls[], dominant_intent }`.
  - Wire it into `gsc-performance`, `content-gap-quick`, `new-page-opportunities`, `money-keyword-deep` (replace raw per-query reads with cluster reads).
- **Effort:** M. **Depends on:** none (can parallel WS1).

### WS3 â€” Wrong-Page / Intent-Mismatch lane (closes the coverage gap)

- **Problem:** A commercial cluster ranking via a blog/homepage at a deep position has no owner. `content-gap-quick` caught the _pattern_ today but only on the highest-volume terms (`/blog/best-seo-for-{{AUDIENCE}}`), and missed the audit cluster mapping to `/blog/{{NICHE}}-seo-audit-process`. Deep position (#41) put it outside every "quick win" lens.
- **What changes:** A systematic page-fit check over **every** money-keyword cluster: is the ranking URL the canonical target page for that intent? If a commercial cluster ranks via blog/home and there's no/weak dedicated service page â†’ flag **build/upgrade service page** with the recommended canonical URL.
- **How:**
  - Extend `processes/intelligence/content-gap-quick.md` AI Analysis to iterate the **registry Ã— clusters Ã— `site-pages`** (not just top-volume queries). Add an explicit `page_fit` verdict per cluster: `canonical | wrong_page | missing`.
  - Emit structured opportunities: `{ type:"wrong_page"|"missing_page", cluster, current_url, recommended_url, recommended_action:"create"|"upgrade", impressions, position }`.
  - Remove the implicit position bias: a money cluster ranking via a blog at any position is a candidate, weighted by impressions Ã— commercial intent, not gated on position â‰¤ 15.
- **Effort:** M. **Depends on:** WS1 (registry), WS2 (clusters), WS5 (inventory).

### WS4 â€” Strategy / Campaign layer (the missing "strategize" process) â­

- **Problem:** The planner is tactical (12h window, `daily-workplan.md`). Nothing turns a money keyword into a multi-step campaign. "Identify" and "strategize" are collapsed into "read a GSC summary twice a day."
- **What changes:** A standalone **campaign** process that takes a high-value money keyword/cluster with a gap and produces a campaign: decide create-vs-upgrade â†’ content brief â†’ produce via the content engine â†’ internal-link wiring â†’ tracking enrollment â†’ measure over weeks. This is the explicit identify-vs-strategize split you asked for.
- **How:**
  - New process `processes/keyword-campaign.md` (standalone, like `content-gap-analysis.md` â€” it _may_ create tasks). A **campaign** is a parent record with child tasks; the parent persists across weeks while the planner enqueues child tasks per window.
  - Campaign brief schema: `{ target_cluster, business_value, decision:"create_page"|"upgrade_page", target_url, content_brief{angle, sections, internal_links_in[], internal_links_out[]}, success_metric:"position<=N within Xd" }`.
  - Content-engine handoff: the brief becomes a `new_content`/`content_optimization` task consumed by `processes/new-blog-creation.md` / `processes/service-page-update.md` â€” your existing engine, now _aimed_ deliberately.
  - The planner reads open campaigns alongside the intelligence summary and enqueues the next child task within capacity.
- **Effort:** L. **Depends on:** WS1, WS3, WS5.

### WS5 â€” Content-context everywhere + Content Inventory

- **Problem:** `money-keyword-deep` and `gsc-performance` don't load `site-pages`; the planner gets no inventory; create-vs-upgrade is decided blind. Only `content-gap-quick` and `new-page-opportunities` load `site-pages` today.
- **What changes:** A first-class **content inventory** passed to the money modules and the planner.
- **How:**
  - New command `cli/commands/content-inventory.js` (or extend `site-pages.js`): emit `{ url, type:service|blog|home, title, target_keyword/cluster, word_count, last_updated, internal_links_in, internal_links_out }` for every page. Reuse `crawl.js` / `site-links.js` / `page-read.js`.
  - Add a `keyword list` â†” `inventory` join so each registry keyword shows its current canonical page (or "none").
  - Add the inventory load to `money-keyword-deep.md` Data Gathering, and a **Step 2.5: Load Content Inventory** to `daily-workplan.md`.
- **Effort:** M. **Depends on:** none (enables WS3/WS4).

### WS6 â€” Supply-side discovery (reframed honestly)

- **Problem (corrected framing):** Not "we're blind to demand" â€” we _do_ see GSC demand. The real gap is we only expand around terms **already in GSC**; we don't proactively map the money-keyword universe or mine competitor gaps. `cli/lib/serper.js` already returns `relatedSearches` + `peopleAlsoAsk` (lines 67â€“68) but only `serp-check` uses Serper, for rank-tracking.
- **What changes:** A discovery module that expands the registry from Serper related/PAA + competitor SERP mining + seed permutations, scores candidates, and proposes registry additions (feeds WS1). Surfaces money keywords with thin/zero current presence _before_ they show meaningful GSC volume.
- **How:**
  - New `processes/intelligence/keyword-research.md` (report-only). Data gathering uses `serper.js` (`relatedSearches`, `peopleAlsoAsk`) seeded from the registry head terms + competitor domains.
  - Scoring: commercial intent Ã— estimated volume Ã— difficulty Ã— service-line fit. Output **candidate** keywords with `source:serper` and `status:aspirational` for registry review (human or auto-promote above a confidence bar).
  - Cadence: weekly (it's exploratory, not per-session).
- **Effort:** M. **Depends on:** WS1.

### WS7 â€” Digest integrity / anti-"absence = absence" (the meta-fix)

- **Problem:** The planner can't distinguish "not in data" from "not surfaced," because reports carry conclusions, not the considered set, and the planner is told **not** to query raw data (`daily-workplan.md:136`). This is the systemic twin of the wrong first diagnosis.
- **What changes:**
  1. **Coverage block** in every report: `coverage:{ scanned: N_clusters, surfaced_top: K, floor_applied, full_set_ref }` so a thin report is visibly thin.
  2. **Sanctioned drill-down** for the planner: relax the "never call gsc-fetch" rule to "you _may_ run a targeted raw lookup for a **registry** money keyword when a report is thin or silent on it." Bounded, registry-scoped â€” not a return to full data-gathering.
  3. **Verification habit** in module + planner prompts: before asserting a keyword has no presence, confirm with `gsc-fetch --query-contains`.
- **How:** extend the `--report-json` schema accepted by `cli/commands/intelligence-report.js`; update `cli/commands/intelligence-summary.js` to surface `coverage`; edit the module playbooks + `daily-workplan.md` Step 2.
- **Effort:** Sâ€“M. **Depends on:** none.

### WS8 â€” Reliability fixes (bugs surfaced by today's run)

- **`no_go is not defined`** crash in the task auditor â†’ fix in `cli/commands/task-audit.js` (undeclared variable; today's `task-queue-health` warning).
- **23 duplicate monitor groups** (9Ã— "{{AUDIENCE}} net worth") â†’ run `cli/commands/task-dedupe.js` and add a uniqueness guard on monitor insert.
- **`serp-monitor` empty-tracked critical** â†’ resolved by WS1.
- **GSC `final` vs `all` data-state** discrepancy (your dashboard's 34/15 vs the agent's numbers) â†’ `gsc-fetch.js:42` defaults to `--data-state final` (GSC-confirmed, lags 2â€“3d); the dashboard shows `all`. Standardize: document the choice, or pass `--data-state all` for fresher reads with a freshness note in reports.
- **Effort:** S each. **Depends on:** none â€” Phase 0.

---

## 3. The money-keyword registry seed (WS1 starter)

Derive the seed from three sources, then review before loading:

1. **Bucket-1 taxonomy** (`daily-workplan.md:185`): service intent, pricing/buying, local, problem-aware.
2. **GSC commercial mining:** `node $V2 gsc-fetch --days 90 --min-impressions 1 --query-contains "seo" $DB --csv` â†’ filter to commercial intent.
3. **The audit cluster we found** (currently mis-mapped): `{{NICHE}} website seo audit service(s)`, `{{NICHE}} full website seo audit services`, `{{NICHE}} website performance audit services` â†’ all should map to a **dedicated audit service page**, status `aspirational`, target_page_type `service`.

Load: `node $V2 keyword-track --add-file ./money-keywords.tsv --cluster <name> --priority high $DB`
(file format supports `keyword<TAB>cluster<TAB>priority<TAB>target_url` per `keyword-track.js:50`).

---

## 4. Phased roadmap

| Phase | Goal | Workstreams | Outcome |
|---|---|---|---|
| **0 â€” Hotfix (this week)** | Stop the bleeding | WS8 + WS1 seed | task-audit stops crashing, dupes cleared, registry seeded â†’ serp-monitor/threat/competitor modules work; the audit cluster is now tracked by name. |
| **1 â€” Backbone** | Make decisions grounded | WS1 schema, WS2 clustering, WS5 inventory, WS7 coverage | Clusters aggregate demand; modules + planner are content-aware; digests carry coverage; planner can drill into registry keywords. |
| **2 â€” Intelligence** | Catch the real failure class | WS3 wrong-page lane, WS6 discovery | The audit-cluster wrong-page gap is flagged automatically; new money keywords are discovered before they're obvious in GSC. |
| **3 â€” Strategy** | Aim the content engine | WS4 campaign layer | Identified money keywords become multi-week campaigns that drive create/upgrade tasks deliberately. |

**Validation checkpoint after Phase 2:** re-run the intelligence pipeline and confirm the audit cluster surfaces as a `wrong_page`/`missing_page` opportunity with a recommended `/services/...audit...` canonical URL. That is the concrete pass/fail test that the original miss is fixed.

---

## 5. What must NOT change (guardrails)

- Intelligence modules remain **report-only** â€” no task create/approve/execute.
- The **daily planner remains the sole task producer**; ops (`*/7`) and blog (`*/19`) remain the sole executors. The producer/consumer contract (`daily-workplan.md:67`) is preserved.
- Irreversible types in `config/guardrails.json` (`delete_page`, `domain_change`, `dns_change`, â€¦) stay behind explicit Telegram approval. Campaigns (WS4) may auto-enqueue **reversible** create/upgrade work only.
- All edits target `cli/`, `processes/`, `cron/`, `config/`, and active `hermes/` assets.

---

## 6. Open decisions for the owner

1. **Registry auto-promotion:** should WS6 discovery auto-add high-confidence keywords to the registry, or queue them for your review first?
2. **Clustering backend (WS2):** start lexical-only (fast, no deps), or invest in embeddings now for better variant grouping?
3. **Campaign autonomy (WS4):** should a campaign auto-enqueue the page create/upgrade (opt-out), or always email you the brief first (opt-in) for money pages?
4. **Data-state (WS8):** standardize on `final` (accurate, lagged) or `all` (fresh, provisional) for module reads?
