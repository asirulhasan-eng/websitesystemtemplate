---
id: daily-workplan
name: "Daily Planner"
version: 2
description: "Twice-daily planner. Reads the intelligence summary (from the intelligence pipeline) and the feedback brief (from the analyst), then PLANS and ENQUEUES tasks for the next 12 hours. It does NOT gather data or run analysis â€” the intelligence pipeline does that. It is the SOLE PRODUCER of tasks."
trigger:
  schedule: "0 2 * * *"            # Morning session â€” 8:00 AM {{TIMEZONE_ABBR}}
  schedule_evening: "0 14 * * *"   # Evening session â€” 8:00 PM {{TIMEZONE_ABBR}}
  sessions: [morning, evening]
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
depends_on:
  - intelligence-pipeline           # run-intelligence.sh runs 30 min earlier and fills analysis_reports
guardrails:
  max_tasks_created: 15
  max_risk_level: high_risk         # reversible high-risk auto-runs under the opt-out model
  require_explicit_approval_for:    # irreversible/destructive only â€” see config/guardrails.json
    - delete_page
    - domain_change
    - ssl_change
    - dns_change
    - robots_disallow_all
    - sitemap_structure_change
  max_duration_minutes: 30
  abort_on_error: false
email_on_complete:
  enabled: true
  to: "{{ADMIN_EMAIL}}"
  template: workplan
  approval_model: opt_out           # plan runs automatically unless owner stops/modifies via Telegram
  include_next_12h_plan: true
outputs:
  - name: "Tasks"
    type: tasks
    description: "New/updated/approved tasks in SQLite"
  - name: "Plan email"
    type: email
    description: "Opt-out review plan to the owner"
---

# Daily Planner

> Reads pre-digested **intelligence reports** + the **feedback brief**, then plans and
> assigns tasks for the next 12 hours. It is the **SOLE PRODUCER** of tasks.
> It does **NOT** touch the GSC API, the SERP API, or any raw data â€” the intelligence
> pipeline (`cron/run-intelligence.sh`, 30 min earlier) already did that and saved reports.

## Where this sits (three intelligence layers â€” keep them distinct)

| Layer | Who | Produces | Creates tasks? |
|---|---|---|---|
| **Intelligence modules** | `processes/intelligence/*` (pre-planner) | reports (`analysis_reports`) | **No** |
| **Feedback analyst** | `run-feedback.sh` (every 2h) | the feedback brief | **No** |
| **This planner** | here (2Ã—/day) | the plan + tasks | **Yes â€” only here** |
| Standalone deep processes | opportunity-scan, content-gap-analysis, competitor-analysis, ranking-emergency | their own analysis + tasks | Yes (independently) |

## Execution Model â€” enqueue-only producer, opt-out approval

This session is the **PRODUCER**. It **plans and enqueues** work; it does **not** execute it.
Two consumer pipelines are the sole executors (see [dual-pipeline-plan.md](dual-pipeline-plan.md)):

| Pipeline | Cron | Lane | Picks |
|---|---|---|---|
| Ops | `*/7` (`run-ops-pipeline.sh`) | `general_operational` | next ready task, dispatched by risk |
| Blog | `*/19` (`run-blog-pipeline.sh`) | `blog_content` | next ready blog draft (via creation skill) |

### The producer/consumer contract

> When you mark a task **`approved`**, a worker **WILL** pick it up and execute it
> automatically within ~7 min (ops) or ~19 min (blog). **There is no second gate.**
> Only approve what you actually want done.

