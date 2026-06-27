# Autonomous Self-Improvement Mechanism — Implementation Plan

> Status: **Approved for implementation** · Owner: Site Owner · Drafted: 2026-06-15
> Scope: the Website Operations agent at `/opt/website-agent`
> (source repo: `Agentic SEO/`). This plan adds a closed self-modification loop so
> the system repairs its own prompts, processes, cron wrappers, routing, and CLI
> guardrails — autonomously, test-gated, and reversible.

---

## 1. Problem statement & root cause

The system can **diagnose** its own defects every 6 hours (the Self-Evaluation
Auditor, `processes/self-evaluation.md`) but is structurally incapable of
**repairing** them. The Auditor is "a critic with limited hands": it injects
corrective tasks tagged `source:auditor` and can cancel duplicates — nothing else.

Those corrective tasks flow through `routeTask()` (`cli/lib/task_routing.js`),
which knows only two execution lanes:

- `general_operational` — deterministic page-edit executors (`safe-fix` / `high-risk`):
  title/meta/canonical/internal-links/schema/image-alt edits on the **website**.
- `blog_content` — the Hermes content engine: authors/refreshes **content**.

**Neither executor can modify the agent's own code, processes, prompts, cron, or
config.** So a structural fix like "stop the split-DB ledger" has no executor that
can finish it. The task is picked up, fails, and after `MAX_ATTEMPTS=3`
(`cron/run-ops-pipeline.sh`) auto-parks to `needs_review`. The next Auditor window
re-detects the identical gap. **This is the observed loop**: the split-DB-ledger
finding appears in both the 2026-06-11 and 2026-06-15 audits, and the same three
recovery tasks (`TSK-2026-06-11-67E5E2DC`, `60B4F92D`, `AFE9727E`) were re-approved
in every work-plan since 2026-06-11 without ever executing.

### Confirmed grounding facts (verified against the code 2026-06-15)

1. **`resolveDbPath()` already normalizes backslashes.** `cli/lib/cli.js:100`
   resolves `args.db || WEBSITE_AGENT_DB_PATH || SEO_AGENT_DB || '/opt/...'` and
   then does `raw.replace(/\\/g, '/')`. **The CLI path is already correct.** The
   split-DB leak therefore comes from **raw DB access that bypasses the CLI** — e.g.
   `sqlite3 '/opt/website-state/website-agent.db' ...` and python `sqlite3`
   calls inside Hermes sessions and playbooks (visible in the Telegram export). On
   Linux a backslash is a literal filename character, so `\opt\...` becomes a
   *relative* file under the session's cwd — a phantom DB the workers never read.
2. **`task next` lanes** are a hard-coded set: `VALID_LANES = {general_operational,
   blog_content}` (`cli/commands/task-next.js:36`). `READY_STATUS = "approved"`.
   The worker reads `route.execution_lane` and a `dispatch` field (risk→executor).
3. **`rollback` is already a valid task status** (`cli/lib/statuses.js`), so the
   auto-revert path needs no schema change.
4. **Hermes skills live in the repo** at `Agentic SEO/hermes/skills/client/`
   but the running agent loads them from `/root/.hermes/skills/`. A repo→server
   sync step exists in deployment and must be respected by self-edits to skills.
5. **The local repo is one git repo** (`Agentic SEO/` + `Website/` + `Obsidian
   Agent Brain/`), but the server splits into `/opt/website-agent` and
   `/opt/website-site`. **Self-improvement touches the agent only.**

---

## 2. Goals & non-goals

### Goals
- Convert recurring Auditor findings and Brain lessons into **executable** system
  repairs, on their own lane, without pausing content production.
- Fully autonomous for **reversible** process/code/prompt/config repairs: a change
  merges to `main` only after a clean branch + passing test/static gate.
- Make every autonomous change **measurable and reversible**: the next audit
  verifies the gap closed; a regression auto-reverts and escalates.
- Permanently close the known blockers (split-DB raw access, SMTP, zombie tasks).

### Non-goals
- The loop does **not** edit the website (`Website/` / `/opt/website-site`),
  secrets/`.env`, DNS/domain/SSL, or the safety config that bounds it.
