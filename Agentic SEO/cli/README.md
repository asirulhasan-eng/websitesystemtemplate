# {{SITE_NAME}} v2 CLI Reference

> This is the complete reference for the v2 CLI tools. The AI agent reads this
> to understand what tools are available and how to use them.

## Quick Start

```bash
# Entry point
node v2/cli/bin/v2.js <command> [subcommand] [options]

# On server with symlink
v2 <command> [subcommand] [options]

# All commands output JSON by default
v2 gsc-fetch --days 7 --json

# Use --table for human-readable output
v2 task list --status candidate --table

# Use --help on any command
v2 gsc-fetch --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--json` | JSON output (default for most commands) |
| `--table` | Human-readable table output |
| `--csv` | CSV output |
| `--db <path>` | Override SQLite database path |
| `--quiet` | Suppress non-data output |
| `--help` | Show command help |
| `--sample` | Use built-in sample data (no API/DB needed) |

## Command Groups

### Data Fetching (Live API + Historical DB)

| Command | Description |
|---------|-------------|
| `v2 gsc-fetch` | Fetch GSC data from live API, persist to DB |
| `v2 gsc-history` | Query historical GSC snapshots from DB |
| `v2 gsc-compare` | Compare two GSC time periods (trend analysis) |
| `v2 serp-check` | Check live SERP positions via Serper/DataForSEO |
| `v2 serp-history` | Query historical SERP checks from DB |
| `v2 serp-compare` | Compare SERP positions over time |
| `v2 crawl` | Technical SEO audit of local site files |
| `v2 crawl-diff` | Compare two crawl runs (new/fixed issues) |
| `v2 sitemap-audit` | Validate XML sitemap URLs, status, canonical, and noindex cleanliness |
| `v2 index-inspect` | Inspect URL index status via GSC URL Inspection API, with live fallback |
| `v2 speed-audit` | Run Google PageSpeed Insights / Core Web Vitals checks |

### Site Content Analysis

| Command | Description |
|---------|-------------|
| `v2 page-read` | Read page content (raw HTML, text, sections, metadata) |
| `v2 page-meta` | Extract SEO metadata from one or many pages |
| `v2 site-pages` | Full site inventory with metadata summary |
| `v2 site-links` | Internal link structure analysis (orphans, link map) |
| `v2 semantic-match` | Score topical relevance between source and target pages |
| `v2 content blog-cannibalization` | Check existing blog overlap before suggesting a new supporting blog |
| `v2 link-check` | Find internal links to a target URL or broken local internal links |

### Task Management

| Command | Description |
|---------|-------------|
| `v2 task create` | Create task in SQLite (atomic transaction) |
| `v2 task list` | List/query/filter tasks with 15+ filters |
| `v2 task update` | Update task status/priority/notes (single or batch) |
| `v2 task search` | Full-text search across all task fields |
| `v2 task stats` | Task queue analytics (8 views) |
| `v2 task audit` | Audit lane routing, workflow buckets, duplicate groups, and queue preselection |
| `v2 task dedupe` | Dry-run or apply duplicate active-task cancellation |

### Keyword Intelligence

| Command | Description |
|---------|-------------|
| `v2 keyword track` | Add/update/remove tracked keywords |
| `v2 keyword list` | List tracked keywords with SERP/GSC enrichment |
| `v2 keyword trend` | Keyword position trend over time (sparkline) |

### Database

| Command | Description |
|---------|-------------|
| `v2 db query` | Run arbitrary SQL (SELECT by default, safety guards) |
| `v2 db snapshot` | Full system state summary (health check) |
| `v2 db tables` | List all tables with row counts and schema |

### Infrastructure

| Command | Description |
|---------|-------------|
| `v2 lock acquire` | Acquire resource lock (file, URL, keyword) |
| `v2 lock release` | Release lock by ID |
| `v2 lock list` | List active/stale locks |
| `v2 deploy branch` | Create git branch + commit changes |
| `v2 deploy push` | Push branch to remote |
| `v2 deploy status` | Check Cloudflare deployment status |
| `v2 deploy wait` | Wait for deployment to complete |
| `v2 manual-actions-check` | Normalize GSC Manual Actions report evidence or require UI verification |
| `v2 security-issues-check` | Normalize GSC Security Issues report evidence or require UI verification |
| `v2 email send` | Send email notification (plain or template) |
| `v2 email check` | Check inbox for replies/approvals |
| `v2 heartbeat` | Start/finish/beat heartbeat for job monitoring |
| `v2 monitor-check` | System health checks with auto-fix |
| `v2 backup create` | Create verified SQLite/artifact backups and backup table rows |
| `v2 backup push` | Dry-run or commit/push backup repositories |
| `v2 brain compile` | Compile Obsidian Agent Brain artifacts |
| `v2 brain summary` | Read compact Brain no-go/risk summaries |
| `v2 brain health` | Validate compiled Brain readiness |