- **Enqueue what you want run.** `v2 task update --id <id> --status approved`. The worker computes
  the lane (`v2 task next`) and dispatches it. **Everything deploys STRAIGHT TO PRODUCTION â€” there
  is NO preview/human-merge gate** (opt-out model; owner reviews the live site daily, rollback reverts):
  - **Deterministic edits** (internal links, meta/title/canonical/alt, schema, protect-ranking):
    safeâ†’`safe-fix --apply --production`, semi_safeâ†’`safe-fix --allow-semi-safe --apply --production`.
  - **Content tasks that REWRITE/AUTHOR page copy** â€” `new_blog_post`, `content_refresh`,
    `new_service_page`, **`service_page_gap`**, **`money_page_refresh`** â€” route to the `blog_content`
    lane, where a fresh Hermes session writes/refreshes the page and publishes to main.
  - **`high_risk` is ONLY for `require_explicit_approval` types** (Telegram gate via Phase 1).
- **NEVER create work that has no finishing executor.** A page-rewrite/indexability task marked as a
  generic `high_risk` ops task has no handler â€” the safe executor produces nothing and the high-risk
  pipeline now marks it `blocked`. Route page-content work by `task_type` to the content lane instead.
  (This is what previously caused empty preview branches and zombie `preview_validated` tasks.)
- **Do NOT call the executors yourself** (`safe-fix` / `high-risk`) â€” that double-executes.
- **Approved tasks must already have an executable action plan** (concrete worker-dispatchable
  `task_type`, target URL/file/keyword, intended action). If the real work is investigation/strategy
  with no actionable deterministic edit or content brief, leave it `candidate`/`needs_review` or `skipped`.
- **Hold a task** by leaving it `candidate` â€” workers skip it.
- **Opt-out approval (negative consent).** Reversible safe / semi-safe / high-risk is pre-approved;
  the owner stops/modifies via **Telegram** (`stop <id>`, `change <id> to ...`, `pause`) â€” always honor that.
- **Hard stop for irreversible work.** Types in `require_explicit_approval` (`config/guardrails.json`)
  must **never** be set `approved`. Start high-risk Phase 1 (`v2 high-risk --task <id>`) â†’ holds them in
  `waiting_for_approval`; list them under `needs_explicit_go` in the plan email. A worker runs them only
  after the owner sends `approve <id>` via Telegram.

---

## Step 0: Load Memory (recall before deciding)

```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

node $V2 brain summary --markdown                          # standing policy: no-go, operating rules, strategy
node $V2 brain recall --query "<session focus>" --markdown # prior decisions/lessons/observations
```

Respect prior Decisions unless conditions changed, don't repeat tactics a Lesson says failed, honor no-go.

## Step 1: Pre-Flight (lock + heartbeat)

The cron wrapper (`run-daily-workplan.sh <session>`) already runs `monitor-check`, aborts on
critical health, and records the `workplan-<session>` heartbeat. You only need:

```bash
node $V2 lock list $DB --json     # confirm no overlapping planner run; release obviously stale locks
```

> Detailed system/queue health is now the `task-queue-health` intelligence module's job (Step 2),
> not a separate manual check here.

## Step 2: Read the Intelligence Summary  â† replaces old Steps 2â€“4 (health, GSC fetch, SERP)

This single command returns everything the intelligence pipeline gathered this cycle:

```bash
node $V2 intelligence summary --session <morning|evening> $DB --json
node $V2 intelligence summary --session <morning|evening> $DB --markdown   # human-readable
```

It aggregates the latest report from each module (GSC performance, threats, SERP changes, task
queue health, and â€” when recently run â€” content gaps, competitor moves, money-keyword trends,
new-page opportunities, internal linking, technical health), sorted by severity, with merged
threats / opportunities / recommendations and a **stale_modules** list.

- **Act on `threats` first** (critical â†’ warning). A critical money-keyword drop may warrant a
  `ranking-emergency` task or an immediate fix.
- **Mine `opportunities`** for quick wins, content gaps, and new-page candidates.
- **Note `stale_modules`** â€” if a module that should have run is missing, plan with that blind spot
  in mind (and, if it matters, you can pull its history with `v2 intelligence search`).
- **Recall deeper history** when a signal needs context:
  `node $V2 intelligence search --query "<keyword>" --days 30 $DB --json`.