- It does **not** re-plan SEO strategy (the planner owns that) or author content.
- It is **not** a general agent — it executes narrowly-scoped repair tasks only.

---

## 3. Architecture overview

The mechanism mirrors the existing **SEO outcome-loop** (`processes/outcome-loop.md`)
one level up — applied to the agent's own substrate:

```
 Auditor (6h) ─┐                              detect → file repair task
 Daily reflect ┼─→ self_improvement lane ──→  run-self-improvement.sh (~11m poll)
 90m-unconsumed┘        (approved)                 │
                                                   ├─ v2 self-improve --task
                                                   │     branch → patch allowed files
                                                   │     → test/static gate
                                                   │     → merge+push+sync → record
                                                   ▼
                              next audit verifies gap closed?
                               ├─ yes → close meta-experiment (improved)
                               └─ no/worse → AUTO-REVERT commit + escalate (Telegram)
```

### Layered cadence (reconciles "daily" + frequent drain)
- **Auditor (every 6h)** — fast path. Files a repair task when a gap is *confirmed
  systemic*: same gap in **2 consecutive audits**, OR an approved recovery task
  **unconsumed for 90+ minutes**.
- **Daily reflection pass** — deeper 7-day clustering for subtler recurring patterns
  the per-window Auditor misses.
- **Worker (~every 11 min)** — drains the `self_improvement` queue. Because task
  *creation* is gated by the rules above, steady state is near-idle; 11 min is the
  drain latency, not a churn rate.

---

## 4. Deployment topology (edit-here / deploy-there)

| Artifact | Repo source (authoring) | Server runtime (execution) | Sync |
|---|---|---|---|
| CLI / lib | `Agentic SEO/cli/` | `/opt/website-agent/cli/` | git pull on agent repo |
| Cron wrappers | `Agentic SEO/cron/` | `/opt/website-agent/cron/` | git pull |
| Processes | `Agentic SEO/processes/` | `/opt/website-agent/processes/` | git pull |
| Hermes skills | `Agentic SEO/hermes/skills/` | `/root/.hermes/skills/` | repo→server sync script |
| Config | `Agentic SEO/config/` | `/opt/website-agent/config/` | git pull |
| Website | `Website/` | `/opt/website-site/` | **out of scope** |

The self-improve **worker runs on the server**, edits files under
`/opt/website-agent`, commits to that repo's `main`, and runs the skill
sync when it touches `hermes/skills/`. The local dev repo (this checkout) is where
we author Phase-1 changes that get deployed to the server.

---

## 5. Component specifications

### 5.1 DB-path hardening (the real fix)

`resolveDbPath()` is already correct; the leak is non-CLI access. Changes:

1. **Add a guard inside `openStateDb()`** (`cli/lib/state_db.js`): normalize `\`→`/`
   (defense in depth) and **refuse to open a relative path** — if the resolved path
   is not absolute, throw with a loud error rather than silently creating a phantom
   DB. This makes the failure mode impossible to miss.
2. **Audit every raw DB access** that bypasses the CLI:
   - grep the repo for `sqlite3 '\opt`, `sqlite3 "\opt`, python `connect(`, and any
     `--db '\opt` literals in `processes/`, `cron/`, and `hermes/skills/`.
   - Replace with either a `v2` CLI call or the forward-slash absolute path
     `/opt/website-state/website-agent.db`.
   - In playbooks/prompts, **replace the documented `--db \opt\...` convention**
     with the env var: commands inherit `WEBSITE_AGENT_DB_PATH`, so the explicit
     `--db` flag becomes unnecessary and the backslash literal disappears.
3. **Monitor check** `authoritative_db_path` (see 5.10): assert the agent's active
   DB resolves to `/opt/website-state/website-agent.db` and that no phantom
   `\opt*` file exists under common cwds.

### 5.2 Execution lane & routing

`cli/lib/task_routing.js`:
- Add `SELF_IMPROVEMENT_TYPES = new Set(['self_improvement','process_update',
  'prompt_update','cron_repair','executor_repair','db_reconciliation'])`.
- In `routeTask()`, before the blog/ops branches, route any task whose canonical
  type is in `SELF_IMPROVEMENT_TYPES` to `executionLane = 'self_improvement'`,
  `routeConfidence = 'high'`, `routeReason.push('task_type:'+taskType)`.
