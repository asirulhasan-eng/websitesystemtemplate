---
id: self-evaluation
name: "Self-Evaluation Auditor"
version: 1
description: "Every-6-hour retrospective self-audit. Reconstructs the last 6h of activity, cross-checks it against the Brain rules and strategy, grades the system A-F on five dimensions, injects up to 5 corrective tasks, records its findings as Brain notes, and notifies the owner over Telegram. It is the system's inner critic â€” the only process allowed to cancel/override another process's tasks without owner intervention."
trigger:
  schedule: "0 5,11,17,23 * * *"     # Every 6h â€” 05:00 / 11:00 / 17:00 / 23:00 UTC
  timezone: "{{TIMEZONE}}"
  can_run_manually: true
depends_on: []                        # Independent â€” runs even if other processes failed
guardrails:
  max_tasks_created: 5                # Corrective only â€” never a mass producer
  max_risk_level: safe                # The Auditor may APPROVE only safe corrective work
  max_duration_minutes: 15
  abort_on_error: false
notify_on_complete:
  enabled: true
  channel: telegram                   # NOT email â€” a Telegram message every 6h, not 4 emails/day
  to: "{{TELEGRAM_CHAT_ID}}"
  include_grade: true
  include_findings: true
  verbosity: grade_aware              # A/B â†’ one-line; C or below â†’ full structured report
outputs:
  - name: "Corrective tasks"
    type: tasks
    description: "Up to 5 evidence-backed corrective tasks (tagged source:auditor)"
  - name: "Brain notes"
    type: brain
    description: "Decision rollup of the audit + any observations/lessons"
  - name: "Telegram report"
    type: telegram
    description: "Grade + findings pushed to the owner (grade-aware verbosity)"
---

# Self-Evaluation Auditor

> A 6-hour retrospective agent that interrogates the system's own actions, catches
> what every other process missed, and feeds corrections directly into the Obsidian
> Brain and the task queue. The **planner looks forward**, the **feedback analyst
> looks at results** â€” neither performs a critical retrospective self-audit with the
> authority to inject corrective work. That is this process.

## Where this sits

```
Intelligence (2Ã—/day)  â†’ reports, no tasks
Daily Planner (2Ã—/day) â†’ reads reports, enqueues tasks   (sole producer)
Feedback Analyst (2h)  â†’ reviews worker results, writes a brief
THE AUDITOR (6h)       â†’ asks "did we do the right things? did anything slip?
                         are we drifting?" â€” grades + injects corrective tasks
```

The Auditor runs at odd hours (05/11/17/23 UTC) to avoid Hermes concurrency with the
intelligence (01:30/13:30) and workplan (02:00/14:00) windows.

## Authority & guardrails (resolved policy)

- **Corrective tasks:** at most **5 per 6h window**. Each MUST cite the gap it fills
  (an evidence id / report id) and a concrete target. Tag every one with
  `source:auditor`.
- **Approval limit:** the Auditor may set a corrective task to `approved` **only when
  its risk level is `safe`** (so a worker runs it within ~7 min). Anything `semi_safe`
  or `high_risk` is created as `candidate` and left for the next planner session to
  judge â€” the Auditor never auto-approves risky work.
- **Override power:** the Auditor is the **only** process permitted to `cancel`/override
  another process's tasks without owner intervention (e.g. an un-deduped duplicate).
  Always record why in the task note.
- **Notify, don't email:** every run ends with a **Telegram** message, never an email.
  Grade A/B â†’ a single celebratory line. Grade C or below â†’ the full structured report.
  Grade D/F is, additionally, an escalation (still Telegram, marked âš ï¸).

---

## Setup (run once at the top of the session)

```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"
WINDOW="6h"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CUTOFF=$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

node $V2 heartbeat start --job auditor $DB --json
# Load standing policy first â€” you grade against THESE rules.
node $V2 brain summary --markdown $DB
```

---

## Phase 1 â€” "What did we actually do?" (Activity Reconstruction)

Reconstruct a complete 6-hour timeline. Read-only.

```bash
node $V2 task list --updated-after "$CUTOFF" --sort updated $DB --json   # tasks touched
node $V2 heartbeat status $DB --json                                     # current job states
# Which process runs happened in the window (cron_runs is the run ledger):
node $V2 db query --sql "SELECT job_name, status, started_at, finished_at, error_summary FROM cron_runs WHERE started_at >= ? ORDER BY started_at DESC" --params "[\"$CUTOFF\"]" $DB --json
node $V2 intelligence search --days 1 --include-failed $DB --json        # reports generated (incl. failed)
cd /opt/client-site && git log --since="6 hours ago" --oneline           # what deployed
tail -200 /opt/client-agent/cron/logs/ops-pipeline.log                   # ops worker activity
tail -200 /opt/client-agent/cron/logs/blog-pipeline.log                  # blog worker activity
node $V2 brain recall --query "last 6 hours" --markdown $DB              # notes recorded
```

