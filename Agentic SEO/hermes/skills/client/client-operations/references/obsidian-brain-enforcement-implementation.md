# Obsidian Brain Enforcement Implementation Pattern

Use this when a {{SITE_NAME}} Brain pitfall/remedy backlog needs to move from documentation into enforced workflow behavior.

## Risk lane
- Treat this as **Semi-safe**: agent tooling, tests, and Obsidian Brain/compiled Brain change, but production site content should not be deployed.
- Push both repos when both changed: `/opt/client-agent` and `/opt/client-obsidian`.

## Implementation checklist
1. Pull and verify clean repos before editing:
   - `/opt/client-agent`
   - `/opt/client-obsidian`
2. Write tests first for the boundary behavior:
   - Brain compiler rejects duplicate active `rule_id` values.
   - Brain compiler rejects conflicting active rules for the same term/match/fields with different outcomes.
   - Brain health fails when Brain no-go terms drift from `config/no_go_keywords.json`.
   - Brain health fails when compact `BRAIN.md` exceeds the configured prompt-size limit.
   - Outbox sync refuses accidental writes into `01-Agent-Brain/` unless the note explicitly has `managed_by: client-agent`.
   - Task executor blocks stale-lane tasks with `risk_reclassification_required` when compiled Brain `risk_rules` reclassify them.
   - Daily observer source order keeps Brain health before candidate generation and Brain reconciliation before daily summary.
3. Extend `tools/lib/obsidian_brain.js` rather than duplicating guard logic:
   - Compile `risk_rules` into `BRAIN.json`.
   - Validate duplicate/conflicting `rule_id`s across no-go and risk rules.
   - Export a reusable `evaluateRiskWithBrain(entity, brain)` helper.
4. Extend execution boundaries:
   - `run_task_executor.js` should call both `assertAllowedByBrain` and `evaluateRiskWithBrain` before child executors run.
   - Pass `--brain-vault` through to child safe/semi/high-risk executors.
5. Extend health checks:
   - `check_obsidian_brain_health.js` should report `no_go_drift`, `compact_prompt_size`, and a memory pointer check without printing credential values.
   - If using CLI flags beginning with `--no-` such as `--no-go-config`, ensure the shared arg parser treats them as normal valued options when followed by a value, not automatic boolean negation.
6. Protect Brain from mirror outbox writes:
   - Add an exported `assertSafeObsidianWritePath(obsidianRoot, notePath, markdown)` helper in `sync_obsidian_outbox.js`.
   - Refuse writes under `01-Agent-Brain/` unless the rendered markdown/frontmatter has `managed_by: client-agent`.
   - Do not run sync side effects when the module is imported for tests; guard `main()` with `if (require.main === module)`.
7. Extend the daily observer sequence:
   - Brain health before candidate generation.
   - Brain reconciliation after candidate generation and before daily summary, so user-facing queue/report state reflects Brain-enforced cancellations.
8. Update the Obsidian Brain note from recommendations to implemented remedies, then compile and health-check the Brain.

## Verification commands
Run from `/opt/client-agent`:

```bash
node --test
node tools/compile_obsidian_brain.js --vault /opt/client-obsidian --json
node tools/check_obsidian_brain_health.js --brain-vault /opt/client-obsidian --json
node tools/reconcile_tasks_with_brain.js --db /opt/client-sqlite/seo-agent.db --brain-vault /opt/client-obsidian --json
node tools/export_task_queue.js --db /opt/client-sqlite/seo-agent.db --brain-vault /opt/client-obsidian --status candidate --limit 100 --json
```

Expected final evidence shape:
- `node --test`: all tests pass.
- Brain health includes `compiled_fresh: true`, `no_go_drift: true`, and `compact_prompt_size` under limit.
- Exported visible candidate queue has `switch_monster_visible: 0`.
- Both repos are clean and `HEAD == origin/main` after push.

## Pitfalls
- Do not let tests import an operational script that auto-runs `main()`; it can process real outbox jobs. Export helper functions and guard `main()`.
- The shared CLI parser may misread `--no-go-config` as `go-config=false`; fix parser behavior for valued `--no-*` options instead of renaming every flag.
- Health checks in JSON mode should still print a concise failure name to stderr so `assert.throws`/CI output shows which check failed.
- Do not store session commit hashes or current task IDs in the skill; keep those in the chat/report only.
