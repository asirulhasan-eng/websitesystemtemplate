---
title: Operating Rules
type: brain
brain_domain: operating_rules
status: active
priority: critical
source_of_truth: Obsidian Brain
---

# Operating Rules

- **SQLite is the operational source of truth** for task status, events, approvals,
  deployments, and locks. The Obsidian mirror is downstream; never repair SQLite
  from the vault.
- **The Brain is authoritative for long-lived human knowledge**: no-go rules,
  operating rules, risk lanes, preferences, strategy, and lessons. Read it before
  planning, generating, recommending, or executing work.
- **Record memory as you work.** Decisions per session, lessons when outcomes land,
  observations for notable signals. Use `v2 brain note add`.
- **Approval model is opt-out.** Safe / semi-safe / reversible high-risk work runs
  automatically in-window; irreversible/destructive work needs explicit Telegram go.
- **Social distribution is caption-unique.** After a blog is approved and live,
  write a UNIQUE caption per platform per infographic (never copy-paste FB↔IG or
  reuse across infographics) and enqueue with `v2 social post --spec`. The drip
  cron (`v2 social send`) does the posting; never bulk-post manually. See the
  `social-distribution` process.
- **The Self-Evaluation Auditor runs every 6 hours.** It reviews the last 6h window,
  grades system performance A-F, catches missed threats / duplicates / drift, injects
  up to 5 corrective tasks (tagged `source:auditor`, safe-risk ones auto-approved,
  semi/high left `candidate`), and records its findings in the Brain. It is the ONLY
  process that may cancel/override another process's tasks without owner intervention.
  It reports every run over **Telegram** (not email) â€” grade A/B is a one-liner, C or
  below is a full report, D/F is an escalation alert. See the `self-evaluation` process.
- Honor any owner `stop` / `change` / `pause` instruction over the default.