- In `bucketForTask()`, add: `if (executionLane === 'self_improvement') return
  'meta_repair'` (with the standard `needs_lane_review`/`approval_needed`/
  `blocked_no_go` overrides still applying via the flag checks).
- Export `SELF_IMPROVEMENT_TYPES`.

`cli/commands/task-next.js`:
- Add `self_improvement` to `VALID_LANES`.
- Add a dispatch mapping for the lane: self_improvement tasks dispatch to the
  `self-improve` executor regardless of risk (analogous to how blog tasks always go
  to the Hermes session). Implement as: if `route.execution_lane ===
  'self_improvement'` set `dispatch = 'self-improve'` in `summarize()`.
- `isExecutable()` already permits `meta_repair` (it is not in the exclusion list).

No new task status required. `db_reconciliation` is the **riskiest** type and is
constrained in 5.6.

### 5.3 Task creation

`cli/commands/task-create.js` already accepts arbitrary `--type`; add the six new
types to any validation/whitelist if one exists, and document them in `--help`.
Self-improvement tasks carry structured evidence:

```json
{
  "audit": "audit-<STAMP>",
  "gap": "split_db_ledger | unconsumed_recovery | smtp_auth | ...",
  "recurrence": 2,
  "target_files": ["cron/run-outbox.sh", "processes/self-evaluation.md"],
  "acceptance": "monitor authoritative_db_path == ok for 2 consecutive checks",
  "meta_experiment": "metaexp-<STAMP>"
}
```

### 5.4 `v2 self-improve` executor (new CLI command)

`cli/commands/self-improve.js`. Envelope-returning, mirrors existing command shape.

**Flags:** `--task <id>` (required for apply), `--apply`, `--dry-run`,
`--sample`, `--db`, `--json`.

**Behavior (`--apply`):**
1. Load the task; verify lane=`self_improvement`, status=`approved`, kill switch on.
2. Acquire the **shared git lock** (`v2 lock acquire --type general --resource
   site-git` — same resource the ops/blog pipelines use) so no two pipelines push
   concurrently. Skip the tick if held.
3. Verify the agent repo is clean; if dirty, **stash unrelated changes** (preserve
   them — do not discard) and record what was stashed.
4. Create branch `agent/selfimprove-<task-id>` from `main`.
5. Spawn the **Engineer Hermes session** (5.7) with the task's brief, the allowed/
   forbidden file lists, and the acceptance criterion. The session may edit **only**
   allowed files (5.6).
6. **Test/static gate** (5.5). On failure: abort, delete branch, restore stash,
   mark task `needs_review` with the failure log, notify.
7. On pass: commit (Co-Authored-By the agent), merge `--no-ff` to `main`, push, run
   the skill-sync if `hermes/skills/` changed, restore stash.
8. Record a Brain **decision** note + open a **meta-experiment** row keyed to the
   gap and the commit SHA.
9. Update the task to `completed` with the commit SHA in evidence. Heartbeat finish.
10. Notify (Telegram + email) with the diff summary, files changed, and acceptance.

**`--dry-run`:** steps 1–5 build the repair prompt and report the intended file set
**without** mutating files, branching, or DB writes. **`--sample`:** emit one valid
JSON envelope with synthetic data, no DB interaction (for tests).

### 5.5 Test/static gate (the merge gate)

A change reaches `main` only if **all** that apply pass:
- `node --check` on every changed `.js`.
- `bash -n` on every changed `.sh`.
- `npm test` (in `Agentic SEO/cli/`) — full suite green.
- **Coverage teeth:** if the change touches *logic* modules (`cli/lib/task_routing.js`,
  `cli/lib/outcome_loop.js`, executors, guardrails) and **no test covers the change**,
  the session must **add a test** or the change is downgraded to **preview-only**
  (push branch + Telegram approve, no auto-merge).
- For doc/prompt/process/config-only changes, static checks + the integration smoke
  (5.11) suffice.

### 5.6 Allowed / forbidden file scope

**Allowed (autonomous edit):**
`cli/` (lib, commands, except the no-touch files below), `cron/*.sh`, `processes/*.md`,
`hermes/skills/client/**`, Brain seed/process files under
`processes/brain-seed/`.

