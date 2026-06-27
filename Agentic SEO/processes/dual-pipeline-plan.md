---
id: dual-pipeline-plan
name: "Dual-Pipeline Execution Plan"
version: 1
description: "Decouple task planning from task execution."
status: implemented
---

# Dual-Pipeline Execution Plan (Ops + Blog)

**Status:** IMPLEMENTED (2026-06-04). The picker, three pipeline crons, and the
enqueue-only producer conversion are built and wired into `install-crons.sh`.
One PRE-LAUNCH TODO remains deferred: the blog/service-page MODIFICATION skill
(`edit_refresh_needed` tasks are skipped + flagged to `needs_review` until it exists).
**Plan date:** 2026-06-03

## Goal

Decouple task *planning* from task *execution* and close the feedback loop. Four
scheduled roles:

| Role | Component | Interval | What it does |
|------|-----------|----------|--------------|
| **Producer (internal signals)** | daily workplan (Hermes) | 2Ãƒâ€”/day (08:00 / 20:00 BST) | Pure planner: decide strategy, create tasks, mark ready. **Does NOT execute.** |
| **Producer (outside-world news)** | `run-industry-radar.sh` (Hermes) | 1Ãƒâ€”/day (11:00 BST) | Scans SEO/GBP/PPC/core-update/local-SEO/website-industry news, enqueues `new_blog_post` topics (status=approved). **Does NOT execute / write blogs.** See `processes/industry-radar.md`. |
| **Feedback analyst** | feedback generator (Hermes) | every 2h | Reviews worker results + fresh data, writes a feedback brief the planner reads. |
| **Ops consumer** | `run-ops-pipeline.sh` | `*/7` | Executes the next ready `general_operational` task. |
| **Blog consumer** | `run-blog-pipeline.sh` | `*/19` | Executes the next ready `blog_content` task. |

Decisions locked in:
- **Enqueue-only producers** Ã¢â‚¬â€ there are now TWO: the twice-daily work plan
  (internal signals) and the daily industry radar (outside-world news). Both only
  plan and enqueue; ALL execution happens in the workers. Single execution path.
- **One task per tick** (highest-priority ready task in the lane, then exit).
- **24/7** (workers tick around the clock, not just inside session windows).
- **No code-enforced daily caps** Ã¢â‚¬â€ the AI decides what to enqueue. See contract.
- **Feedback analyst is an AI (Hermes) run every 2h** that prepares inputs for the
  two daily planning sessions.

## The producer/consumer contract (MUST document for the AI)

> When the AI marks a task **ready** (`status = approved`), a worker WILL pick it
> up and execute it automatically within ~7 min (ops) or ~19 min (blog). There is
> **no second human/AI gate**. Only enqueue what you actually want done. To hold a
> task, leave it `candidate`; for irreversible types, use the explicit-approval
> queue (`waiting_for_approval`) which workers never touch. A ready task must have
> a concrete action plan and a worker-dispatchable `task_type`; do not coerce a
> task into a different type just to force pickup.

Ready-state semantics:
- `candidate` Ã¢â€ â€™ AI hasn't committed Ã¢â€ â€™ **workers skip**
- `waiting_for_approval` Ã¢â€ â€™ irreversible, held for Telegram `approve` Ã¢â€ â€™ **workers skip**
- `approved` Ã¢â€ â€™ ready (auto-approved under opt-out, or owner-approved high-risk) Ã¢â€ â€™ **workers execute**
- `approved` **with a future `scheduled_for`** Ã¢â€ â€™ deferred Ã¢â€ â€™ **picker skips until due** (see below)
- locked / `in_progress` / done Ã¢â€ â€™ **workers skip**

### Executor-scheduled follow-ups (the one consumer-as-producer exception)

The work plan is the primary producer, but the safe executor may enqueue a small
amount of *self-scheduled* work so a change can verify itself. After it ships a
ranking-affecting edit it creates a deferred `ranking_followup` task that re-checks
SERP positions ~14 days later and, on a regression, enqueues a `ranking_recovery`
task plus an alert. Implementation: `cli/lib/followups.js`.

Deferral uses the `tasks.scheduled_for` column (added for this): a follow-up is
created `status='approved'` with a future timestamp, and `task next` filters out
rows whose `scheduled_for` is in the future, so it stays invisible to the consumer
until due Ã¢â‚¬â€ no promoter cron. Runaway production is bounded three ways: only
`safe`, non-approval task types are created; a `followup_depth` cap bounds the
optimizeÃ¢â€ â€™verifyÃ¢â€ â€™recoverÃ¢â€ â€™verify chain; and a target+type dedupe prevents
duplicate active follow-ups. Override the window per task via
`evidence.followup_days` or globally via `WEBSITE_AGENT_FOLLOWUP_DAYS`.

## Components to build

