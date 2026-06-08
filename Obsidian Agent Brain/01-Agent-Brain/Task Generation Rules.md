---
title: Task Generation Rules
type: brain
brain_domain: task_generation
status: active
priority: high
source_of_truth: Obsidian Brain
---

# Task Generation Rules

- Prioritize **money keywords** (service-intent, pricing, local-for-{{AUDIENCE}}).
- Recall prior memory before creating tasks (`v2 brain recall --query "<keyword>"`)
  to avoid repeating recently-tried or known-bad approaches.
- Do not create a task that duplicates an open/in-progress one for the same
  keyword/page. Update the existing task instead.
- Single-day position swings of Â±2 are noise; react to 7-day-average shifts.
- Never generate work from no-go sources (see [[No-Go Sources]]).
- The **Self-Evaluation Auditor** may inject up to 5 corrective tasks per 6h window.
  These are tagged `source:auditor` and always cite the gap they fill (an evidence /
  report id) and a concrete target. The planner should not duplicate or cancel an
  auditor-injected task unless the underlying signal changed. See [[Operating Rules]].
