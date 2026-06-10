# Research / Measurement-Window Integrity

> Protects rank-attribution research without freezing pages. When a change ships
> to test its effect on rankings, a second change that pulls the **same lever** on
> the **same URL** during the measurement window would make it impossible to tell
> which change moved the rank. This system holds only that specific case, and lets
> everything else proceed.

## The principle

You almost never get clean SEO attribution anyway (algorithm updates, competitor
moves, seasonality all land inside any 14-day window). So a hard "freeze the page"
rule costs more velocity than the cleaner attribution buys. Instead:

- **Log changes as events**, gate by **independence + severity**, and only block
  the one case that truly poisons the signal: a same-lever change mid-window.

## Lifecycle

1. **Open** — A ranking-affecting deploy (`task-execute-safe` → `maybeCreateFollowups`)
   captures a per-keyword SERP baseline, schedules a ~14-day `ranking_followup`, and
   **opens an `experiments` row** recording `target_url`, the **lever** (derived from
   task type), `baseline_json`, `started_at`, and `ended_at`. It also writes a
   `page_change_event` — the per-URL change log.
2. **Gate** — `routeTask` reads the open experiments for a task's URL (loaded by
   `loadOpenExperimentsByUrl`) and calls `classifyIncomingChange`:
   - `hold` — same lever, window open → bucket `research_hold`, flag
     `research_hold_same_lever`. `task next` / `task audit` skip it.
   - `annotate` — different lever, same URL → allowed, flag
     `experiment_window_orthogonal` (its own deploy later logs a `page_change_event`).
   - `allow` — no open window, corrective type, or approval-gated task.
3. **Close** — When the `ranking_followup` runs, it computes deltas and **closes the
   experiment** with an outcome (`improved` / `stable` / `regressed`) + `result_json`.
   Closing lifts the hold on any parked same-lever task.

## Key rules

- **Auto-lift:** the hold is time-bounded by `ended_at`. Even if the follow-up never
  runs, `findOpenExperiments` stops returning an expired window, so nothing is parked
  forever.
- **Clock reset / owner override:** re-opening the same URL+lever **supersedes** the
  prior open experiment (`status='superseded'`). To ship a held same-lever change now,
  deliberately re-run it — that supersedes the old window and starts a fresh 14 days.
- **Corrective always runs:** `ranking_recovery` (and other monitoring/corrective
  types) carry no lever, so a ranking drop can always be investigated mid-window.
- **Levers** are defined in `cli/lib/experiments.js` (`LEVER_FOR_TYPE`) and must stay
  aligned with `followups.RANKING_AFFECTING_TYPES`. Current groups: `title`, `meta`,
  `canonical`, `image_alt`, `schema`, `internal_links`, `content`.

## Where it lives

| Concern | File |
|---|---|
| Lever map, classify, open/close, queries | `cli/lib/experiments.js` |
| Routing gate (`research_hold` bucket + flags) | `cli/lib/task_routing.js` |
| Open window + change-log on deploy | `cli/lib/followups.js` (`maybeCreateFollowups`) |
| Close window on follow-up | `cli/commands/task-execute-safe.js` (`executeRankingFollowup`) |
| Consumers skip `research_hold` | `cli/commands/task-next.js`, `cli/commands/task-audit.js` |
| Storage | `experiments` + `events` tables (`cli/lib/state_db.js`) |
| Tests | `test/experiments-research-window.test.js` |

## Inspecting it

```sql
-- Open measurement windows (what is currently being held against)
SELECT experiment_id, target_url, experiment_type AS lever, started_at, ended_at, outcome
FROM experiments WHERE status = 'open' ORDER BY started_at DESC;

-- Per-URL change log
SELECT created_at, resource_id AS url, new_value AS lever, metadata_json
FROM events WHERE event_type = 'page_change_event' ORDER BY created_at DESC LIMIT 20;
```

```bash
# Same-lever tasks currently parked behind a window show up here:
v2 task audit --json   # → queues.research_hold[]
```