Build a structured timeline:

```
[HH:MM] intelligence morning ran â†’ 8 reports
[HH:MM] workplan morning ran â†’ created 3 tasks, approved 5
[HH:MM] ops-pipeline executed TSK-042 (internal links) â†’ completed
[HH:MM] blog-pipeline executed TSK-045 (new blog) â†’ completed, deployed
[HH:MM] feedback analyst ran â†’ brief written
```

## Phase 2 â€” "What did we miss?" (Gap Detection) â€” the core value

Cross-reference activity against what *should* have happened.

### 2a. Process health gaps
```bash
# Per-job run counts in the window â€” compare against the EXPECTED job set yourself.
node $V2 db query --sql "SELECT job_name, COUNT(*) AS runs, SUM(status='failed') AS failures, MAX(started_at) AS last_run FROM cron_runs WHERE started_at >= ? GROUP BY job_name ORDER BY last_run DESC" --params "[\"$CUTOFF\"]" $DB --json
```
Expected in a 6h window: `intelligence` + `workplan-*` (only if a 02:00/14:00 boundary fell
inside it), `feedback` (~3Ã—), `ops-pipeline` (~50Ã—), `blog-pipeline` (~19Ã—), `monitor`
(~24Ã—), `outbox` (~36Ã—). A job absent or far below its cadence is a gap. Then:
- Did intelligence run before the workplan (it should, ~30 min earlier)?
- Did the feedback analyst run (every 2h â†’ ~3Ã— in 6h)?
- Did the ops pipeline pick up approved tasks (every 7 min)?
- Did the outbox sync SQLiteâ†’Obsidian (every 10 min)?
- Any stale locks blocking execution?

### 2b. Brain rule compliance
For each action in the last 6h, check against the Brain summary you loaded:
- **No-Go Sources** â€” did any task use a forbidden data source?
- **Operating Rules** â€” was opt-out approval respected? Did any irreversible action skip the gate?
- **Task Generation Rules** â€” duplicates created? single-day Â±2 noise acted on?
- **Risk Lanes** â€” risk levels assigned correctly?
- **SEO Strategy** â€” money-keyword focus, or drifting to Bucket 4 noise?
- **User Preferences** â€” were owner `stop`/`change`/`pause` instructions honored?

### 2c. Intelligence coverage gaps
```bash
node $V2 intelligence latest --all $DB --json                      # last run per module â€” spot stale (>24h)
node $V2 intelligence search --days 1 --include-failed $DB --json  # any failed/empty module runs
```
- Did threat-detection run â€” did it catch the ranking drop?
- Did content-gap-quick run â€” were its recommendations actioned or ignored?
- Any module stale (>24h)? Did the planner plan from thin data?

### 2d. Task quality audit
```bash
node $V2 task list --created-after "$CUTOFF" $DB --json
node $V2 task list --status completed --updated-after "$CUTOFF" $DB --json
```
For each **created** task: has evidence (report id)? a concrete target (URL/keyword)?
an existing open task for the same keyword/page (duplicate)? a money keyword (or low-value Bucket 3/4)?
For each **completed** task: was the outcome verified (is the fix live)? did the worker write a Brain note (else the lesson is lost)?

### 2e. Strategic drift detection
```bash
node $V2 keyword list --intent-tier money $DB --json
node $V2 task list --status candidate,approved,in_progress $DB --json
```
- What % of active tasks target money keywords vs supporting vs noise?
- Are we burning cycles on Bucket 4 noise?
- Have we ignored a money-keyword opportunity for >3 sessions?
- Is the queue growing faster than completion (backlog drift)?
- Are we repeating a strategy a prior Brain Lesson said failed?

## Phase 3 â€” "How well did we perform?" (Scoring)

Score the window 1â€“5 on five dimensions (v1: numeric; recalibrate after a few real runs):

| Dimension | Weight | Evaluates |
|---|---|---|
| Process Reliability | 20% | Did all scheduled processes run on time? |
| Brain Compliance | 25% | Operating rules, no-go, risk lanes respected? |
| Task Quality | 20% | Evidence-backed, actionable, non-duplicate, right priority? |
| Strategic Alignment | 25% | Money-keyword focus, not drifting, following strategy? |
| Memory Discipline | 10% | Were decisions and lessons recorded? |

**Composite** = weighted average â†’ grade:
**A** 4.5â€“5.0 (optimal) Â· **B** 3.5â€“4.4 (minor gaps) Â· **C** 2.5â€“3.4 (issues â€” inject fixes) Â·
**D** 1.5â€“2.4 (significant â€” escalate) Â· **F** <1.5 (malfunction â€” alert immediately).

## Phase 4 â€” "What do we fix?" (Corrective Actions)