**Forbidden (owner-only; the loop refuses and parks `needs_review`):**
- `config/guardrails.json` keys: `require_explicit_approval`, `auto_approve_up_to_risk_level`,
  and the entire `self_improvement` safety block (the cage cannot widen itself).
- `config/no_go_keywords.json` / Brain No-Go Sources.
- `.env`, any credentials/secrets, `cli/lib/email_credentials.js` values.
- Deleting any executor command file.
- Anything under `Website/` or the site repo; DNS/domain/SSL/robots/sitemap.

**`db_reconciliation` special rule:** may only reconcile task/ledger **state via
`v2` CLI calls** (`task update`, `db query --allow-write` is disallowed for it);
**never raw SQLite writes** (per `system-rules`). Extra event logging required.

### 5.7 Engineer Hermes playbook — `processes/self-improvement.md`

New runtime playbook (sibling to `self-evaluation.md`) that the Engineer session
follows. Sections:
- **Setup:** pin `WEBSITE_AGENT_DB_PATH`, load Brain summary + the
  `obsidian-memory-protocol`, recall prior lessons for the gap.
- **Scope contract:** the allowed/forbidden lists (5.6); refuse out-of-scope.
- **Repair steps:** read the failing artifact, make the minimal targeted edit, add/
  update a test when touching logic, run the gate, write the Brain decision.
- **Reversibility:** every change must be a single revertable commit; record the SHA.
- **Notify:** Telegram (+ email) with the diff summary and acceptance criterion.

### 5.8 `cron/run-self-improvement.sh` (new worker)

Clone of `run-auditor.sh` / `run-ops-pipeline.sh` structure:
- `set -euo pipefail`; pin `WEBSITE_AGENT_ROOT` + `WEBSITE_AGENT_DB_PATH`.
- **Kill-switch guard:** read `SELF_IMPROVEMENT_ENABLED` from `.env`; if not `true`,
  log `[disabled]` and exit 0.
- Run-lock `self-improvement` (TTL 30m); heartbeat start/finish.
- `MAX_ATTEMPTS=3` park-to-`needs_review` guard (reuse the ops-pipeline pattern).
- `task next --lane self_improvement` → if a task, `v2 self-improve --task <id>
  --apply`; else `[idle]`.
- Timeout wrapper around the Hermes session (e.g. 1440s) with the
  `done-after-timeout` reconciliation the blog pipeline uses.
- **Cron:** `*/11 * * * * /opt/website-agent/cron/run-self-improvement.sh
  >> .../logs/self-improvement.log 2>&1` (added to `cron/install-crons.sh`).

### 5.9 Auditor integration

`processes/self-evaluation.md` + `cron/run-auditor.sh` prompt + the
`self-evaluation` Hermes skill:
- **New Phase-4 rule:** when a gap is in the agent's *own substrate*, file a
  `self_improvement` (or sub-type) task instead of a content/ops task. If the gap is
  **systemic** (recurred across 2 consecutive audits) or an approved recovery task
  has been **unconsumed for 90+ minutes**, the Auditor **creates and approves** the
  repair task (it is safe-risk by definition — reversible, test-gated).
- **Forcing function:** every Auditor run must record, in its Brain decision, either
  `"no promotable improvement"` or the `self_improvement` task id it created.
- The Auditor keeps its 5-task cap; self_improvement tasks count toward it.

### 5.10 Daily reflection pass

New scheduled process (folded into a daily cron, after the last 23:00 UTC audit):
1. Pull 7 days of Auditor Brain decisions, recurring Lessons, all `needs_review`
   parked tasks, and the `cron_runs` failure ledger.
2. Cluster gaps; a cluster seen across **≥2 windows** is systemic → eligible.
3. File ≤N `self_improvement` tasks with full evidence + acceptance criteria.
4. Dedupe against open self_improvement tasks (reuse `dedupeKeyForTask`).

### 5.11 Effectiveness loop + auto-revert (mandatory under full autonomy)

- Each applied repair opens a **meta-experiment** (gap id, commit SHA, baseline
  signal, acceptance criterion, `verify_after`).
