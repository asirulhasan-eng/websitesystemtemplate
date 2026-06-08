# Obsidian Brain Integration Boundary Conditions

Use when designing or implementing {{SITE_NAME}}â€™s Obsidian-as-agent-brain workflow.

## Core model

- SQLite remains the source of truth for operational state: task status, locks, approvals, deployments, outbox, execution events.
- Obsidian Brain is the durable human-readable knowledge layer: no-go sources, operating rules, risk policies, strategy, decisions, lessons, user preferences.
- Hermes memory should keep only compact always-loaded pointers and must point the agent to Obsidian Brain for fuller {{SITE_NAME}} context.

## Durable lesson from the switch.monster failure

A no-go rule written in conversation or mirrored in Obsidian is not enough. It must be:

1. Stored as a compact Hermes memory pointer.
2. Written in Obsidian Brain as human-readable rationale.
3. Compiled into a machine-readable Brain artifact.
4. Enforced by generation, recommendation, and execution guards.
5. Reconciled against existing SQLite rows so stale tasks cannot be executed by ID.

## Required implementation pattern

Create a dedicated vault section:

```text
/opt/client-obsidian/01-Agent-Brain/
  Brain Index.md
  Operating Rules.md
  No-Go Sources.md
  Task Generation Rules.md
  Risk Lanes.md
  User Preferences.md
  Project Decisions.md
  SEO Strategy.md
  Evidence Standards.md
  Memory Sync Policy.md
  Compiled/
    BRAIN.md
    BRAIN.json
    BRAIN.full.json
    BRAIN.last-good.md
    BRAIN.last-good.json
```

Compile Brain notes into structured JSON before automation trusts them. Critical rules must not be prose-only.

Example machine-readable no-go block:

```yaml
blocked_terms:
  - term: switch.monster
    match_type: domain
    severity: block
    applies_to_fields:
      - target_url
      - target_keyword
      - source
      - title
      - description
      - metadata
    reason: Fake impressions confirmed by {{OWNER_NAME}}.
    override_allowed: false
    rule_id: no-go-switch-monster
```

## Boundary conditions to design for

### Human-editable notes

Obsidian notes can have bad YAML, renamed filenames, missing structured blocks, or prose-only rules. The compiler should identify required notes by frontmatter such as `brain_domain: no_go`, not only exact path, and fail with clear file/field errors when critical structure is missing.

### Staleness

`BRAIN.json` should include `compiled_at`, source paths, mtimes, and hashes. Loader must compare current source hashes/mtimes with compiled metadata.

- Generation/execution/preview/deploy: stale or invalid Brain fails closed.
- Read-only list/report: can use last-good Brain only with a loud warning.

### Last-good fallback

Successful compiles should update `BRAIN.last-good.json` and `BRAIN.last-good.md`. Broken compiles must never overwrite last-good.

### False positives

No-go matching should support `match_type` values such as `domain`, `exact`, `substring`, and `regex`. For domains, parse URL hostnames rather than arbitrary substring text. Do not block Brain notes themselves merely because they document a blocked term.

### False negatives

Normalize case, parse URLs, handle subdomains/aliases, and recursively inspect nested metadata. Direct task execution by ID must check Brain every time, not rely on prior filtered exports.

### Conflicts

Rules should have `rule_id`, `status`, `priority`, `supersedes`, and `effective_from`. Duplicate active `rule_id` values or conflicting active critical rules should fail validation or produce critical health warnings.

### Races

Use a Brain lock file and atomic writes when compiling. Never allow outbox sync to overwrite hand-authored Brain notes unless a note explicitly has `managed_by: client-agent`.

### Prompt size

Do not inject full vault content into chat prompts. Keep:

- `BRAIN.full.json`: full structured rules/history
- `BRAIN.json`: compact machine rules
- `BRAIN.md`: prompt summary, target 8â€“12 KB

### Credentials and sensitive data

{{OWNER_NAME}} explicitly allows credentials to be stored in Obsidian Brain when he chooses. Do **not** block Brain implementation or lecture/warn merely because a `credentials` Brain domain exists.

Implementation expectations:

- Support an intentional credentials note, e.g. `brain_domain: credentials` with `credential_storage: intentional`.
- Preserve credential notes in full/local Brain artifacts for operational use when intentionally authored.
- Keep prompt summaries, health checks, and routine reports from printing credential values; they may report that intentional credential storage is configured.
- Do not invent or scrape credentials. Only store values the user intentionally provides or directs to store.
- Treat credential handling as an access/reporting concern, not as a reason to fail the Brain compiler.

### Drift

Health check should compare Obsidian Brain, `config/no_go_keywords.json`, and the compact Hermes memory pointer where practical. If critical no-go rules disappear from Brain but still exist elsewhere, generation/execution should stop and report drift.

## Commands to add in implementation

```bash
node tools/compile_obsidian_brain.js --vault /opt/client-obsidian --json
node tools/check_obsidian_brain_health.js --brain-vault /opt/client-obsidian --json
node tools/reconcile_tasks_with_brain.js --db /opt/client-sqlite/seo-agent.db --brain-vault /opt/client-obsidian --json
node tools/read_obsidian_brain_summary.js --brain-vault /opt/client-obsidian --domain task_generation --markdown
```

## Test cases to require

- Invalid YAML fails clearly.
- Critical no-go prose without machine block fails validation.
- Touching a Brain source note after compile makes Brain stale.
- Broken compile preserves last-good Brain.
- `https://switch.monster/foo`, `Switch.Monster`, `www.switch.monster`, and nested metadata variants block.
- Historical/decision prose mentioning `switch.monster` does not block itself.
- Direct execution of a stale no-go task ID is refused.
- Concurrent compile uses lock and exits cleanly.
- Secret-like strings in Brain notes fail or warn according to severity.

## Reporting expectation

When discussing or implementing Brain work, show:

- risk classification
- commands run
- Brain health status
- whether current or last-good Brain was used
- any drift warnings
- exact files changed
- verification evidence
