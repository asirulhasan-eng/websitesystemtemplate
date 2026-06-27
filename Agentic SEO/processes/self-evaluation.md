---
id: self-evaluation
name: "Self-Evaluation Auditor"
version: 1
description: "Every-6-hour retrospective self-audit. Reconstructs the last 6h of activity, cross-checks it against the Brain rules and strategy, grades the system A-F on five dimensions, injects up to 5 corrective tasks, records its findings as Brain notes, and notifies the owner over Telegram. It is the system's inner critic - the only process allowed to cancel/override another process's tasks without owner intervention."
trigger:
  schedule: "0 5,11,17,23 * * *"     # Every 6h - 05:00 / 11:00 / 17:00 / 23:00 UTC
  timezone: "Asia/Dhaka"
  can_run_manually: true
depends_on: []                        # Independent - runs even if other processes failed
guardrails:
  max_tasks_created: 5                # Corrective only - never a mass producer
  max_risk_level: safe                # The Auditor may APPROVE only safe corrective work
  max_duration_minutes: 15
  abort_on_error: false
notify_on_complete:
  enabled: true
  channel: telegram                   # NOT email - a Telegram message every 6h, not 4 emails/day
  to: "$TELEGRAM_CHAT_ID"
  include_grade: true
  include_findings: true
  verbosity: grade_aware              # A/B -> one-line; C or below -> full structured report
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
> looks at results** Ã¢â‚¬â€ neither performs a critical retrospective self-audit with the
> authority to inject corrective work. That is this process.

## Where this sits

```
Intelligence (2Ãƒâ€”/day)  Ã¢â€ â€™ reports, no tasks
Daily Planner (2Ãƒâ€”/day) Ã¢â€ â€™ reads reports, enqueues tasks   (sole producer)
Feedback Analyst (2h)  Ã¢â€ â€™ reviews worker results, writes a brief
THE AUDITOR (6h)       Ã¢â€ â€™ asks "did we do the right things? did anything slip?
                         are we drifting?" Ã¢â‚¬â€ grades + injects corrective tasks
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
  judge Ã¢â‚¬â€ the Auditor never auto-approves risky work.
- **Override power:** the Auditor is the **only** process permitted to `cancel`/override
  another process's tasks without owner intervention (e.g. an un-deduped duplicate).
  Always record why in the task note.
- **Notify, don't email:** every run ends with a **Telegram** message, never an email.
  Grade A/B Ã¢â€ â€™ a single celebratory line. Grade C or below Ã¢â€ â€™ the full structured report.
  Grade D/F is, additionally, an escalation (still Telegram, marked Ã¢Å¡ Ã¯Â¸).

---

## Setup (run once at the top of the session)

```bash
V2="/opt/website-agent/cli/bin/v2.js"
export WEBSITE_AGENT_DB_PATH="/opt/website-state/website-agent.db"
DB=""
WINDOW="6h"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CUTOFF=$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
AUDITOR_HEARTBEAT_RUN_ID="${AUDITOR_HEARTBEAT_RUN_ID:-}"