- The **next Auditor window** evaluates: did the targeted gap stop appearing AND did
  the acceptance criterion hold?
  - **Closed** → mark meta-experiment `improved`; Brain lesson recorded.
  - **Unchanged after N checks** → escalate to owner (Telegram), leave for human.
  - **Worse, or a new `cron_runs` failure traceable to the commit** → **auto-revert**
    the meta-commit via `deploy-rollback --apply --push` (same mechanic as the SEO
    outcome-loop), set task `rollback`, and escalate with the diff that was reverted.
- A revert is itself logged but opens **no** new meta-experiment (no revert loop).

### 5.12 Safety cage (hard constraints, even under full autonomy)

`config/guardrails.json` → new `self_improvement` block:

```json
"self_improvement": {
  "enabled_env": "SELF_IMPROVEMENT_ENABLED",
  "autonomy": "full_reversible",
  "merge_gate": ["node_check", "bash_n", "npm_test", "coverage_for_logic_changes"],
  "max_files_per_change": 8,
  "max_tasks_per_day": 5,
  "git_lock_resource": "site-git",
  "auto_revert_on_regression": true,
  "no_touch": [
    "config/guardrails.json#require_explicit_approval",
    "config/guardrails.json#self_improvement",
    "config/no_go_keywords.json", ".env", "credentials", "secrets",
    "Website/**", "dns", "domain", "ssl", "robots", "sitemap",
    "delete:executor"
  ],
  "db_reconciliation_cli_only": true
}
```

The seven rails: **test-gate = merge-gate · no-touch list · branch + auto-revert ·
shared git lock · bounded blast radius · kill switch · CLI-only DB reconciliation.**

### 5.13 Monitoring & observability

`cli/commands/monitor-check.js` gains:
- `authoritative_db_path` — active DB resolves to the canonical absolute path; no
  phantom `\opt*` file present. **Critical** if violated.
- `self_improvement_backlog` — warn if an approved self_improvement task is
  unconsumed > 90m (this is also the Auditor trigger) or if the worker heartbeat is
  stale.
- `self_improvement_worker` — heartbeat freshness for the new job.

### 5.14 Notifications (both channels)

- **Fix SMTP 535:** repair the credential in `.env` (likely expired app password);
  verify with `v2 email send`. Keep the skimmable email digests.
- **Telegram fallback everywhere:** wire the planner and weekly-review notify paths
  so an email failure **falls back to Telegram** (the Auditor already proves
  Telegram works) instead of silently dropping the message.

---

## 6. Public interfaces (summary)

- **New task types:** `self_improvement`, `process_update`, `prompt_update`,
  `cron_repair`, `executor_repair`, `db_reconciliation`.
- **New lane:** `self_improvement` (accepted by `task next --lane`).
- **New command:** `v2 self-improve --task <id> [--apply|--dry-run] --json`,
  `v2 self-improve --sample --json`.
- **New cron:** `run-self-improvement.sh` (`*/11 * * * *`).
- **New process docs:** `processes/self-improvement.md` (Engineer playbook); daily
  reflection section.
- **Monitor checks:** `authoritative_db_path`, `self_improvement_backlog`,
  `self_improvement_worker`.
- **Config:** `guardrails.json.self_improvement`; `.env` `SELF_IMPROVEMENT_ENABLED`.

---

## 7. Data model & records

- **Task metadata:** evidence object per 5.3 (`gap`, `recurrence`, `target_files`,
  `acceptance`, `meta_experiment`, `commit_sha`).
- **Events:** `self_improvement_applied`, `self_improvement_reverted`,
  `self_improvement_parked`.
- **Brain notes:** one **decision** per applied repair; **lesson** when a meta-
  experiment closes; **observation** for a newly clustered systemic gap.
- **Meta-experiment:** reuse the `experiments` table shape (or a parallel record) —
  url/lever fields repurposed to `gap`/`commit_sha`; never store live status in the
  Brain (per `obsidian-memory-protocol.md`).

---

## 8. Test plan

**Unit (`cli/test/`):**
- `openStateDb` refuses a relative/`\opt` path and normalizes backslashes.
- `routeTask` sends each of the six new types to `self_improvement`/`meta_repair`.
- `task next --lane self_improvement` returns only approved, due, in-lane tasks and
  sets `dispatch:'self-improve'`.
