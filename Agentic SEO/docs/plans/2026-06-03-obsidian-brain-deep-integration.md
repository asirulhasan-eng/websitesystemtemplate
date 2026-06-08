# Obsidian Deep Integration â€” Human-Readable Memory Brain (v2 Implementation Plan)

> **Status:** plan / not yet implemented. **Scope:** `cli/`, `hermes/`, `config/`, `processes/`, `cron/`.
> **Out of scope:** legacy v1 tooling, which has been removed from the active tree.
> **Date:** 2026-06-03.

## 1. Goal

Make Obsidian a **deeply integrated, human-readable memory brain** for {{SITE_NAME}} â€” read before deciding, written as work happens, curated over time â€” without breaking the rule that **SQLite is the operational source of truth**.

Today the machinery exists but is half-wired:
- Real Brain compiler/loader/guard in [obsidian_brain.js](../../cli/lib/obsidian_brain.js) (`compileBrain` L62, `loadBrain` L254, `assertAllowedByBrain` L302, `evaluateRiskWithBrain` L412).
- Execution lanes call the guard ([task-execute-safe/semi/high](../../cli/commands/)).
- **But** the surrounding system tells agents Obsidian is *only a mirror, "never an authority"* ([skill.md:9](../../hermes/skills/obsidian/skill.md), [MEMORY.md:20](../../hermes/memories/MEMORY.md)), the Brain is enforced too late and inconsistently, and nothing ever *writes* memory back. It is a policy brain bolted on, not a memory brain.

## 2. The corrected contract (foundation for everything below)

Obsidian plays **two distinct roles** that the system has never formally separated. This split is the spine of the plan:

| Concept | Authority | Direction | Lives in |
|---|---|---|---|
| **SQLite** | Operational truth: tasks, events, approvals, deployments, locks, status | â€” | `seo-agent.db` |
| **Obsidian Mirror** | None (downstream view of SQLite) | SQLite â†’ vault, via Outbox only | `02-Tasks`, `04-Pages`, `11-Approvals`, `12-Reports`, `14-System-Logs` |
| **Obsidian Brain** | Long-lived human knowledge: no-go rules, operating rules, risk lanes, preferences, strategy, decisions, lessons | vault â†’ agents (read before deciding); agents â†’ vault (write memory, gated) | `01-Agent-Brain/` |

The Brain itself has **three memory tiers** by durability â€” this distinction governs *where* writes are allowed:

| Tier | Folder | Writer | Cadence | Auto-overwrite? |
|---|---|---|---|---|
| **Policy** (authoritative, feeds the guard) | `No-Go Sources`, `Operating Rules`, `Risk Lanes`, `Task Generation Rules`, `SEO Strategy`, `User Preferences`, `Evidence Standards` | human / **gated promotion** | rare | **Never** |
| **Lessons** (causeâ†’effect) | `01-Agent-Brain/Lessons/` | agent, **event-driven** (outcome observed) | when results land | append; dedupe |
| **Episodic** (journal) | `01-Agent-Brain/Decisions/` | agent, **per session/event** | 2Ã—/day + scans | append; auto-archive when stale |

**Cardinal rule:** the Brain stores *reasoning, policy, and lessons* â€” never live state/metrics/status (those are mirror/SQLite). A position number or task status in a Brain note is a bug.

---

## 3. Phased implementation

Ordered by dependency and fail-safety. Phases 0â€“1 must land before 2/4, because Phase 2 (enforce everywhere) and Phase 4 (`--strict` preflight) **fail closed** â€” without seeded, loadable Brain notes they would brick task creation and the daily loop.

### Phase 0 â€” Rewrite the source-of-truth contract (docs only, no behavior change)

**Why:** the live guidance currently forbids exactly what we're building. Until this is fixed, every other phase contradicts the agent's own instructions.