1. **`cli/commands/task-next.js`** Ã¢â‚¬â€ picker. Loads `approved` rows, runs
   `routeTask` (lane can't be computed in SQL), returns the highest
   `priority_score` task in `--lane <lane>` that is not locked. `--json`.

2. **`cron/run-ops-pipeline.sh`** (`*/7`):
   - acquire run-lock `ops-pipeline` (skip tick if held)
   - `monitor-check --auto-fix` (cheap; abort tick on critical)
   - `TASK = v2 task next --lane general_operational --json`; exit if null
   - dispatch by `risk_level`: `safe` Ã¢â€ â€™ `safe-fix`, `semi_safe` Ã¢â€ â€™ `semi-safe`,
     `high_risk` Ã¢â€ â€™ `high-risk` (all `--apply --production`)
   - heartbeat; release run-lock

3. **`cron/run-blog-pipeline.sh`** (`*/19`): same shape, `--lane blog_content`.
   - `draft_needed` (new_blog_post) and new service page Ã¢â€ â€™ run via the
     creation process/skill ([new-blog-creation.md](new-blog-creation.md),
     [service-page-update.md](service-page-update.md)).
   - `edit_refresh_needed` (content_refresh, editorial_copy_revision) Ã¢â€ â€™ **skip
     and flag** for the AI until the modification skill exists (see TODO).

4. **`cron/run-feedback.sh`** (`0 */2 * * *`) Ã¢â‚¬â€ Hermes "feedback analyst":
   - Pulls worker activity since last run from the `events` / `deployments` tables
     (executed, deployed, validated, rolled-back, failed, stuck).
   - Pulls fresh outcome signals (GSC/SERP deltas for changed pages) Ã¢â‚¬â€ note this
     is the ONE place that may fetch data, NOT the */7 worker.
   - Writes a rolling **feedback brief** to `cron/feedback/latest.md` (+ timestamped
     copy) that the next planning session reads.
   - Cost: 12 Hermes runs/day Ã¢â‚¬â€ gate it to no-op fast when there's no new activity.
   - **Analysis-only.** It writes the brief; it does NOT create or approve tasks.
     The twice-daily planner is the sole producer.

5. **Producer change Ã¢â‚¬â€ `run-daily-workplan.sh` + `daily-workplan.md`** Ã¢â‚¬â€ strip the
   inline execution (`safe-fix`/`semi-safe`/`high-risk` calls). The session now only:
   reads the feedback brief, decides, creates tasks, sets them `approved`. Workers
   do the rest.

6. **`cron/install-crons.sh`** Ã¢â‚¬â€ add:
   ```cron
   0   */2 * * * /opt/website-agent/cron/run-feedback.sh      >> .../logs/feedback.log 2>&1
   */7   * * * * /opt/website-agent/cron/run-ops-pipeline.sh  >> .../logs/ops-pipeline.log 2>&1
   */19  * * * * /opt/website-agent/cron/run-blog-pipeline.sh >> .../logs/blog-pipeline.log 2>&1
   ```

7. **AI-awareness doc edits** Ã¢â‚¬â€ write the contract above into:
   - [processes/daily-workplan.md](daily-workplan.md)
   - [hermes/skills/client/system-rules/SKILL.md](../hermes/skills/client/system-rules/SKILL.md)
   - [hermes/skills/client/daily-workplan/skill.md](../hermes/skills/client/daily-workplan/skill.md)
   - [config/guardrails.json](../config/guardrails.json) `review_model` (note the auto-pickup)

## Concurrency
- Named run-lock per pipeline via existing `locks` table Ã¢â€ â€™ no double-fire on overrun.
- Per-task locks already acquired inside executors Ã¢â€ â€™ task mid-flight not re-picked.

## Existing guards we rely on (already in code)
- `semi-safe` refuses blog content / non-`general_operational` tasks.
- `high-risk` Phase-1/Phase-2 split (only `approved` runs Phase 2).
- `safe-fix` handles `new_blog_post` draft creation.

---

## PRE-LAUNCH TODO (before starting the agent)

- [ ] **Blog/service-page MODIFICATION skill** Ã¢â‚¬â€ AI writes a detailed change spec,
      then applies it. Needed before the blog pipeline can handle
      `content_refresh` / `editorial_copy_revision` (until then those are skipped
      and flagged). (Deferred per owner Ã¢â‚¬â€ "connect later".)
- [ ] Wire the new-blog / service-page CREATION skill into `run-blog-pipeline.sh`
      (decide: deterministic executor vs Hermes-invoked skill for quality).
- [ ] Define the **feedback brief** schema/sections the planner consumes, and the
      no-op gate so the 2-hourly run is cheap when there's no new worker activity.
- [ ] Smoke-test all three crons locally (plan-only, no `--apply`) before server cron.

## Resolved decisions
- Producer = **enqueue-only** (no inline execution in the daily sessions).
- Feedback analyst = AI (Hermes), every 2h, **analysis-only** (writes brief, does
  not create/approve tasks). Twice-daily planner is the sole producer.
