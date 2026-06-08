# Obsidian Brain Workflow Pitfalls and Remedies

Use when the user asks to make the Obsidian Brain more durable, deeply interconnected, or resistant to future automation mistakes.

## Session learning

After implementing the first Obsidian Brain guardrail layer, the user asked to "identify more pitfalls, limiting conditions, breakpoints, boundary conditions" and store recommendations as Obsidian Brain remedies interconnected with all workflows. The durable pattern is not merely adding another note: create a class-level Brain checklist note, cross-link it from core Brain notes, compile the Brain, verify wikilinks, commit/push the Obsidian repo, and report evidence.

## Recommended Brain artifact shape

Create or maintain:

```text
/opt/client-obsidian/01-Agent-Brain/Workflow Pitfalls and Brain Remedies.md
```

The note should contain, for each pitfall:

- Workflow(s) affected
- Breakpoint / failure mode
- Limiting condition / why automation fails there
- Obsidian Brain remedy
- Verification command or test expectation

Interconnect it from these core Brain notes:

- `Brain Index.md`
- `Operating Rules.md`
- `Task Generation Rules.md`
- `Risk Lanes.md`
- `Evidence Standards.md`
- `Memory Sync Policy.md`

## Workflows to cover

At minimum, cover:

- user instruction -> Hermes memory -> Obsidian Brain
- Brain compile / health / last-good fallback
- task generation
- task export / task list
- SQLite reconciliation
- direct task-ID execution
- safe executor
- semi-safe preview pipeline
- high-risk approval pipeline
- daily observer
- daily summary
- outbox sync and Obsidian mirror
- GitHub push of agent and Obsidian repos
- credential notes and prompt/report redaction
- monitoring/dead-man alerts

## Pitfall categories worth encoding

- Conversation-only or prose-only rules not being enforceable.
- Stale compiled Brain after human edits.
- Broken frontmatter/YAML disabling critical rules.
- Last-good fallback being used for side-effect workflows instead of read-only reporting.
- Existing SQLite tasks predating new no-go rules.
- Direct task execution bypassing filtered exports.
- Domain matching false positives and false negatives.
- Credential notes being allowed intentionally, while compact summaries/health reports omit credential values.
- Outbox sync overwriting hand-authored `01-Agent-Brain` notes.
- Safe autopilot dry-run or missing `target_file` issues.
- Semi-safe empty preview branches or missing preview URLs.
- High-risk approval bypass or risk-lane drift after task creation.
- Concurrent/double-execution lock problems.
- Dead-man alert feedback loops and daily heartbeat false positives.
- Daily summary becoming stale after cleanup/reconciliation.
- Agent repo pushed without Obsidian Brain repo, or compiled Brain artifacts committed stale.
- Prompt summary becoming too large.
- Conflicting active Brain rules or duplicate `rule_id` values.
- Polluted external source data creating bad tasks.
- Reporting success without exercising the result.
- Confusing generated Obsidian mirror notes with hand-authored Brain notes.

## Verification pattern

After editing Brain notes:

```bash
node /opt/client-agent/tools/compile_obsidian_brain.js --vault /opt/client-obsidian --json
node /opt/client-agent/tools/check_obsidian_brain_health.js --brain-vault /opt/client-obsidian --json
```

Also run a wikilink validation script or equivalent check. In the session that produced this reference, validation confirmed:

```json
{
  "checked_notes": 17,
  "missing_count": 0,
  "missing_wikilinks": []
}
```

Before reporting success, commit and push the Obsidian repo. If agent tooling changed too, push both `/opt/client-agent` and `/opt/client-obsidian` and verify `HEAD == origin/main` in both.

## Reporting expectation

Report:

- Risk classification.
- Files changed.
- Brain compile hash and health status.
- Wikilink validation status.
- Commit hash(es) and push status.
- Clean/synced repo status.

Keep the user-facing summary concise, but include exact commands run and evidence because this user expects operational proof.