**Changes:**
- [hermes/skills/obsidian/skill.md](../../hermes/skills/obsidian/skill.md): replace the "mirror, never an authority / do not read the vault to make decisions" framing (L9, L15) with the two-role + three-tier contract from Â§2. Keep "never repair SQLite from the vault" and "Outbox is the only mirror writer" â€” those stay true.
- [hermes/memories/MEMORY.md:20-24](../../hermes/memories/MEMORY.md): change "Obsidian is mirror, NEVER authority" to: *mirror notes are downstream; `01-Agent-Brain/` is authoritative for policy/strategy/lessons and must be read before planning/generation/execution.* Add a one-line pointer: "Run `v2 brain summary` before deciding work."
- [processes/daily-workplan.md](../../processes/daily-workplan.md): add the contract reference + a new **Step 0** (wired for real in Phase 4).

**Acceptance:** the three docs describe one coherent model; no remaining text tells the agent the vault is read-only-for-decisions.

---

### Phase 1 â€” Brain foundation & durability

**Why:** the compiler reads `01-Agent-Brain/` which exists only on the prod box; `Glob **/01-Agent-Brain/**` returns nothing in-repo. A fail-closed brain with no reproducible source is one `rm` from bricking the system.

**Changes:**
1. **Seed + version-control the Brain.** Add `processes/brain-seed/01-Agent-Brain/*.md` â€” the canonical notes for every required + strategic domain: `no_go`, `operating_rules`, `risk_lanes`, `task_generation` (the 4 the compiler requires, [obsidian_brain.js:11](../../cli/lib/obsidian_brain.js)), plus `user_preferences`, `seo_strategy`, `evidence_standards`, `project_decisions`. Each with machine-readable frontmatter blocks (`blocked_terms`, `risk_rules`) where applicable. Includes the `switch.monster` no-go block (`match_type: domain`).
2. **`v2 brain init`** â€” new command: copies the seed into the live vault **only if absent** (never clobbers hand-authored notes), then compiles. Makes the brain reproducible on any machine.
3. **Path portability** â€” default the vault path from [config/site.json](../../config/site.json) `paths.obsidian_vault`, then env (`CLIENT_BRAIN_VAULT`/`CLIENT_OBSIDIAN_ROOT`), then the `/opt/...` fallback. Apply in `resolveVaultRoot` ([obsidian_brain.js:15](../../cli/lib/obsidian_brain.js)) and the outbox writer.
4. **Expand the compact summary.** `renderBrainMarkdown` ([obsidian_brain.js:231](../../cli/lib/obsidian_brain.js)) and `brain-summary` only surface `no_go/risk_lanes/operating_rules/task_generation`. Add domain-specific sections for `user_preferences`, `project_decisions`, `seo_strategy`, `evidence_standards`, and `lessons` â€” kept compact (respect the 8â€“12 KB target) but no longer invisible.
5. **YAML hardening â€” DECISION REQUIRED (see Â§5).** The custom parser ([obsidian_brain.js:454](../../cli/lib/obsidian_brain.js)) self-documents that it breaks on multiline strings, flow arrays, anchors, and deep nesting â€” fragile for a human-edited vault. Either adopt a real YAML parser or enforce a strict, validated schema with friendly errors.

**Tests:** `v2 brain init` into temp dir creates all domains; `v2 brain compile` succeeds and lists `switch.monster`; summary includes the new domains; vault path resolves from `site.json`.

**Acceptance:** `v2 brain health --json` â†’ `ok:true` with all required + strategic domains present, from a clean checkout.

---

### Phase 2 â€” Enforce the Brain everywhere (not just execution)