> You do **not** routinely call `gsc-fetch` / `serp-check` / `crawl` here. However, you **may**
> run a targeted raw lookup for a **registry** money keyword when a report is thin or silent on it:
>   `node $V2 gsc-fetch --days 28 --query-contains "<keyword>" $DB --json`
> This is a bounded, registry-scoped drill-down â€” not a return to full data-gathering. Only use
> when a report's coverage block indicates a keyword was deprioritized or when a tracked money
> keyword has no mention in any report.

### Step 2.5: Content Inventory (after intelligence digest)

```bash
node $V2 content inventory $DB --join-keywords --join-gsc --json
```

Use this to understand the current page landscape when evaluating opportunities. For any
recommended "create page" or "upgrade page" action, cross-reference the inventory to determine
if a page already exists, what it covers, and whether it's the right type (service vs blog).

## Step 3: Read the Feedback Brief

```bash
cat /opt/client-agent/cron/feedback/latest.md
```

What did the workers accomplish since the last planner session? Any early outcomes (GSC/SERP
movement) on recent changes? Anything that failed, rolled back, or is stuck? Double down on what's
working; pause/investigate what isn't.

## Step 4: Review the Current Task Queue

```bash
node $V2 task list --status candidate,approved --sort priority $DB --json
node $V2 task list --status in_progress $DB --json
node $V2 task stats --backlog $DB --json
```

Cross-reference against the intelligence summary so you don't duplicate work. Use
`node $V2 task search --keyword "<keyword>" --days 30 $DB --json` to check recent history before
creating anything new (see Deduplication rules below).

### Step 4.5: Review Open Campaigns

```bash
node $V2 campaign list --status active,planning --with-tasks $DB --json
```

For each active campaign, check:
- Is its current child task complete? If so, enqueue the next step per the campaign roadmap.
- Does the intelligence summary contain new data about the campaign's target keyword?
- Has the campaign achieved its success metric? â†’ mark `completed`.
- Has 60+ days passed without progress? â†’ mark `paused` for review.

Campaigns take priority over ad-hoc opportunities for the same keyword cluster. If content-gap-quick
flags a wrong-page opportunity that already has an active campaign, reference the campaign instead
of creating a duplicate.

## Step 5: Decide (the planner's core job)

Based on intelligence + feedback + queue + memory, decide:

- Which **threats** need a task **now**?
- Which **opportunities** should become tasks (and which to defer)?
- Which existing **candidate** tasks to promote to **approved** for this window?
- Which stale/irrelevant tasks to **defer or cancel**?
- The **priority ordering** for the next 12 hours, within capacity (ops ~1 task/7 min,
  blog ~1/19 min â€” do not approve more than the workers can clear).

Apply judgment frameworks:
- **Business Value Assessment** â€” Revenue (40%) Â· Effort (25%, lower=better) Â· Momentum (15%) Â·
  Competitive difficulty (20%, lower=better). Composite â‰¥ 3.5 = high, 2.5â€“3.5 = medium, <2.5 defer.
- **BIRD** for prioritizing the existing queue â€” see [task-triage.md](task-triage.md).
- **Cross-reference memory** â€” don't repeat tactics a Lesson says failed; respect standing Decisions.

### Deduplication rules (before creating)
- Open/in-progress task already covers it â†’ **update** it with the fresh signal, don't duplicate.
- Completed <14 days ago and the issue persists â†’ wait (changes may still be propagating) or
  reference the old task in a new one only if it clearly regressed.
- Materially different signal (new keyword, new drop) â†’ a new task is justified.
- Backlog already >25 open items â†’ be selective; create only for money-keyword (Bucket 1) items.

