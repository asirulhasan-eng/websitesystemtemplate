---
id: obsidian-memory-protocol
name: "Obsidian Memory Protocol"
version: 1
description: "When and how the agent recalls and records human-readable memory in the Obsidian Brain. Referenced by the other playbooks."
can_run_manually: false
---

# Obsidian Memory Protocol

The Obsidian Brain (`01-Agent-Brain/`) is the agent's **human-readable memory**: read it
before deciding, write to it as work happens, curate it over time. This file defines the
rules; other playbooks reference it.

> **Cardinal rule:** the Brain stores *reasoning, policy, and lessons* â€” never live state.
> Task status, positions, metrics, and deploy state live in SQLite/mirror notes. A position
> number or task status written into a Brain note is a bug.

---

## A. RECALL â€” read before you decide

Run **before** generating, prioritizing, recommending, or executing work:

```bash
v2 brain summary --markdown                       # standing policy (no-go, rules, strategy)
v2 brain recall --query "<keyword or topic>" --markdown   # prior decisions/lessons/observations
```

Recall by what you're about to touch:
- About to work a keyword/page â†’ `v2 brain recall --query "<keyword>"`
- Picking a tactic â†’ `v2 brain recall --type lesson --query "<tactic>"` (did we try this? did it work?)
- Acting on a task â†’ `v2 brain recall --task <task-id>`

Use what you recall: don't repeat a tactic a Lesson says backfired; respect a prior Decision
unless conditions changed; honor policy/no-go from the summary.

## B. RECORD â€” write as work happens (event-driven, not on a timer)

Use `v2 brain note add --type <decision|lesson|observation>`. Writes go through SQLiteâ†’Outbox
and land in `01-Agent-Brain/{Decisions,Lessons,Observations}/`.

| Type | When | Cadence |
|------|------|---------|
| **decision** | You chose to do / not do something and the *why* matters next time | One rollup per session/event |
| **lesson** | An outcome can be attributed to a prior action (page moved after a fix; a tactic backfired) | When results land |
| **observation** | A notable signal worth remembering (content gap, competitor move, SERP shift) | As noticed |

Good entries are **one idea each**, titled so future recall finds them, tagged, and linked to
the task (`--task`) and related notes (`--links`). Example:

```bash
v2 brain note add --type lesson \
  --title "Title-tag rewrite lifted 'SEO for {{AUDIENCE}}' 7->3" \
  --body "Rewrote the service-page title tag on 2026-05-20; GSC avg position moved 7.1 -> 3.2 over 9 days. Repeatable for money pages with weak CTR." \
  --task TSK-2026-05-20-XXXX --tags "serp,title-tag,money-page" --links "SEO Strategy"
```

### Do NOT record
- Live metrics/status (use SQLite/mirror).
- One note per task per run â€” write **one** rollup per session, not per action (mirror notes
  already capture per-task state). Dedupe hard.
- Policy notes are **never** auto-written. Promotion of a recurring lesson into policy
  (No-Go / Operating Rules / Strategy) happens only in weekly review on owner confirmation.

## C. Where memory belongs per trigger

| Trigger | Recall | Record |
|---------|--------|--------|
| Outbox worker (10m) | â€” | â€” (it is the write *mechanism*) |
| Health monitor (15m) | â€” | â€” (alerts already mirror to System-Logs) |
| **Intelligence modules** (pre-planner) | recall per keyword/topic being analyzed | **Observations** â€” auto-written by `v2 intelligence report` when a report is noteworthy (interpretation, not raw metrics) |
| **Daily planner Ã—2** | summary + **intelligence summary** + recall per keyword (Step 0/2) | **one Decision rollup / session** (Step 8) |
| **Analyst (2-hourly)** | recall per watched keyword | **Lessons** on attributable outcomes |
| Opportunity scan | summary + recall | Observations (gaps, competitor moves) |
| Task triage | recall per task | â€” (mirror updates only) |
| Weekly review | full recall + `v2 intelligence search --days 7` | **consolidate + propose policy promotions** |

**Where NOT:** never add recall/record to the mechanical loops (outbox, monitor) â€” they make
no strategic decision, and coupling them to the Brain risks taking down sync/monitoring if the
Brain is briefly unavailable.

## D. Curation (keep memory updated, not just appended)

In weekly review: skim the week's Decisions + Lessons, merge duplicates, archive stale episodic
notes (set `status: archived` â€” the compiler and recall skip archived), and surface recurring
Lessons as **proposed** policy edits in the plan email (opt-out). Promote on owner confirmation.

Rhythm: **append continuously â†’ learn on outcomes â†’ consolidate weekly â†’ promote deliberately.**