**Why:** no-go/risk rules are enforced at execution but the task is already attractive work by then. The current "no-go" at creation/routing is a **hardcoded substring** (`targetText.includes('switch.monster')` at [task_routing.js:66](../../cli/lib/task_routing.js), filtered at [task-audit.js:91](../../cli/commands/task-audit.js)) â€” it ignores the Brain entirely and false-positives on prose like "why switch.monster was blocked" (the exact failure the Brain's domain matcher avoids). [task-create.js:156](../../cli/commands/task-create.js) routes only through `guardrails.json`, never the Brain.

**Changes â€” replace hardcodes with `assertAllowedByBrain` / `evaluateRiskWithBrain`:**
1. **task-create** â€” load Brain; run `assertAllowedByBrain` on the candidate. `severity: block` â†’ refuse (fail closed); `warn` â†’ create but flag. Log `brain_guard_blocked` event.
2. **task_routing** â€” delete the hardcoded `switch.monster` check; derive the `blocked_no_go` bucket from Brain `blocked_terms` passed in via context. Keeps routing pure (no I/O) by accepting compiled terms as a parameter.
3. **task-audit / preselect** â€” drive `no_go` and bucketing from Brain output, not the hardcoded flag.
4. **task-list / task-search** â€” filter/annotate recommendations using Brain (read-only lane: degrade to last-good with a loud warning if stale, never hard-fail a list view).
5. **task-dedupe** â€” never resurrect or merge into a no-go task.
6. **Risk reclassification (apply `evaluateRiskWithBrain`)** â€” in create/update/audit/execution: if the Brain reclassifies a task (e.g. `safe`â†’`high_risk`), upgrade `risk_level`/`approval_required` and route to `review`/`approval_needed` **before** any lane runs. This is the currently-dead `evaluateRiskWithBrain` (L412) finally wired in.

**Lane failure policy** (consistent with [loadBrain](../../cli/lib/obsidian_brain.js:254) modes): create/update/execute = fail closed on missing/stale/invalid Brain; read-only list/search/audit = degrade to last-good + warn.

**Tests:** creating a `switch.monster` task is refused at create; a stale no-go row is bucketed `blocked_no_go` and hidden from list; a Brain risk rule flips a task to high_risk and forces approval; prose mentioning a blocked term in a *description* does **not** false-positive (domain match, not substring).

---

### Phase 3 â€” `v2 brain reconcile`

**Why:** existing SQLite rows predate new Brain rules; export hides them but direct execution by ID could still fire. v1 had `reconcile_tasks_with_brain.js` (reference-only); v2 has no equivalent.

**Changes:** new `v2 brain reconcile --db <path> [--apply] --json`. Scans active tasks against compiled `blocked_terms`:
- `candidate`/`open` no-go rows â†’ auto-cancel (with event + queued mirror update) under `--apply`; dry-run by default.
- `approved`/`preview_*`/`in_progress` no-go rows â†’ **do not** auto-cancel; flag `needs_manual_review` and alert.
- Report counts in JSON for the daily Brain section (Phase 5).

**Tests:** seeded no-go candidate is cancelled under `--apply`; a no-go row with an approved approval is flagged, not cancelled; dry-run mutates nothing.

---

### Phase 4 â€” Daily-loop Brain preflight + prompt wiring

**Why:** [run-daily-workplan.sh:41](../../cron/run-daily-workplan.sh) runs `monitor-check` then hands Hermes the playbook/guardrails/site config â€” never the Brain. The agent plans blind to its own memory.

**Changes:**
1. In `run-daily-workplan.sh`, **after** the health gate, add:
   `node "$V2_CLI" brain health --compile --strict --json` â€” abort + alert email on non-ok (fail closed for the generation/execution session), same pattern as the existing critical-health abort.
2. Add the Brain summary to the Hermes prompt's "Read first" block: `node $V2_CLI brain summary --markdown`.
3. [processes/daily-workplan.md](../../processes/daily-workplan.md) **Step 0 (new):** "Load the Brain (`v2 brain summary --markdown`); if `v2 brain health --strict` is not ok, abort." Insert before Step 3 (GSC).

**Where NOT to add this:** the **outbox worker (10 min)** and **health monitor (15 min)** must stay Brain-independent â€” they move bytes / release locks and make no strategic decision. Coupling them to a hand-edited markdown file means one typo takes down sync + monitoring. The monitor may *emit* an alert that becomes a note via the Outbox, but it never *reads* the Brain.

**Acceptance:** a stale/broken Brain aborts the workplan with an alert; a healthy Brain's summary appears in the session log/prompt.

---

### Phase 5 â€” Deepen health & observability

**Why:** [brain-health.js:69](../../cli/commands/brain-health.js) checks missing/stale/no-go/prompt-size only.

**Changes â€” extend `v2 brain health` to also report:**
- compiled-fresh vs. last-good-fallback state;
- **no-go drift** between compiled Brain and any remaining config/memory pointers (drift = warning for read-only, critical for generation if a critical term disappeared);
- **missing critical domains** beyond compiler minimum: `user_preferences`, `seo_strategy`, `evidence_standards`, `lessons`;
- **reconciliation state**: count of active SQLite tasks currently violating Brain rules (from Phase 3 logic).
- Add a **Brain section to the daily report** ([report-daily.js](../../cli/commands/report-daily.js)): loaded? compiled-at, no-go term count, critical warnings, reconcile violations, memory writes this session.

**Acceptance:** removing a critical domain or letting a no-go term drift shows up as a health issue and in the daily report.

---

### Phase 6 â€” The memory WRITE loop (the actual "memory brain")

**Why:** nothing writes `Decisions/` or `Lessons/` today. Memory must accumulate, and must go through SQLiteâ†’Outbox (never direct vault writes), consistent with the architecture.

**Changes:**
1. **Outbox job type `write_obsidian_brain_note`** â€” handled by [outbox-obsidian.js](../../cli/commands/outbox-obsidian.js); writes into `01-Agent-Brain/Decisions|Lessons/` with `managed_by: client-agent` frontmatter so the existing [write-guard](../../cli/commands/outbox-obsidian.js:227) permits it. **Policy notes are never written by the outbox** (guard already blocks `01-Agent-Brain/` writes without the managed flag; we additionally refuse the policy subfolders).
2. **`v2 brain note add --type decision|lesson|observation --title â€¦ --body â€¦ [--links â€¦]`** â€” inserts a SQLite row + enqueues the outbox job (one atomic transaction, like every other state change).
3. **`v2 brain note promote --lesson <id>`** â€” folds a recurring lesson into a policy note. **Gated:** only on owner confirmation (Telegram `approve`) or weekly-review opt-out; never auto-fires from a loop. Recompiles after.
4. **Write triggers (event-driven, never on a timer):**
   - **Workplan Ã—2** â†’ one **Decision** rollup per session (what was planned/run and *why*), at Step 7. One note per session, not per task (mirror notes already cover per-task state).
   - **Analyst loop (2-hourly, when scheduled)** â†’ **Lessons** when an outcome can be attributed to a prior decision (page moved after a fix), deduped against existing lessons. The analyst is the natural outcome-watcher.
   - **Opportunity-scan** â†’ **Observations** (gaps, competitor moves).

**Anti-patterns to enforce as rules:** never write live state/metrics into Brain notes; never auto-write policy; one episodic note per session/event (dedupe hard); no Brain writes from outbox/monitor decision-free loops.

---

### Phase 7 â€” Cadence wiring + curation

**Read map** (add `v2 brain summary` as a first step) â€” apply across the decision playbooks:

| Trigger | Read Brain | Write memory |
|---|---|---|
| Outbox 10m | â€” | (is the write *mechanism*) |
| Monitor 15m | â€” | anomaly â†’ alert note via outbox only |
| **Analyst 2h** (planned) | summary | Lessons (outcome attribution, deduped) |
| **Workplan Ã—2** | summary + `health --strict` | 1 Decision rollup / session |
| Task-triage | summary | mirror updates only |
| Opportunity-scan 2d | summary | Observations |
| Weekly-review | full | **consolidate + propose policy promotions** |
| Monthly-roadmap | full + strategy | Strategy note update (gated) |

**Curation (keep memory *updated*, not just appended)** â€” wire into [weekly-review.md](../../processes/weekly-review.md): read the week's Decisions+Lessons â†’ dedupe/merge, archive stale episodic notes (`status: archived`, which the compiler already skips, [obsidian_brain.js:49](../../cli/lib/obsidian_brain.js)), surface recurring lessons as **proposed** policy edits in the plan email (opt-out), and run `v2 brain note promote` on owner confirmation. Rhythm: **append continuously â†’ learn on outcomes â†’ consolidate weekly â†’ promote deliberately.**

---

## 4. Sequenced task list (dependency order)

1. **Phase 0** â€” rewrite contract in skill.md, MEMORY.md, daily-workplan.md.
2. **Phase 1** â€” seed notes + `v2 brain init` + config-driven vault path + expand summary domains + **YAML decision (Â§5)**.
3. **Phase 2** â€” Brain in task-create/routing/audit/list/search/dedupe; replace hardcodes; apply `evaluateRiskWithBrain`.
4. **Phase 4** â€” daily-loop preflight (`brain health --compile --strict`) + summary in prompt + playbook Step 0.
5. **Phase 3** â€” `v2 brain reconcile`.
6. **Phase 6** â€” write loop: outbox job + `v2 brain note add/promote` + per-session Decision + analyst Lessons.
7. **Phase 5** â€” deepen `brain health` + daily report Brain section.
8. **Phase 7** â€” cadence wiring across remaining playbooks + weekly curation.

> Note: 4 precedes 3/5 deliberately â€” get the daily loop reading a *reliable* Brain (after 1+2) before adding reconcile/observability around it. Reorder 3/5/6 freely; they're independent once 1+2 land.

## 5. Open decision â€” YAML parser

The repo is **zero-dependency** (`cli/package.json` has no `dependencies`, Node â‰¥22.5; no built-in YAML). The reviewer recommends adopting the real `yaml` package for a human-friendly brain. Options:

- **A. Adopt `yaml` (npm).** Best human-editing ergonomics (multiline, flow arrays, anchors). Cost: breaks the zero-dep architecture â€” needs sign-off.
- **B. Keep zero-dep, harden the custom parser + enforce a strict documented frontmatter schema** with friendly validation errors (reject unsupported constructs early, point to file+field). Preserves architecture; constrains how humans may write notes.
- **C. Vendor a single small parser file** into `cli/lib/` (no npm dep, full YAML). Middle ground.

**Recommendation:** **B** if zero-dep is a hard constraint (most of the human-friendliness comes from good error messages, not exotic YAML); **A/C** only if the team accepts a dependency. *This is the one item that needs an explicit owner decision before Phase 1 completes.*

## 6. Risks & mitigations

- **Fail-closed brick:** enforcing Brain + `--strict` before seed notes exist halts all work. â†’ Phases 0â€“1 first; `v2 brain init` ships before Phase 2/4; last-good fallback for read-only lanes.
- **False positives from substring rules:** the very bug being removed. â†’ use Brain `match_type: domain`/`regex`, applies-to-fields scoping; test prose mentions don't trigger.
- **Policy poisoning:** an auto-written or hallucinated policy rule could block all work. â†’ policy notes never auto-written; promotion is owner-gated; `brain health` drift check.
- **Memory landfill:** unbounded episodic notes. â†’ one note per session/event, dedupe, weekly archive, compiler skips archived.
- **Dual-lib confusion:** an old legacy Obsidian brain library looked authoritative but was not active. All active work targets `cli/`.

## 7. Acceptance criteria (done whenâ€¦)

1. skill.md/MEMORY.md/daily-workplan describe the two-role + three-tier contract; nothing says the vault is read-only-for-decisions.
2. `01-Agent-Brain` seed notes are version-controlled; `v2 brain init` reproduces the brain on a clean machine; vault path resolves from `site.json`.
3. `switch.monster` is blocked at **create, route, audit, list, dedupe, execute, and reconcile** â€” via Brain, with **zero** hardcoded term checks remaining in `cli/`.
4. `evaluateRiskWithBrain` actively reclassifies risk before lanes run.
5. The daily loop aborts on a stale/broken Brain and loads the summary when healthy.
6. `v2 brain reconcile` neutralizes stale no-go candidates and flags approved/preview ones.
7. `brain health` reports freshness, drift, missing strategic domains, and reconcile violations; the daily report has a Brain section.
8. The agent writes Decisions per session and Lessons on outcomes through the Outbox; promotion to policy is owner-gated; weekly review consolidates.
9. Full `node --test cli/../test/*.test.js` passes, including new Brain integration/guard/write tests.