### Homepage is the canonical target for the head money terms (owner decision 2026-06-05)
The **homepage** (`https://{{DOMAIN}}/`) is the ranking target for: `{{NICHE}} seo`,
`{{AUDIENCE}} seo`, `{{NICHE}} seo agency`, `{{AUDIENCE}} seo agency`, `{{NICHE}} seo services`, `seo for {{AUDIENCE}}`
(see `config/guardrails.json` â†’ `keyword_strategy`). **Do NOT plan dedicated `/services/*` pages for
these** â€” that cannibalizes the homepage. Support the homepage instead:
- `risk=safe` `internal_link_opportunity` tasks linking these anchors from topically-relevant blogs â†’ homepage.
- supporting `new_blog_post` tasks that link up to the homepage.
A `money_page_refresh` targeting the homepage routes to the Hermes content lane (refresh in place).

### Existing-blog cannibalization gate (required before any supporting blog)

Before suggesting, creating, or approving any `new_blog_post` meant to support the homepage or any
service page, inspect existing blog inventory first:

```bash
node $V2 content blog-cannibalization \
  --topic "<working title or angle>" \
  --target-keyword "<primary keyword>" \
  --support-url "<homepage or service URL>" \
  $SITE --json
```

Decision rule:
- `recommendation=refresh_existing_blog` -> do not create a new post. Create a refresh/internal-link
  task for the matched blog instead.
- `recommendation=differentiate_or_refresh` -> only create a new post if the brief documents a
  distinct intent split, unique title/H1/meta target, and why the existing post is insufficient.
- `recommendation=create_new_blog` -> a new support post is allowed if it still fits capacity and
  business value.

When a new blog task is created, include the check in metadata/evidence:

```bash
--type new_blog_post \
--evidence '{"blog_cannibalization_check":{"recommendation":"create_new_blog","top_match_url":"...","top_match_score":0.08,"support_url":"https://{{DOMAIN}}/"}}'
```