# The cron wrapper (`cron/run-auditor.sh`) owns the single authoritative
# heartbeat/cron_runs lifecycle for this tick and may provide
# `AUDITOR_HEARTBEAT_RUN_ID`. Do not run `heartbeat start` here; duplicate starts
# create duplicate `cron_runs` ledger rows for one scheduled auditor tick.
# Load standing policy first Ã¢â‚¬â€ you grade against THESE rules.
node $V2 brain summary --markdown $DB
```

---

## Phase 1 Ã¢â‚¬â€ "What did we actually do?" (Activity Reconstruction)

Reconstruct a complete 6-hour timeline. Read-only.

```bash
node $V2 task list --updated-after "$CUTOFF" --sort updated $DB --json   # tasks touched
node $V2 heartbeat status $DB --json                                     # current job states
# Which process runs happened in the window (cron_runs is the run ledger):
node $V2 db query --sql "SELECT job_name, status, started_at, finished_at, error_summary FROM cron_runs WHERE started_at >= ? ORDER BY started_at DESC" --params "[\"$CUTOFF\"]" $DB --json
node $V2 intelligence search --days 1 --include-failed $DB --json        # reports generated (incl. failed)
cd /opt/website-site && git log --since="6 hours ago" --oneline           # what deployed
tail -200 /opt/website-agent/cron/logs/ops-pipeline.log                   # ops worker activity
tail -200 /opt/website-agent/cron/logs/blog-pipeline.log                  # blog worker activity
node $V2 brain recall --query "last 6 hours" --markdown $DB              # notes recorded
```

Build a structured timeline:

```
[HH:MM] intelligence morning ran Ã¢â€ â€™ 8 reports
[HH:MM] workplan morning ran Ã¢â€ â€™ created 3 tasks, approved 5
[HH:MM] ops-pipeline executed TSK-042 (internal links) Ã¢â€ â€™ completed
[HH:MM] blog-pipeline executed TSK-045 (new blog) Ã¢â€ â€™ completed, deployed
[HH:MM] feedback analyst ran Ã¢â€ â€™ brief written
```

## Phase 2 Ã¢â‚¬â€ "What did we miss?" (Gap Detection) Ã¢â‚¬â€ the core value

Cross-reference activity against what *should* have happened.

### 2a. Process health gaps
```bash
# Per-job run counts in the window Ã¢â‚¬â€ compare against the EXPECTED job set yourself.
node $V2 db query --sql "SELECT job_name, COUNT(*) AS runs, SUM(status='failed') AS failures, MAX(started_at) AS last_run FROM cron_runs WHERE started_at >= ? GROUP BY job_name ORDER BY last_run DESC" --params "[\"$CUTOFF\"]" $DB --json
```
Expected in a 6h window: `intelligence` + `workplan-*` (only if a 02:00/14:00 boundary fell
inside it), `feedback` (~3Ãƒâ€”), `ops-pipeline` (~50Ãƒâ€”), `blog-pipeline` (~19Ãƒâ€”), `monitor`
(~24Ãƒâ€”), `outbox` (~36Ãƒâ€”). A job absent or far below its cadence is a gap. Then:
- Did intelligence run before the workplan (it should, ~30 min earlier)?
- Did the feedback analyst run (every 2h Ã¢â€ â€™ ~3Ãƒâ€” in 6h)?
- Did the ops pipeline pick up approved tasks (every 7 min)?
- Did the outbox sync SQLiteÃ¢â€ â€™Obsidian (every 10 min)?
- Any stale locks blocking execution?

### 2b. Brain rule compliance
For each action in the last 6h, check against the Brain summary you loaded:
- **No-Go Sources** Ã¢â‚¬â€ did any task use a forbidden data source?
- **Operating Rules** Ã¢â‚¬â€ was opt-out approval respected? Did any irreversible action skip the gate?
- **Task Generation Rules** Ã¢â‚¬â€ duplicates created? single-day Ã‚Â±2 noise acted on?
- **Risk Lanes** Ã¢â‚¬â€ risk levels assigned correctly?
- **SEO Strategy** Ã¢â‚¬â€ money-keyword focus, or drifting to Bucket 4 noise?
- **User Preferences** Ã¢â‚¬â€ were owner `stop`/`change`/`pause` instructions honored?

### 2c. Intelligence coverage gaps
```bash
node $V2 intelligence latest --all $DB --json                      # last run per module Ã¢â‚¬â€ spot stale (>24h)
node $V2 intelligence search --days 1 --include-failed $DB --json  # any failed/empty module runs
```
- Did threat-detection run Ã¢â‚¬â€ did it catch the ranking drop?
- Did content-gap-quick run Ã¢â‚¬â€ were its recommendations actioned or ignored?
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

## Phase 3 Ã¢â‚¬â€ "How well did we perform?" (Scoring)

Score the window 1Ã¢â‚¬â€œ5 on five dimensions (v1: numeric; recalibrate after a few real runs):

| Dimension | Weight | Evaluates |
|---|---|---|
| Process Reliability | 20% | Did all scheduled processes run on time? |
| Brain Compliance | 25% | Operating rules, no-go, risk lanes respected? |
| Task Quality | 20% | Evidence-backed, actionable, non-duplicate, right priority? |
| Strategic Alignment | 25% | Money-keyword focus, not drifting, following strategy? |
| Memory Discipline | 10% | Were decisions and lessons recorded? |

**Composite** = weighted average Ã¢â€ â€™ grade:
**A** 4.5Ã¢â‚¬â€œ5.0 (optimal) Ã‚Â· **B** 3.5Ã¢â‚¬â€œ4.4 (minor gaps) Ã‚Â· **C** 2.5Ã¢â‚¬â€œ3.4 (issues Ã¢â‚¬â€ inject fixes) Ã‚Â·
**D** 1.5Ã¢â‚¬â€œ2.4 (significant Ã¢â‚¬â€ escalate) Ã‚Â· **F** <1.5 (malfunction Ã¢â‚¬â€ alert immediately).

## Phase 4 Ã¢â‚¬â€ "What do we fix?" (Corrective Actions)

### 4a. Promote systemic substrate gaps to self-improvement tasks

When the gap is in the agent's own substrate (CLI, routing, cron wrappers,
process docs, Hermes skills, prompts, monitor checks, or DB-state reconciliation),
create a `self_improvement` task or one of its narrower sub-types:

- `process_update`
- `prompt_update`
- `cron_repair`
- `executor_repair`
- `db_reconciliation`

Create and approve the repair task when either condition is true:

- the same substrate gap appears in 2 consecutive audits
- an approved recovery/corrective task has been unconsumed for 90+ minutes

Use structured evidence with an explicit, repo-relative `target_files` list before approval:

```json
{
  "audit": "audit-<STAMP>",
  "gap": "split_db_ledger | unconsumed_recovery | smtp_auth | ...",
  "recurrence": 2,
  "target_files": ["cron/run-outbox.sh", "processes/self-evaluation.md"],
  "acceptance": "monitor authoritative_db_path == ok for 2 consecutive checks",
  "meta_experiment": "metaexp-<STAMP>"
}
```

Self-improvement target-file discipline:
- Before approval or dispatch, the Auditor must declare exactly one canonical
  `target_files` list in the task evidence. Do not preserve competing
  upstream/stashed variants, merge-conflict markers, directory globs, or implicit
  "related" files.
- Treat that canonical `target_files` list as the authoritative edit contract for
  the repair. Every entry must be a repo-relative path under `cli/`, `cron/`,
  `processes/`, `hermes/skills/client/`, or `processes/brain-seed/`.
- Production/source edits are constrained to the exact declared `target_files`;
  tests may be changed only under `test/` and only to cover the declared repair.
- Do not create tasks targeting guardrail cage keys, no-go config, secrets,
  Website/**, DNS/domain/SSL/robots/sitemap, or executor deletion.
- If a repair needs more than 8 non-test files, split it into smaller
  self-improvement tasks before execution; the dispatcher will park/split
  oversized parent tasks rather than letting an Engineer session make a broad
  change.
- If a recovery task cannot make a file change, it must either complete via a
  verified CLI/DB reconciliation or park with a precise human-action note.

The Auditor decision note must include either `no promotable improvement` or the
created `self_improvement` task id. Self-improvement tasks count toward the 5-task cap.

### 4b. Inject corrective tasks (max 5; safe-only auto-approve)
```bash
# Cancel a missed duplicate (override power)
node $V2 task update --id <dup-id> --status cancelled \
  --note "Auditor: duplicate of TSK-<orig>. Created in workplan without dedup check." $DB --json

