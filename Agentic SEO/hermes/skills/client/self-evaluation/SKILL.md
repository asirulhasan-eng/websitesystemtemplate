# Self-Evaluation Auditor Skill
#
# Triggered by: cron EVERY 6 HOURS â€” 05/11/17/23 UTC (0 5,11,17,23 * * *)
# Or manually with: hermes run self-evaluation
#
# This skill is the system's INNER CRITIC. It performs a RETROSPECTIVE self-audit of
# the last 6 hours: reconstruct what happened, detect gaps, grade A-F, inject up to 5
# corrective tasks, record brain notes, and NOTIFY THE OWNER OVER TELEGRAM (not email).
# It is a CRITIC WITH LIMITED HANDS â€” it does NOT re-plan the day (the planner does that).
# It is the ONLY process allowed to cancel/override another process's tasks.
# See processes/self-evaluation.md for the full 5-phase playbook.

## Steps

1. **Read the playbook**: `cat /opt/client-agent/processes/self-evaluation.md` â€” follow every phase in order.
2. **Load standing policy**: `node $V2 brain summary --markdown` â€” you grade actions AGAINST these rules.
3. **Phase 1 â€” reconstruct** the last 6h: tasks touched, heartbeats, intelligence reports, git deploys, worker logs, brain notes.
4. **Phase 2 â€” detect gaps**: missing process runs, brain-rule violations, ignored intelligence, duplicate/unjustified/low-value tasks, strategic drift. This is the core value.
5. **Phase 3 â€” grade** the window A-F on the five weighted dimensions (Process 20%, Brain 25%, TaskQuality 20%, Strategy 25%, Memory 10%).
6. **Phase 4 â€” inject fixes** (max 5, `source:auditor`, each citing the gap): approve ONLY safe-risk corrective tasks; leave semi/high as `candidate`; cancel clear duplicates.
7. **Phase 5 â€” record + notify**: always write a brain DECISION rollup, then push a **Telegram** report (grade-aware verbosity). Finish the heartbeat.

## Key CLI Commands
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

# Phase 1 â€” reconstruct (read-only). CUTOFF = ISO time 6h ago.
node $V2 task list --updated-after "$CUTOFF" --sort updated $DB --json
node $V2 heartbeat status $DB --json
node $V2 db query --sql "SELECT job_name, status, started_at, error_summary FROM cron_runs WHERE started_at >= ? ORDER BY started_at DESC" --params "[\"$CUTOFF\"]" $DB --json
node $V2 intelligence search --days 1 --include-failed $DB --json
tail -200 /opt/client-agent/cron/logs/ops-pipeline.log
tail -200 /opt/client-agent/cron/logs/blog-pipeline.log

# Phase 2 â€” gaps (compare per-job run counts vs expected cadence yourself)
node $V2 db query --sql "SELECT job_name, COUNT(*) AS runs, SUM(status='failed') AS failures FROM cron_runs WHERE started_at >= ? GROUP BY job_name" --params "[\"$CUTOFF\"]" $DB --json
node $V2 task list --created-after "$CUTOFF" $DB --json
node $V2 keyword list --intent-tier money $DB --json

# Phase 4 â€” corrective tasks (max 5; safe-only auto-approve). --evidence is JSON.
node $V2 task create --title "AUDITOR: ..." --type content_optimization --priority 900 \
  --risk-level safe --source auditor --tags "auditor" \
  --evidence "{\"audit\":\"audit-<stamp>\",\"report\":\"RPT-<id>\"}" $DB --json
node $V2 task update --id TSK-XXX --status approved $DB --json     # ONLY if risk-level=safe
node $V2 task update --id TSK-DUP --status cancelled --note "Auditor: duplicate of TSK-XXX" $DB --json

# Phase 5 â€” record + notify
node $V2 brain note add --type decision --title "Auditor: 6h review â€” Grade <X>" \
  --body "..." --tags "auditor,self-evaluation" --session "auditor-<stamp>" $DB --json
node $V2 notify telegram --markdown --text "ðŸŸ¢ *Auditor* â€” Grade *A* (4.7). No action needed." $DB --json
node $V2 notify telegram --body-file /tmp/audit.md $DB --json      # C or below: full report
node $V2 heartbeat finish --job auditor $DB --json
```

## Important Rules
- **Critic, not planner** â€” detect and inject corrective work; do NOT re-plan the day or call safe-fix/semi-safe/high-risk to apply work yourself.
- **Max 5 corrective tasks per window**, each tagged `source:auditor` and citing the gap it fills (evidence/report id) + a concrete target.
- **Approve only safe-risk corrective tasks.** semi_safe/high_risk stay `candidate` for the planner â€” the Auditor never auto-approves risky work.
- **Override power** â€” you alone may cancel another process's tasks (e.g. an un-deduped duplicate). Always record why.
- **Notify over Telegram, never email.** Grade A/B â†’ one line (ðŸŸ¢); C â†’ full report (ðŸŸ¡); D/F â†’ full report led with ðŸ”´ ALERT.
- **Always record the brain DECISION** even if Telegram is unconfigured â€” don't lose the audit.
- **Fewer, well-evidenced findings beat many weak ones** â€” a false positive that cancels good work is worse than a missed minor gap.