### Money keywords (Bucket 1 â€” highest priority)
Service intent ("{{NICHE}} SEO", "SEO for {{AUDIENCE}}", "{{AUDIENCE}} SEO services", "{{NICHE}} company SEO"),
pricing/buying ("{{NICHE}} SEO pricing/cost/packages"), local ("local SEO for {{AUDIENCE}}",
"Google Maps SEO {{AUDIENCE}}"), problem-aware ("{{AUDIENCE}} needs more customers", "{{AUDIENCE}} website not
ranking"). Rule of thumb: if the searcher could become a paying client in 1â€“2 conversations, it's a
money keyword. (Bucket 2 = authority/content; Bucket 3 = informational/long-tail; Bucket 4 = noise â€”
homeowner DIY queries and other companies' brand terms â€” ignore.)

### Registry-driven keyword awareness

Before planning, load the keyword registry:
```bash
node $V2 keyword list --intent-tier money --json $DB
```

For any `auto_promote: true` candidates from the keyword-research intelligence report,
add them to the registry:
```bash
node $V2 keyword track --add "<keyword>" --intent-tier <tier> --page-type <type> --source serper --status aspirational $DB
```

For wrong-page or missing-page opportunities from content-gap-quick, consider triggering
the keyword-campaign process:
```bash
# Follow processes/keyword-campaign.md
```

## Step 6: Create / Update / Approve Tasks

Create tasks for threats and opportunities, then approve what you want run this window.

```bash
# Quick win on a money keyword (positions 4â€“10)
node $V2 task create \
  --title "Quick Win: '{{NICHE}} SEO services' position 7 â†’ top 3" \
  --type content_optimization --priority 800 --risk-level safe \
  --target-url "https://{{DOMAIN}}/services/{{NICHE}}-seo/" \
  --target-keyword "{{NICHE}} SEO services" \
  --description "Per gsc-performance report: pos 7.2, 340 imp/wk, CTR 4.1%, improving from 8.5. Title tag + content expansion + internal links." \
  --evidence "intelligence summary RPT-... (gsc-performance)" $DB --json

# Ranking threat on a money keyword (from threat-detection)
node $V2 task create \
  --title "THREAT: 'SEO for {{AUDIENCE}}' 3 â†’ 8" \
  --type content_optimization --priority 900 --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/seo-for-{{AUDIENCE}}/" \
  --target-keyword "SEO for {{AUDIENCE}}" \
  --description "Per threat-detection report (critical): 28d pos 3.1 â†’ 7d 8.4, clicks -73%. Investigate algo/competitor/technical." \
  --evidence "intelligence summary RPT-... (threat-detection)" $DB --json

# Content gap / new page (from content-gap-quick or new-page-opportunities)
node $V2 task create --title "Content Gap: ..." --type new_content --priority 500 --risk-level safe \
  --target-keyword "..." --description "Per <module> report: ..." --evidence "RPT-..." $DB --json

# Promote a task to run THIS window (a worker executes within ~7/~19 min)
node $V2 task update --id <id> --status approved $DB --json

# Defer / cancel a stale or superseded task
node $V2 task update --id <id> --status skipped --note "Superseded by RPT-... / lower value this window" $DB --json

# Irreversible/destructive types ONLY â€” hold for explicit approval (never set 'approved')
node $V2 high-risk --task <id> $DB --json   # Phase 1 â†’ waiting_for_approval; list under needs_explicit_go
```

> When creating tasks, cite the source report id in `--evidence` so the lineage from
> intelligence â†’ task is traceable.

## Step 7: Compose and Send the Plan Email

Everything under `planned` runs automatically this window; irreversible items go under `needs_explicit_go`.

```bash
node $V2 report format --template workplan --format html --json --data '{
  "session": "morning",
  "window": "8:00 AM - 8:00 PM {{TIMEZONE_ABBR}} (<date>)",
  "health": "green|yellow|red",
  "planned": [
    {"id":"TSK-...","lane":"safe|semi|high","title":"...","target":"/services/...","action":"...","why":"... (RPT-...)"}
  ],
  "needs_explicit_go": [
    {"id":"TSK-...","title":"...","target":"...","action":"...","why":"..."}
  ],
  "ranking_alerts": [{"keyword":"{{NICHE}} seo pricing","detail":"4 â†’ 9 over 7 days (threat-detection)"}],
  "notes": "Intelligence: <overall severity>; stale modules: <...>."
}'

node $V2 email send --to {{ADMIN_EMAIL}} \
  --subject "â˜€ï¸ {{SITE_NAME}} Work Plan â€” Morning (<date>)" \
  --html-file /tmp/workplan.html $DB --json
```

## Step 8: Record Memory (one Decision rollup)

```bash
node $V2 brain note add --type decision \
  --title "Workplan <session> <date>: <one-line focus>" \
  --body "Planned: <items + why>. Deferred: <items + why>. Open threats: <...>. Drew on reports: RPT-..." \
  --tags "workplan,<session>" --session "workplan-<session>" $DB --json
```

Add a `lesson` if an earlier change produced an attributable outcome this session. Do not write
per-task notes â€” the mirror already captures task state. One rollup is enough.

## Step 9: Heartbeat Finish

```bash
node $V2 heartbeat finish --job workplan-<session> $DB --json   # cron wrapper also manages this
```

---

## Decision Guidance (quick reference)

**Always create a task if:** a money keyword is outside positions 1â€“3 and has a clear action; a
money keyword dropped â‰¥2 positions in 7 days; a relevant query with >50 imp/wk has no page; a new
competitor entered the top 3 on a money keyword.

**Consider:** Bucket 2 keyword >100 imp/wk in positions 5â€“15; a content gap supporting a money
keyword; CTR well below expected for position (meta issue).

**Don't:** Bucket 4 (irrelevant); a duplicate of an open/in-progress task; <10 imp/wk non-money
query; another company's brand term; when the backlog already has >25 open items (then money
keywords only).

**Signal vs noise:** Â±2 single-day position moves = noise. 7-day average moves of Â±3 on a
consistent keyword = signal. New keywords with >20 impressions = evaluate. >30% WoW impression
drops on a tracked keyword = investigate. (All of this is already pre-computed for you in the
intelligence summary â€” you are reading conclusions, not raw numbers.)