# Inject a task for an ignored threat. SAFE Ã¢â€ â€™ may approve; SEMI/HIGH Ã¢â€ â€™ leave 'candidate'.
# --source tags it as auditor-injected; --evidence is a JSON object citing the gap.
node $V2 task create \
  --title "AUDITOR: Unaddressed threat Ã¢â‚¬â€ '<keyword>' dropped 5 positions" \
  --type content_optimization --priority 900 --risk-level safe \
  --target-keyword "<keyword>" --source auditor --tags "auditor" \
  --description "Threat-detection flagged this 6h ago but the planner created no task. Injecting now." \
  --evidence "{\"audit\":\"audit-${STAMP}\",\"report\":\"RPT-<threat-report-id>\",\"gap\":\"ignored_threat\"}" $DB --json
# If risk-level is safe, you MAY: node $V2 task update --id <new-id> --status approved $DB --json
# If semi_safe/high_risk, STOP at 'candidate' Ã¢â‚¬â€ the planner decides.
```

### 4c. Record Brain notes
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

## Phase 5 Ã¢â‚¬â€ "Record + notify" (Audit Trail + Telegram)

### 5a. Always record the audit as a Brain decision
```bash
node $V2 brain note add --type decision \
  --title "Auditor: 6h review Ã¢â‚¬â€ Grade <X> (<score>)" \
  --body "Window: ${CUTOFF}Ã¢â€ â€™${NOW}. Score breakdown: <dims>. Findings: <n> gaps, <m> corrective tasks injected. Key issue: <summary>. No-action items: <list>." \
  --tags "auditor,self-evaluation" --session "auditor-${STAMP}" $DB --json