- Forbidden-file target → parked `needs_review`.
- Auditor trigger logic: 2-consecutive-gap and 90m-unconsumed both fire creation.
- Effectiveness loop: regression → auto-revert decision; closed → `improved`.

**CLI regression:**
- `v2 self-improve --sample --json` emits one valid envelope.
- `v2 self-improve --dry-run` builds the prompt with zero file/DB mutation.
- `monitor-check --json` includes the three new checks and flags a seeded phantom DB.

**Static:** `bash -n` on all changed cron scripts; `node --check` on all changed JS.

**Integration smoke:** temp SQLite DB with one approved `self_improvement` task →
worker selects it, runs dry-run, starts/finishes heartbeat, and does **not** touch
the ops/blog lanes or push git.

**E2E acceptance (staged on server):** seed the split-DB gap → Auditor files+approves
a `cron_repair` task → worker branches, patches a wrapper's raw `sqlite3` call, gate
passes, merges, monitor `authoritative_db_path` flips to ok → next audit closes the
meta-experiment `improved`.

---

## 9. Rollout phases

### Phase 1 — Lane + DB-path hardening + clear blockers *(reversible, highest leverage)*
- Add `self_improvement` types/lane/bucket to `task_routing.js`; lane + dispatch to
  `task-next.js`.
- `openStateDb` absolute-path guard + backslash normalization.
- Audit & fix raw `sqlite3`/python DB access in `processes/`, `cron/`, `hermes/skills/`;
  switch playbooks to the env-var DB convention.
- Manually resolve the 3 zombie recovery tasks.
- Tests: routing, `openStateDb`, lane picker. **Acceptance:** new lane routes; no
  raw `\opt` access remains; `npm test` green; zombies closed.

### Phase 2 — Executor + worker + safety cage
- `cli/commands/self-improve.js` (apply/dry-run/sample) with the full gate + scope.
- `cron/run-self-improvement.sh` + `install-crons.sh` entry + kill switch.
- `processes/self-improvement.md` Engineer playbook.
- `guardrails.json.self_improvement` block.
- Tests: sample/dry-run envelopes, forbidden-file parking, integration smoke.
  **Acceptance:** dry-run repairs a seeded doc gap end-to-end without mutation;
  kill switch halts the worker.

### Phase 3 — Auditor rules + daily reflection + effectiveness/auto-revert
- Auditor Phase-4 rules + forcing-function recording.
- Daily reflection pass + dedupe.
- Meta-experiment open/verify/auto-revert wiring.
  **Acceptance:** a seeded systemic gap is auto-filed, repaired, verified closed;
  a deliberately-bad repair auto-reverts and escalates.

### Phase 4 — Monitoring + notifications
- Three monitor checks.
- SMTP 535 fix + Telegram fallback in planner/weekly-review.
  **Acceptance:** monitor flags a phantom DB and a stale backlog; an email failure
  degrades to Telegram.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Autonomous bad merge breaks the agent | Test-gate=merge-gate; auto-revert on regression; kill switch |
| Loop widens its own permissions | `self_improvement` block + `require_explicit_approval` in no-touch list |
| Concurrent git push corruption | Shared `site-git` lock across all pipelines |
| `db_reconciliation` corrupts truth | CLI-only, no raw writes, extra event logging |
| Skill edit not deployed | Repo→`/root/.hermes/` sync step in the executor |
| Dirty working tree clobbered | Stash-and-restore; never discard unrelated changes |
| Churn / runaway task creation | Audit gates (2-consecutive / 90m); `max_tasks_per_day:5` |

---

## 11. Seed backlog (proves the loop E2E)
1. Raw-`sqlite3` / python DB access using the `\opt\...` literal → CLI/env-var.
2. SMTP 535 on every email path → fix creds + Telegram fallback.
3. The 3 zombie recovery tasks (`67E5E2DC`, `60B4F92D`, `AFE9727E`).

## 12. Open assumptions
- The server keeps `agent` and `site` as separate checkouts; the agent repo's `main`
  push does not trigger a Cloudflare site rebuild. **Verify before Phase 2 push.**
- A repo→`/root/.hermes/skills/` sync command exists (or we add one). **Verify.**
- `npm test` in `Agentic SEO/cli/` is the authoritative suite and currently green.
