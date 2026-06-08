# Serp-driven rewrite tasking: tooling paths and priority/risk defaults

## Why this exists
This project had a recurring ambiguity where Serper tooling was referenced from different folders. Use these canonical commands to avoid mismatched workflow steps.

## Canonical tool paths
- **SERP movement + task generation:**
  - `/opt/client-agent/tools/analyze_serp_movement.js`
  - pass `--db /opt/client-sqlite/seo-agent.db`
- **Command-line competitor search/scrape helpers (PowerShell):**
  - `/opt/client-site/tools/serper-search.ps1`
  - `/opt/client-site/tools/serper-scrape.ps1`

## Recommended rewrite-task defaults (before execution)
- Keep high-priority candidate backlog as:
  - `priority_score >= 800`
  - `status='candidate'`
  - `approval_required=true`
  - `risk_level='semi_safe'` for user-requested content updates
- For content updates, preserve a user-first gate: do not execute edits until approval.

## Practical sequence
1. Run `analyze_serp_movement.js` first to produce reproducible competitor snapshot context.
2. Update task evidence/description with concrete Serper commands.
3. Confirm queue values in DB (`status`, `approval_required`, `risk_level`, `priority_score`) before claiming work.
4. Persist DB changes through project tooling where possible; if manual writes are unavoidable, keep them minimal and verifiable.

## Source-control / evidence note
- If task descriptions are rewritten to include new command paths, do so atomically and then verify with a read query before moving to execution mode.
- Log commands run and evidence paths in the user-facing handoff summary.

## Related anti-pattern to avoid
- Do not drop a lower-path `serper-*` helper command into the `analyze_serp_movement` workflow description without explicit rationale; keep path ownership clear for reproducibility.