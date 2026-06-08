---
name: client-sync-repair
description: Fix Obsidian from SQLite when memory mismatch happens
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Sync, Obsidian, Repair]
    related_skills: [client-system-rules]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Sync Repair

## When to Use
When sync checker reports SQLite/Obsidian mismatch, when Obsidian notes are stale, or after a failed outbox run.

## The Cardinal Rule
> **SQLite WINS. Always.**
> Fix Obsidian FROM SQLite. NEVER fix SQLite FROM Obsidian.

## Procedure
```bash
cd /opt/client-agent

# Run consistency check to find mismatches
seo-agent consistency

# Run outbox worker to process pending updates
seo-agent outbox-obsidian
```

## Coverage + Navigation Repair
A clean/passing outbox check does not prove the Obsidian vault is useful for humans. After sync failures or cleanup work, also verify:

- active SQLite candidate tasks have corresponding notes in `/opt/client-obsidian/02-Tasks`
- tracked notes' frontmatter status matches SQLite
- stale/noisy cancelled notes are refreshed from SQLite, not manually rewritten
- the vault has usable Obsidian connections: dashboard/MOC, wikilinks, Bases, and Canvas where appropriate

When missing/stale task notes exist, queue `update_obsidian_task_note` jobs with `insertEventWithOutboxAtomic`, then process `tools/sync_obsidian_outbox.js`; do not hand-edit task mirrors. Human-authored navigation artifacts can be created under `00-Dashboard/` if they are clearly marked as SQLite mirrors.

See `references/obsidian-mirror-coverage-and-dashboard.md` for the full coverage audit, outbox queue pattern, dashboard artifact shape, and validation checklist.

## What the Consistency Check Verifies
- Every open SQLite task has an Obsidian task note
- Every Obsidian task note has a valid SQLite task ID
- Every Obsidian status block matches SQLite
- Every approval note matches SQLite approval state
- Every deployment note matches SQLite deployment state
- Dead outbox jobs are reported

## If Mismatch Found
1. Create sync_check row in SQLite
2. Create repair task if needed
3. Insert event inside SQLite transaction
4. Insert outbox job to update Obsidian
5. Mark stale Obsidian notes
6. Report mismatch in daily summary

## What NOT to Do
- Do NOT manually edit Obsidian to "fix" a mismatch
- Do NOT assume Obsidian is correct
- Do NOT delete Obsidian notes without SQLite confirmation
- Do NOT skip the outbox â€” always use it
