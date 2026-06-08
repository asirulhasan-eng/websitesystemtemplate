# Work Plan Skill
#
# Triggered by: cron TWICE daily â€” 8AM {{TIMEZONE_ABBR}} (0 2 * * * UTC) morning, 8PM {{TIMEZONE_ABBR}} (0 14 * * * UTC) evening
# Or manually with: hermes run daily-workplan
#
# This skill PLANS and ENQUEUES the next 12 hours, then emails an opt-out plan.
# It is the PRODUCER. It does NOT execute â€” the ops (*/7) and blog (*/19) worker
# crons are the sole executors. See processes/dual-pipeline-plan.md.
# It is a PLANNER, not a data gatherer: the intelligence pipeline
# (cron/run-intelligence.sh) runs ~30 min earlier and saves analysis reports.
# This skill READS those reports â€” it does NOT call gsc-fetch/serp-check/crawl.
# 1. Read the process playbook at /opt/client-agent/processes/daily-workplan.md
# 2. Follow every step in order
# 3. Read the intelligence summary + feedback brief (do NOT re-fetch raw data)
# 4. Make ALL strategic + routing decisions (there is no auto task picker)
# 5. ENQUEUE chosen tasks by setting status=approved â€” a worker runs each within
#    ~7 min (general) or ~19 min (blog). Do NOT call safe-fix/semi-safe/high-risk yourself.
# 6. Send the opt-out plan email (workplan template) at the start of each session

## Steps

1. **Read the playbook**: `cat /opt/client-agent/processes/daily-workplan.md`
2. **Read guardrails**: `cat /opt/client-agent/config/guardrails.json`
3. **Read the intelligence summary**: `node $V2 intelligence summary --session <morning|evening> --json`
   (pre-digested GSC trends, threats, SERP changes, queue health, content/competitor/etc.).
   Use `intelligence search`/`intelligence latest` for more history. **Do NOT call gsc-fetch / serp-check / crawl.**
4. **Read the feedback brief**: `cat /opt/client-agent/cron/feedback/latest.md` (what workers did + early outcomes).
5. **Follow the planner steps** â€” decide (threats first), dedupe vs the queue, then create/update tasks.
6. **ENQUEUE** each task you decide to run by setting it `approved` (`task update --id <id> --status approved`). The ops/blog workers pick it up and dispatch by risk. **Do NOT execute it yourself.**
7. **Render & send the plan email** (`report format --template workplan --format html` â†’ `email send --html-file`): planned actions by lane, items needing explicit go-ahead, ranking alerts. Cite source report ids. Everything listed (approved) auto-runs unless the owner stops/modifies via Telegram.

## Key CLI Commands
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

# Intelligence (READ pre-digested reports â€” this replaces raw GSC/SERP/site fetches)
node $V2 intelligence summary --session morning $DB --json   # aggregated, severity-sorted
node $V2 intelligence latest --all $DB --json                # latest report per module
node $V2 intelligence search --query "<keyword>" --days 30 $DB --json

# Feedback brief (worker outcomes)
cat /opt/client-agent/cron/feedback/latest.md

# NOTE: the cron wrapper already runs monitor-check + heartbeat. Do NOT call
# gsc-fetch / serp-check / crawl / site-pages here â€” the intelligence pipeline does that.

# Task management
node $V2 task list --status candidate,approved $DB --json
node $V2 task create --title "..." --priority 800 $DB --json
node $V2 task stats --backlog $DB --json

# Enqueue (you pick the task; the WORKER executes it â€” do NOT run the executors here)
node $V2 task update --id TSK-XXX --status approved $DB --json   # worker dispatches by risk within ~7/~19 min
node $V2 high-risk  --task TSK-XXX $DB --json                    # irreversible: Phase 1 â†’ waiting_for_approval, needs Telegram 'approve'

# Plan email
node $V2 report format --template workplan --format html --data '{...}' --json
node $V2 email send --subject "â˜€ï¸ {{SITE_NAME}} Work Plan â€” Morning" --html-file /tmp/workplan.html --json
node $V2 heartbeat finish --job workplan-morning $DB --json   # cron wrapper also manages this
```

## Important Rules
- **Never use old v1 tools** â€” they're archived
- **You are a planner, not a data gatherer** â€” read `intelligence summary`/`latest`/`search` + the feedback brief; do NOT call gsc-fetch/serp-check/crawl. If a module's report is stale/missing, note the blind spot or trigger the relevant standalone process â€” don't fetch here.
- **Every decision is yours** â€” the reports give conclusions; YOU analyze, decide, and route
- **You are the PRODUCER, not an executor** â€” enqueue with `status=approved`; the worker crons run it. Never call safe-fix/semi-safe/high-risk to apply work here (double-execution).
- **Approve only what you want done** â€” there is no second gate after `approved`. Hold a task by leaving it `candidate`.
- **Follow guardrails** â€” max 20 blogs published, 1 service page modified per day
- **Opt-out approval** â€” safe/semi/reversible-high-risk can be approved automatically; owner stops/modifies via Telegram
- **Irreversible/destructive only** â†’ `v2 high-risk --task <id>` (Phase 1 hold) and wait for Telegram `approve <id>`; never set these `approved` directly
- **Always send the plan email** at the start of each session
