---
title: Risk Lanes
type: brain
brain_domain: risk_lanes
status: active
priority: critical
source_of_truth: Obsidian Brain
---

# Risk Lanes

- **safe** — content/meta tweaks, internal links. Auto-applied and deployed.
- **semi_safe** — larger content/structure changes. Preview branch for review.
- **high_risk (reversible)** — broader edits; reversible. Auto-runs under opt-out.
- **needs_explicit_go (irreversible/destructive)** — page deletion, DNS/SSL/domain,
  robots disallow-all, sitemap restructure. Never auto-run; require Telegram approval.

See `config/guardrails.json` for the authoritative `require_explicit_approval` list.
