---
name: obsidian
description: How the agent uses the Obsidian vault in v2 â€” a downstream SQLite mirror for live state, AND a human-readable memory brain (read before deciding, written as work happens).
version: 2
---

# Obsidian Skill (v2)

The Obsidian vault has **two distinct roles**. Keep them separate.

## 1. Mirror â€” downstream view of SQLite (state)

- **SQLite is the single source of truth** for live state (`/opt/client-sqlite/seo-agent.db`):
  tasks, events, locks, deployments, approvals.
- Mirror notes (`02-Tasks`, `04-Pages`, `11-Approvals`, `12-Reports`, `14-System-Logs`)
  are written **only** by the Outbox worker (`v2 outbox obsidian`), inside the same atomic
  transaction as the state change. **Never edit mirror notes by hand; never repair SQLite
  from the vault.** If they diverge, SQLite wins and the Outbox re-syncs.
- To change state, write to SQLite via the v2 CLI (`v2 task ...`, `v2 deploy record ...`,
  `v2 task approve ...`). The mirror catches up.

## 2. Memory Brain â€” `01-Agent-Brain/` (knowledge)

The Brain is the agent's **human-readable memory**. Unlike the mirror, it is authoritative
for long-lived knowledge and is meant to be **read before deciding** and **written as work
happens**. It never holds live state/metrics (those belong to SQLite/mirror).

| Layer | Folder | Authority |
|-------|--------|-----------|
| Policy | `No-Go Sources`, `Operating Rules`, `Risk Lanes`, `Task Generation Rules`, `SEO Strategy`, `User Preferences` | long-lived rules; read before planning/generating/executing |
| Lessons | `01-Agent-Brain/Lessons/` | causeâ†’effect learnings |
| Decisions / Observations | `01-Agent-Brain/Decisions/`, `Observations/` | episodic journal |

### Recall (read) â€” "remember what we know"
Before generating, prioritizing, or recommending work, pull relevant memory:
```
v2 brain recall --query "<keyword or topic>" --markdown
v2 brain summary --markdown          # compact policy summary
```

### Record (write) â€” "remember this for next time"
Memory is written like any state change: through SQLite â†’ Outbox (never direct file edits).
```
v2 brain note add --type decision    --title "..." --body "..." [--task <id>] [--tags a,b]
v2 brain note add --type lesson      --title "..." --body "..." --tags serp
v2 brain note add --type observation --title "..." --body "..."
```
The Outbox worker writes the note into `01-Agent-Brain/{Decisions,Lessons,Observations}/`.

See `processes/obsidian-memory-protocol.md` for **when** to recall and record.

## Quick reference

| You want toâ€¦ | Do this | Not this |
|--------------|---------|----------|
| Change state (task/deploy/approval) | `v2 task â€¦` / `v2 deploy â€¦` | Edit a vault note |
| Read current state | `v2 task list`, `v2 db snapshot` | Read mirror markdown |
| Recall prior reasoning/lessons | `v2 brain recall --query â€¦` | Guess from memory |
| Record a decision/lesson | `v2 brain note add â€¦` | Edit a Brain note by hand |
| Read standing policy | `v2 brain summary` | â€” |