### Reporting

| Command | Description |
|---------|-------------|
| `v2 report daily` | Generate and store daily report |
| `v2 report weekly` | Generate and store weekly report |
| `v2 report format` | Format arbitrary data into structured report |

## Common Workflows

### Daily Opportunity Scan
```bash
v2 heartbeat start --job daily-scan
v2 gsc-fetch --days 7 --min-impressions 5 --db /path/db --json    # Fetch fresh data
v2 gsc-compare --current-days 7 --previous-days 7 --only-changes --json  # Trends
# AI analyzes data and decides what's important
v2 serp-check --keywords "{{NICHE}} seo,seo for {{AUDIENCE}}" --json   # Check SERPs
# AI creates tasks based on analysis
v2 task create --title "..." --type content_refresh --priority 850 --json
v2 report daily --json                                              # Store report
v2 email send --to {{ADMIN_EMAIL}} --subject "Daily Report" --body "..."
v2 heartbeat finish --job daily-scan
```

### Investigate a Keyword
```bash
v2 gsc-history --keyword "{{NICHE}} seo" --days 90 --json       # Historical GSC data
v2 keyword-trend --keyword "{{NICHE}} seo" --days 90 --json     # Position trend
v2 serp-check --keywords "{{NICHE}} seo" --include-paa --json   # Current SERP
v2 page-meta --url /services/{{NICHE}}-seo --json                # Our page's state
v2 site-links --url /services/{{NICHE}}-seo --json               # Internal link support
```

### Check System Health
```bash
v2 db snapshot --json           # Full system state
v2 monitor-check --auto-fix --json  # Auto-release stale locks
v2 task stats --backlog --json  # Task queue health
v2 lock list --stale --json     # Stale locks
```

### Create and Track a Task
```bash
v2 task create --title "Optimize {{NICHE}} SEO service page" \
  --type content_optimization --priority 850 --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/{{NICHE}}-seo" \
  --target-keyword "{{NICHE}} seo" \
  --description "Position dropped from 5 to 8. Need to refresh content." \
  --evidence '{"position_change": -3}' --json

# Later: update with progress
v2 task update --id TSK-2026-06-03-ABC --status active \
  --note "Starting content refresh" --json

# Complete
v2 task update --id TSK-2026-06-03-ABC --status completed \
  --note "Refreshed content, pushed to preview branch" --json
```

## JSON Output Format

All commands wrap their output in a standard envelope:

```json
{
  "ok": true,
  "generated_at": "2026-06-03T05:00:00.000Z",
  "tool": "gsc-fetch",
  ...command-specific data...
}
```

On error:
```json
{
  "ok": false,
  "generated_at": "2026-06-03T05:00:00.000Z",
  "tool": "gsc-fetch",
  "error": "Error message here"
}
```

## Database Schema

The SQLite database contains 21 tables. Key ones:

| Table | Purpose |
|-------|---------|
| `tasks` | All SEO tasks (candidate â†’ active â†’ completed) |
| `events` | Immutable event log (every state change) |
| `gsc_snapshots` | Historical GSC data (query, position, clicks, etc.) |
| `serp_checks` | Historical SERP position checks |
| `keywords` | Tracked keywords with positions |
| `pages` | Site page inventory |
| `locks` | Active resource locks |
| `heartbeats` | Job monitoring heartbeats |
| `cron_runs` | Cron job execution history |
| `outbox_jobs` | Pending Obsidian sync / email jobs |
| `deployments` | Git branch / Cloudflare deployment records |
| `monitor_alerts` | System health alerts |
| `daily_reports` | Generated daily reports |
| `experiments` | A/B test records |
| `learning_rules` | AI learning from outcomes |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CLIENT_DB_PATH` or `SEO_AGENT_DB` | SQLite database path | `/opt/client-sqlite/seo-agent.db` |
| `CLIENT_SITE_ROOT` | Website repo root | `/opt/client-site` |
| `GSC_CLIENT_ID` | Google OAuth client ID | - |
| `GSC_CLIENT_SECRET` | Google OAuth client secret | - |
| `GSC_REFRESH_TOKEN` | Google OAuth refresh token | - |
| `SERPER_API_KEY` | Serper.dev API key | - |
| `DATAFORSEO_LOGIN` | DataForSEO login | - |
| `DATAFORSEO_PASSWORD` | DataForSEO password | - |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email sending | - |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS` | Email checking | - |
