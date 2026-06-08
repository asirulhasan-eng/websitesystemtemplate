---
name: skill-library-curation
description: Review recent conversations and actively update the skill library with class-level, reusable procedural knowledge.
triggers:
  - User asks to review the conversation and update the skill library
  - A session reveals a reusable workflow, pitfall, preference, or tool-usage pattern
  - A loaded or consulted skill is wrong, missing a step, outdated, or inaccessible
  - User corrects style, format, verbosity, workflow, or sequence of steps
---

# Skill Library Curation

Use this skill when turning session learnings into durable skill-library updates. Prefer improving an existing class-level skill over creating narrow one-off skills.

## Core Rules

1. **Be active by default.** If the user explicitly asks to review/update the skill library, produce at least one durable skill-library update attempt in that turn (step, pitfall, or support file), unless only protected skills are the sole target and no durable alternative exists.
2. **When update is requested and no durable reusable learning exists, say `Nothing to save.` immediately with the blocker rationale.** Do not defer and do not treat this as success.
3. **Prefer class-level skills.** Do not create skills named after a PR, issue, temporary bug, single error string, feature codename, or one day's task.
4. **Prefer updating before creating.** Patch the skill that was loaded or consulted in the session first. If none fits, patch an existing umbrella skill. Create a new umbrella only when no existing class-level skill covers the work.
5. **Wire skills for future use.** A created skill is incomplete until likely umbrella skills reference it, its description/triggers match real user phrasing, and `metadata.hermes.related_skills` points to adjacent workflows. Do not leave agent-created skills as showcase artifacts.
6. **Put user workflow/style preferences in SKILL.md.** Memory can store who the user is; skills should store how this class of task should be performed for this user.
7. **Treat “unnecessary skill” feedback as a curation correction.** If the user says a newly created skill seems unnecessary, delete or absorb it instead of defending it, then patch the curation rules or the relevant umbrella so future updates favor existing class-level skills and support files over narrow new entries.
8. **Use support files for detail.** Keep SKILL.md compact and reusable. Put session-specific transcripts, reproduction notes, API excerpts, or condensed research in `references/`; reusable boilerplate in `templates/`; deterministic probes in `scripts/`.
9. **Do not preserve transient environment failures.** Avoid durable negative claims like “tool X does not work.” If setup was the issue, capture the fix or diagnostic pattern, not the failure state.
10. **Respect protected skills.** Do not edit bundled or hub-installed skills. If the only relevant update would be to a protected skill, say `Nothing to save.`

## Review Workflow

1. Identify skills loaded or consulted during the session, including skills the user explicitly requested.
2. For each signal, decide the target:
   - loaded/consulted skill covers it → patch that skill
   - existing umbrella covers it → patch that umbrella
   - detail is too specific for SKILL.md → write `references/<topic>.md` and add a one-line pointer in SKILL.md
   - no umbrella exists → create one class-level skill
3. Encode the learning as:
   - a required step,
   - a pitfall,
   - a verification check,
   - a workflow preference, or
   - a reusable diagnostic pattern.
4. Wire the skill for future use:
   - add trigger-rich descriptions and `triggers:` entries using real user wording,
   - add `metadata.hermes.related_skills`,
   - patch likely umbrella skills with routing guidance,
   - verify with `skill_view` or direct file inspection if a loader alias is inconsistent.
5. Reply with a concise summary of what changed, or `Nothing to save.`

## Umbrella-building consolidation pass

When running a background curation/consolidation pass, treat the target library shape as class-level skills with rich bodies and support files, not one-session-one-skill micro-entries.

Required workflow:
1. Scan the full candidate list and identify prefix/domain clusters before editing.
2. For every cluster with two or more members, ask whether a human maintainer would write one umbrella skill with labeled subsections. If yes, merge into an existing broad skill or create a new umbrella; do not reject consolidation merely because each sibling has a distinct trigger.
3. Preserve package integrity. Before archiving or demoting a skill, inspect its whole directory (`SKILL.md`, `references/`, `templates/`, `scripts/`, `assets/`) and any relative links. Either re-home needed support files and rewrite paths, or archive the original package unchanged; never leave demoted instructions pointing at files left behind.
4. Use support files for narrow detail: `references/` for session notes/reproduction/API excerpts, `templates/` for copyable starters, and `scripts/` for re-runnable probes.
5. Never touch bundled/hub-installed or pinned skills. Never permanently delete during consolidation; archive recoverably and record `absorbed_into` for merged skills.
6. Usage counters are not a reason to skip consolidation; judge by content overlap and library discoverability.

## Supporting References

- `references/active-skill-update-mandate.md` — captures user-triggered active update policy from this conversation: mandatory update attempt on explicit curation requests, protected-skill fallback behavior, and one-off naming guardrails.

## Pitfalls

- **Do not create one-session-one-skill entries.** If the proposed name only makes sense today, it is too narrow.
- **Do not record stale artifacts.** PR numbers, commit SHAs, issue IDs, temporary file counts, and “task completed” narratives do not belong in skills.
- **Do not turn setup state into permanent constraints.** Missing credentials, uninstalled binaries, migration quirks, or temporary path mismatches should not become durable “cannot use X” rules.
- **Do not repeatedly retry a failing skill lookup unchanged.** If `skill_view` fails while `skills_list` reports the skill, switch to diagnosis: try the qualified name once, inspect likely skill paths or profile mismatch if allowed, then report the loader/index inconsistency without hardening it as a permanent limitation.
- **Do not create shadow duplicates when a target umbrella is listed but unmanageable.** If `skills_list` shows the right class-level skill but `skill_view`/`skill_manage` cannot load or patch it in the active profile, stop after one direct management attempt and report the intended update target plus the blocker. Creating a same-topic replacement skill in the active profile usually makes later consolidation harder.

## Verification

Before finishing, ensure:

- The update is class-level and reusable.
- Any user preference is embedded in the relevant SKILL.md body.
- Support files are linked from SKILL.md when added.
- The final reply states exactly what was updated or says `Nothing to save.`
