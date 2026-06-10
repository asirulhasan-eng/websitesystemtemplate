# Outcome Loop — clicks-primary measurement + debounced lever-split remediation

> Closes the business-outcome edge of the autopilot. Every ranking-affecting change is
> measured for whether it actually helped — judged on **GSC clicks**, not just SERP
> position — and a change that **confirmed-regresses** is remediated automatically with
> **no human gate**: small reversible changes are rolled back, content changes are
> refreshed. A single dip never acts.

This sits on top of [research-window integrity](research-window-integrity.md): that
protects *attribution* (don't confound the measurement); this decides *what the
measurement means and what to do about it*.

## The success metric: clicks, not position

The owner's metric is GSC clicks (leads/revenue are not yet wired). So the
`ranking_followup` judges outcome on clicks:

- **Baseline** clicks to the target URL over the `window_days` window are captured at
  deploy (`followups.captureBaselineClicks` → `gsc_snapshots`) and stored on the
  follow-up + experiment.
- At the check, current clicks over the same window are compared.
  `outcome_loop.evaluateOutcome`:
  - **regressed** if clicks fell by ≥ `click_drop_ratio` (default 30%).
  - **improved** if clicks rose by ≥ `click_improve_ratio` (default 10%); else **stable**.
- **Fallback:** if baseline clicks are below `min_baseline_clicks` (default 5) the page
  is too low-traffic to judge on clicks, so it falls back to SERP-position deltas
  (`evaluateRankingDeltas`). Position is always kept as a secondary diagnostic.

## Never act on a single dip — debounced confirmation

A degraded reading does **not** remediate. `outcome_loop.planConfirmationStep` runs a
small state machine (config in `outcome_loop.confirm`):

| reading | prior degraded | result |
|---|---|---|
| not degraded | 0 | **success** → close `improved`/`stable` |
| not degraded | ≥1 | **recovered** → close `recovered_transient`, no action |
| degraded | < `required_consecutive_degraded`−1, within window | **watch** → schedule a re-check in `recheck_days`, carry the counter |
| degraded | confirms `required_consecutive_degraded` | **act** → remediate (below) |
| degraded | unconfirmed, past `max_watch_days` | **inconclusive** → alert owner, no auto-action |

Defaults: **2** consecutive degraded checks, re-check every **7 days**, **28-day**
(4-week) ceiling. So with the first check at ~14d, a real regression is confirmed and
acted on by ~day 21; transient dips clear themselves and close as `recovered_transient`.

The 14-day attribution/`research_hold` window is **not** extended by the watch — it is
closed on the first degraded reading (`regressed_watching`) so same-lever edits aren't
blocked for a month. The confirmation watch is monitoring-only and carries its own
`watch_until`. Monitoring re-checks are created with `depthDelta:0` so they don't
consume the `MAX_FOLLOWUP_DEPTH` change-budget.

## Remediation is lever-split (only after confirmation)

`outcome_loop.decideRemediation(lever)` maps the **parent change's lever** to a response
(`auto_rollback_levers` / `auto_refresh_levers`):

- **content** lever → **auto-refresh**: enqueue a `content_refresh` task
  (`blog_content` lane → `edit_refresh_needed` → the `content-refresh` skill, in place).
  Reverting a published article is destructive, so content is re-optimized, never rolled back.
- **title / meta / canonical / image_alt / schema / internal_links** → **auto-rollback**:
  resolve the offending commit from `deployments` (latest `commit_sha` for the parent
  change task) and `deploy-rollback --apply --push`.
- **corrective / unknown** lever → **none** (a `ranking_recovery` task is filed for a human).

**Rollback safety:** skipped if the deploy is already `rolled_back`; if there is no
commit, or `deploy-rollback` hits a revert conflict, it falls back to filing a
`ranking_recovery` task (the pre-automation behavior). `deploy-rollback` aborts its own
revert on conflict, so the repo is never left dirty. A revert is not a ranking-affecting
type, so it opens no new experiment — no rollback loop.

An owner alert (`send_monitor_alert`, annotated with the action taken) is always queued
on a confirmed/inconclusive regression.

## Config

`config/guardrails.json` → `outcome_loop` (every value env-overridable):
`click_drop_ratio`, `click_improve_ratio`, `min_baseline_clicks`, `position_drop`,
`window_days`, `confirm.{required_consecutive_degraded,recheck_days,max_watch_days}`,
`auto_rollback_levers`, `auto_refresh_levers`. Env: `CLIENT_CLICK_DROP_RATIO`,
`CLIENT_MIN_BASELINE_CLICKS`, `CLIENT_FOLLOWUP_DAYS`, `CLIENT_RECHECK_DAYS`,
`CLIENT_REQUIRED_CONSECUTIVE_DEGRADED`, `CLIENT_MAX_WATCH_DAYS`.

These auto-remediation edges are **sanctioned** — the self-evaluation auditor should not
flag an auto-rollback or auto-refresh as rogue.

## Where it lives

| Concern | File |
|---|---|
| Config load, `evaluateOutcome`, `planConfirmationStep`, `decideRemediation` | `cli/lib/outcome_loop.js` |
| Click baseline/window reader, `depthDelta` | `cli/lib/followups.js` |
| Follow-up execution + lever-split + rollback | `cli/commands/task-execute-safe.js` (`executeRankingFollowup`) |
| Rollback executor | `cli/commands/deploy-rollback.js` |
| Config block | `config/guardrails.json` (`outcome_loop`) |
| Tests | `test/outcome-loop.test.js` |
