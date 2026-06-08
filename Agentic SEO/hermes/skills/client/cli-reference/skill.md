# V2 CLI Quick Reference
#
# Use this reference when you need to find the right CLI command.
# Every command supports --json, --table, --csv output formats.

## Data Fetching (Live API)
```bash
V2="node /opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

# GSC data (live from Google)
$V2 gsc-fetch --days 7 --min-impressions 5 $DB --json
$V2 gsc-fetch --days 28 --query-contains "{{NICHE}}" --sort position $DB --json
$V2 gsc-fetch --days 7 --url-contains "/services/" $DB --json

# SERP data (live from Serper)
$V2 serp-check --keywords "{{NICHE}} seo,seo for {{AUDIENCE}}" --include-paa $DB --json
$V2 serp-check --from-tracked $DB --json     # Check all tracked keywords

# Technical audit (from local files)
$V2 crawl --site-root /opt/client-site --json
$V2 speed-audit --url https://{{DOMAIN}}/ --strategy mobile --json
```

## Historical Data (from DB)
```bash
# GSC history
$V2 gsc-history --keyword "{{NICHE}} seo" --days 90 $DB --json
$V2 gsc-history --improving --days 14 $DB --json
$V2 gsc-history --declining --days 14 $DB --json

# GSC comparison (week-over-week or month-over-month)
$V2 gsc-compare --current-days 7 --previous-days 7 $DB --json
$V2 gsc-compare --current-days 28 --previous-days 28 --only-changes $DB --json

# SERP history
$V2 serp-history --keyword "{{NICHE}} seo" --days 60 --trend $DB --json
$V2 serp-compare --all-tracked --days-ago 14 $DB --json

# Keyword trends (combined GSC + SERP)
$V2 keyword-trend --keyword "{{NICHE}} seo" --days 90 $DB --json
```

## Site Content Analysis
```bash
# Page analysis
$V2 page-meta --url /services/{{NICHE}}-seo --site-root /opt/client-site --json
$V2 page-read --url /services/{{NICHE}}-seo --keyword-density "{{NICHE}} seo" --site-root /opt/client-site --json
$V2 page-meta --batch "services/*.html" --seo-only --site-root /opt/client-site --json

# Site inventory
$V2 site-pages --site-root /opt/client-site --json
$V2 site-pages --missing-meta --site-root /opt/client-site --json

# Link structure
$V2 site-links --orphans --site-root /opt/client-site --json
$V2 site-links --url /services/{{NICHE}}-seo --site-root /opt/client-site --json
$V2 site-links --most-linked --limit 10 --site-root /opt/client-site --json
```

## Task Management
```bash
# Create
$V2 task create --title "Optimize {{NICHE}} SEO page" --type content_optimization \
  --priority 850 --risk-level semi_safe --target-keyword "{{NICHE}} seo" \
  --description "Position dropped, refresh needed" $DB --json

# List / filter
$V2 task list --status candidate,approved --sort priority $DB --json
$V2 task list --status waiting_for_approval $DB --json   # Irreversible items awaiting Telegram 'approve'
$V2 task list --stale-days 7 $DB --json             # Stuck tasks
$V2 task list --keyword "{{NICHE}}" $DB --json

# Update
$V2 task update --id TSK-XXX --status in_progress --note "Starting work" $DB --json
$V2 task update --id TSK-XXX --status completed --note "Done" $DB --json

# Search and stats
$V2 task search --query "{{NICHE}} seo" $DB --json
$V2 task stats --backlog $DB --json
$V2 task stats --all $DB --json
$V2 task audit --queue general $DB --json
$V2 task dedupe $DB --json                 # Dry-run duplicate cleanup

# Pipeline picker (used by the */7 ops & */19 blog worker crons)
$V2 task next --lane general_operational $DB --json   # Next ready (approved) ops task
$V2 task next --lane blog_content $DB --json          # Next ready (approved) blog task
# NOTE (producer): you ENQUEUE work by setting status=approved; the worker crons execute it.
#   Do NOT call safe-fix/semi-safe/high-risk yourself in the work plan â€” that double-executes.
```

## System Health & Infrastructure
```bash
# Health
$V2 db snapshot $DB --json                    # Full system state
$V2 monitor-check --auto-fix $DB --json       # Fix stale locks, retry outbox
$V2 backup create $DB --json                  # Verified state/artifact backup
$V2 brain health --json                       # Compiled Brain readiness
$V2 brain summary --markdown                   # Standing policy â€” recall before deciding
$V2 brain recall --query "seo for {{AUDIENCE}}" --markdown   # Recall prior decisions/lessons/observations
$V2 brain note add --type decision --title "..." --body "..." $DB --json  # Record memory (decision|lesson|observation)

# Locks
$V2 lock acquire --type file_lock --resource "services/{{NICHE}}-seo.html" $DB --json
$V2 lock release --id LCK-XXX $DB --json
$V2 lock list --stale $DB --json

# Deploy
$V2 deploy branch --site-root /opt/client-site --branch preview/my-change --message "..." --json
$V2 deploy push --site-root /opt/client-site --json

# Email
$V2 email send --subject "Daily Report" --body "..." --json
$V2 email check --unread-only --json

# Heartbeat
$V2 heartbeat start --job my-job $DB --json
$V2 heartbeat finish --job my-job $DB --json
$V2 heartbeat status $DB --json

# Reports
$V2 report daily $DB --json
$V2 report weekly $DB --json
```
