---
title: No-Go Sources
type: brain
brain_domain: no_go
status: active
priority: critical
owner: {{OWNER_NAME}}
source_of_truth: Obsidian Brain
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
    reason: Fake-impression data confirmed by {{OWNER_NAME}}. Never create, recommend, prioritize, or execute work derived from it.
    override_allowed: false
    rule_id: no-go-switch-monster
---

# No-Go Sources

> [!danger] Hard no-go
> `switch.monster` is fake-impression data. Do not create, recommend, prioritize,
> or execute tasks derived from it unless {{OWNER_NAME}} explicitly overrides.

Add new no-go rules as machine-readable `blocked_terms` in the frontmatter above,
each with a unique `rule_id`. Prose alone is not enforced.