```

### 5b. Notify the owner over Telegram (grade-aware verbosity)

Build the message, then push it. **A/B = one line. C or below = full report.** Use a leading
emoji that encodes the grade so the owner triages at a glance (Ã°Å¸Å¸Â¢ A/B, Ã°Å¸Å¸Â¡ C, Ã°Å¸â€Â´ D/F).

```bash
# Grade A or B Ã¢â‚¬â€ a single reassuring line:
node $V2 notify telegram --markdown \
  --text "Ã°Å¸Å¸Â¢ *Auditor ${NOW}* Ã¢â‚¬â€ Grade *A* (4.7). All processes ran, brain-compliant, money-focused. No action needed." $DB --json

# Grade C or below Ã¢â‚¬â€ the full structured report (write to a file, send the file):
cat > /tmp/audit-${STAMP}.md <<'EOF'
Ã°Å¸Å¸Â¡ Auditor Ã¢â‚¬â€ Grade C (3.1)
Window: <cutoff> Ã¢â€ â€™ <now>

Scores: Process 4 Ã‚Â· Brain 3 Ã‚Â· TaskQ 2 Ã‚Â· Strategy 3 Ã‚Â· Memory 3

Top gaps:
1. content-gap-quick recs ignored 3 sessions (observation logged)
2. TSK-051 duplicate of TSK-047 Ã¢â€ â€™ cancelled
3. Threat on '<keyword>' had no task Ã¢â€ â€™ injected TSK-058 (safe, approved)

Corrective tasks injected: 2 (1 approved-safe, 1 candidate)
Watch next window: backlog drift (queue +9, completed 3)
EOF
node $V2 notify telegram --body-file /tmp/audit-${STAMP}.md $DB --json
```

> Grade **D/F** uses the same full-report path but lead with Ã°Å¸â€Â´ and the word **ALERT** so
> the owner treats it as an escalation. There is no separate email path Ã¢â‚¬â€ Telegram only.

### 5c. Heartbeat finish
```bash
if [ -n "${AUDITOR_HEARTBEAT_RUN_ID:-}" ]; then
  node $V2 heartbeat finish --job auditor --run-id "$AUDITOR_HEARTBEAT_RUN_ID" $DB --json
else
  node $V2 heartbeat finish --job auditor $DB --json
fi
```

---

## Notes for the running agent

- You are a **critic with limited hands**: read everything, but only inject up to 5
  safe corrective tasks and (optionally) cancel clear duplicates. Do not re-plan the
  day Ã¢â‚¬â€ that is the planner's job.
- Prefer **fewer, well-evidenced findings** over a long list of weak ones. A false
  positive that cancels good work is worse than a missed minor gap.
- If a finding needs `semi_safe`/`high_risk` work, surface it as a `candidate` task +
  a Telegram line; let the planner own the risk decision.
- If `TELEGRAM_CHAT_ID`/`TELEGRAM_BOT_TOKEN` is unset, `v2 notify telegram` fails
  cleanly Ã¢â‚¬â€ log it and still record the Brain decision (5a) so the audit isn't lost.
