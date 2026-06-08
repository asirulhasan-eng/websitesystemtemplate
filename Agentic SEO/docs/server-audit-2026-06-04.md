# Server System Audit â€” 2026-06-04

> **STATUS â€” RESOLVED 2026-06-05.** All 10 issues below (plus the user's 4 follow-ups) fixed,
> tested (suite 26/26 green, full health check all-`ok`), and committed on the server
> (`7d279b8`, `f66ac24`, `ff62029`, `8a805d3`, `a23d26c`). Live crontab hardened to invoke
> scripts via `bash`. **Not yet pushed to origin.** See "Resolution" at the bottom.


Audited the live server (`89.167.16.167`, `/opt/client-agent` v2 + Hermes orchestrator at `~/.hermes`). Findings below, ordered by severity. Confirmed against cron logs, the SQLite task DB, `cron_runs`, and a direct status query to the Hermes orchestrator.

## System overview (what it has done)
- **v2 CLI** (`cli/bin/v2.js`) drives everything: GSC/SERP fetch, crawl, task queue (SQLite `state.db`), deploy, email, brain/Obsidian memory, intelligence pipeline.
- **Dual-pipeline + crons** are installed (crontab): intelligence (1:30/13:30), daily workplan (2:00/14:00), feedback (*/2h), ops-pipeline (*/7), blog-pipeline (*/19), monitor (*/15), outbox (*/10).
- **Task queue:** 305 total tasks. 57 executed, 49 deployed, 33 approved, 18 preview_ready, 116 monitored (watchlist), 25 cancelled.
- Hermes runs as a Telegram-connected gateway with a dedicated `client` skill bundle (operations, blog-publisher, content-refresh, high-risk-approval, task-list, etc.).

---

## ðŸ”´ CRITICAL â€” fix first

### 1. Four cron scripts lost their execute bit â†’ pipelines dead ~13h
On 2026-06-04 04:45 these were rewritten and left non-executable (`-rw-r--r--`), but crontab invokes them directly (not via `bash`), so every run fails with `Permission denied`:
- `run-monitor.sh` (*/15) â€” **system health monitoring is dead**
- `run-outbox.sh` (*/10) â€” **email + Obsidian outbox not sending** (notifications/reports silently dropped)
- `run-feedback.sh` (*/2h) â€” email-reply processing dead
- `run-intelligence.sh` (1:30/13:30) â€” intelligence pipeline not running on schedule
- **Fix:** `chmod +x cron/run-monitor.sh run-outbox.sh run-feedback.sh run-intelligence.sh` (and `install-crons.sh`). Better: make `install-crons.sh` invoke scripts via `bash <script>` so a missing x-bit can't silently kill a pipeline again, and have it `chmod +x` on install.

### 2. `ops-pipeline` leaks `running` rows in `cron_runs` (22 stuck)
Ops-pipeline completes its work (log shows `[done]`) but never finalizes its `cron_runs` row to `completed`/`failed`. 22 rows stuck `running` (latest 17:35). This corrupts stuck-job detection â€” monitor would raise false "hanging job" alerts (if it were alive).
- **Fix:** ensure `run-ops-pipeline.sh` always closes its cron_run (trap/finally) on exit. Audit other pipelines for the same leak. Backfill/clean the 22 stale rows.

---

## ðŸŸ  HIGH â€” capability gaps blocking real SEO work

### 3. No deterministic executor for the highest-impact task types
Approved work that the queue can identify but cannot auto-execute (confirmed by Hermes):
- **21 Ã— `internal_link_opportunity`** (semi_safe, gsc) â€” approved, stuck.
- **6 Ã— `content_refresh`** (high_risk) â€” blocked by #4.
- **2 Ã— `service_page_gap`** (high_risk, money-page gap).
- **1 Ã— `ranking_recovery`**, **1 Ã— `title_meta_test`**.
These task types have no worker-dispatchable executor path, so they sit in `approved` indefinitely. This is the core throughput bottleneck â€” exactly the money-keyword / internal-link / service-page work.
- **Fix/Add:** implement deterministic executors (or wire an AI skill invocation) for `internal_link_opportunity` first (21 ready, lowest risk), then `service_page_gap` and `ranking_recovery`.

### 4. Blog/service MODIFICATION is hardcoded "deferred" despite the skill existing
`run-blog-pipeline.sh` flags every `edit_refresh_needed` task to `needs_review` with "blog/service MODIFICATION skill is deferred (PRE-LAUNCH TODO)" â€” yet `~/.hermes/skills/client/content-refresh/` is a complete, capable skill (v1.1.0). The worker was simply never wired to invoke it. 11 edit-refresh tasks are piling up, picked-and-flagged every 19 min.
- **Fix:** wire the blog worker to dispatch `edit_refresh_needed` â†’ `client-content-refresh` skill, or remove the hard block so they route to an AI session instead of dead-ending in `needs_review`.

### 5. `email-check` failing (101 failures, last 06-03 19:06)
Email inbox checking has been failing repeatedly. Combined with the dead outbox (#1), the **entire email loop (send + receive + reply-processing) is currently non-functional.**
- **Fix:** investigate `email-check` auth/IMAP failure; revalidate after outbox chmod fix.

---

## ðŸŸ¡ MEDIUM â€” hygiene / data quality

### 6. 92 duplicate active tasks across 23 groups
`task audit` reports `duplicate_task_count: 92`, `duplicate_group_count: 23`. Queue is noisy; `task dedupe` exists but isn't keeping up (or isn't scheduled).
- **Fix:** run `v2 task dedupe`; schedule it; tighten `dedupe_key` generation upstream.

### 7. 16 tasks in `needs_lane_review`
Tasks the router couldn't assign to a lane â€” they never reach a worker.
- **Fix:** review lane-assignment rules; add a fallback lane.

### 8. Keyword normalization bug â€” titles used as keywords with double spaces
Many tasks have `target_keyword` = the full title with stripped punctuation collapsed to double spaces, e.g. `"ppc marketing for {{AUDIENCE}} 2026  guide to maximizing leads and roi"`. These aren't real keywords and pollute keyword tracking/SERP checks.
- **Fix:** normalize whitespace (collapse `\s+`), and derive a real primary keyword instead of reusing the H1/title verbatim.

### 9. Watchlist is huge and never drains â€” 116 monitored
98 `gsc` + 16 `serp_movement` + 2 `workplan` tasks sit in `monitored` ("Investigate ranking drop for â€¦"). Nothing promotes or ages them out.
- **Fix:** add a promotion/expiry policy so the watchlist converts to action or closes.

---

## Notes
- No active or stale resource locks (locks are not a blocker).
- `state.db` is ~487 MB with a separate redaction backup â€” keep an eye on growth.
- Old pre-migration cron job names (task-executor, blog-publisher, monitor, outbox-worker) stopped cleanly at 2026-06-03 ~19:20 when the dual-pipeline migration landed; new jobs took over (but several are dead per #1).

---

## Resolution (2026-06-05)

| # | Item | Fix | Verified |
|---|------|-----|----------|
| C1 | 4 dead crons (lost exec bit) | `chmod +x` all; live crontab now invokes via `/usr/bin/env bash`; `install-crons.sh` template hardened | monitor/outbox run clean |
| C2 | email loop down | feedback/blog crons used unsupported `hermes ... --no-interactive` â†’ `hermes chat -q "$PROMPT" --quiet --yolo --accept-hooks`; `run-outbox.sh` now loads `.env` (SMTP_HOST was never in env) | PONG ping; SMTP_HOST loads; orphan email jobs cancelled |
| C3 | `cron_runs` leak | `heartbeat finish` now closes the latest open run when no `--run-id`; 40 orphaned rows backfilled | start+finish closes row; 0 running |
| H1 | no internal-link executor | `task-execute-safe.planTask()` gains an `internal_link_opportunity` handler that links an existing unlinked text mention (needs `evidence.links[{anchor_text,to_url}]`; safe no-op otherwise) | dry-run inserted link on real page |
| H2 | no deploy reconciliation | monitor `--auto-fix` times out deployments stuck `running` past 30m | check active, 0/0 |
| H3 | edit_refresh dead-ends | blog worker routes `edit_refresh_needed` â†’ `client-content-refresh` skill via Hermes | bash syntax OK |
| M1 | internal-link `/blog/` misroute | `task_routing.js` routes `internal_link_opportunity`/`internal_linking` to `general_operational` before the `/blog/` heuristic | routes to general_operational |
| M2 | titles-as-keywords w/ double spaces | `task-create.js` collapses whitespace on title + target_keyword | "a   b" â†’ "a b" |
| M3 | dedupe not scheduled | `task dedupe --apply` cron at `15 2,14 * * *`; crontab + template hardened | dedupe dry-run OK |
| M4 | watchlist never drains | monitor `--auto-fix` cancels `monitored` tasks untouched >60d, with event | check active, 0/0 |

Dropped: the reported undeclared-`no_go` crash in `task-audit.js` was already fixed (variable is `noGo`).

**Follow-ups for the owner:**
- Push commits to origin (`git push`) when ready â€” currently committed on server only.
- The internal-link executor only fires when the planner populates `evidence.links[{anchor_text,to_url}]`; update the planner/intelligence prompt so it emits that contract.
- A one-time task purge (303 pre-2026-06-04 tasks) preceded this work; producer crons will repopulate the queue.