### 4a. Inject corrective tasks (max 5; safe-only auto-approve)
```bash
# Cancel a missed duplicate (override power)
node $V2 task update --id <dup-id> --status cancelled \
  --note "Auditor: duplicate of TSK-<orig>. Created in workplan without dedup check." $DB --json

# Inject a task for an ignored threat. SAFE â†’ may approve; SEMI/HIGH â†’ leave 'candidate'.
# --source tags it as auditor-injected; --evidence is a JSON object citing the gap.
node $V2 task create \
  --title "AUDITOR: Unaddressed threat â€” '<keyword>' dropped 5 positions" \
  --type content_optimization --priority 900 --risk-level safe \
  --target-keyword "<keyword>" --source auditor --tags "auditor" \
  --description "Threat-detection flagged this 6h ago but the planner created no task. Injecting now." \
  --evidence "{\"audit\":\"audit-${STAMP}\",\"report\":\"RPT-<threat-report-id>\",\"gap\":\"ignored_threat\"}" $DB --json
# If risk-level is safe, you MAY: node $V2 task update --id <new-id> --status approved $DB --json
# If semi_safe/high_risk, STOP at 'candidate' â€” the planner decides.
```

### 4b. Record Brain notes
```bash
node $V2 brain note add --type observation \
  --title "Auditor: Planner ignoring content-gap-quick recommendations" \
  --body "Last 3 sessions, content-gap-quick flagged wrong-page ranking for '<keyword>' but no task was created." \
  --tags "auditor,gap,pattern" $DB --json

node $V2 brain note add --type lesson \
  --title "Auditor: Ops pipeline ran a content task as a safe-fix (no effect)" \
  --body "TSK-<id> was a content_refresh typed as general_operational. Route content work to the blog lane." \
  --tags "auditor,lesson,routing" $DB --json
```

## Phase 5 â€” "Record + notify" (Audit Trail + Telegram)

### 5a. Always record the audit as a Brain decision
```bash
node $V2 brain note add --type decision \
  --title "Auditor: 6h review â€” Grade <X> (<score>)" \
  --body "Window: ${CUTOFF}â†’${NOW}. Score breakdown: <dims>. Findings: <n> gaps, <m> corrective tasks injected. Key issue: <summary>. No-action items: <list>." \
  --tags "auditor,self-evaluation" --session "auditor-${STAMP}" $DB --json
```

### 5b. Notify the owner over Telegram (grade-aware verbosity)

Build the message, then push it. **A/B = one line. C or below = full report.** Use a leading
emoji that encodes the grade so the owner triages at a glance (ðŸŸ¢ A/B, ðŸŸ¡ C, ðŸ”´ D/F).

```bash
# Grade A or B â€” a single reassuring line:
node $V2 notify telegram --markdown \
  --text "ðŸŸ¢ *Auditor ${NOW}* â€” Grade *A* (4.7). All processes ran, brain-compliant, money-focused. No action needed." $DB --json

# Grade C or below â€” the full structured report (write to a file, send the file):
cat > /tmp/audit-${STAMP}.md <<'EOF'
ðŸŸ¡ Auditor â€” Grade C (3.1)
Window: <cutoff> â†’ <now>

Scores: Process 4 Â· Brain 3 Â· TaskQ 2 Â· Strategy 3 Â· Memory 3

Top gaps:
1. content-gap-quick recs ignored 3 sessions (observation logged)
2. TSK-051 duplicate of TSK-047 â†’ cancelled
3. Threat on '<keyword>' had no task â†’ injected TSK-058 (safe, approved)

Corrective tasks injected: 2 (1 approved-safe, 1 candidate)
Watch next window: backlog drift (queue +9, completed 3)
EOF
node $V2 notify telegram --body-file /tmp/audit-${STAMP}.md $DB --json
```

> Grade **D/F** uses the same full-report path but lead with ðŸ”´ and the word **ALERT** so
> the owner treats it as an escalation. There is no separate email path â€” Telegram only.

### 5c. Heartbeat finish
```bash
node $V2 heartbeat finish --job auditor $DB --json
```

---

## Notes for the running agent

- You are a **critic with limited hands**: read everything, but only inject up to 5
  safe corrective tasks and (optionally) cancel clear duplicates. Do not re-plan the
  day â€” that is the planner's job.
- Prefer **fewer, well-evidenced findings** over a long list of weak ones. A false
  positive that cancels good work is worse than a missed minor gap.
- If a finding needs `semi_safe`/`high_risk` work, surface it as a `candidate` task +
  a Telegram line; let the planner own the risk decision.
- If `TELEGRAM_CHAT_ID`/`TELEGRAM_BOT_TOKEN` is unset, `v2 notify telegram` fails
  cleanly â€” log it and still record the Brain decision (5a) so the audit isn't lost.
