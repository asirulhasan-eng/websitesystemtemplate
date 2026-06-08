# run-daily-workplan.ps1 â€” PowerShell equivalent for local testing
# Triggers Hermes to run the daily-workplan process playbook

$ErrorActionPreference = "Stop"

$AGENT_ROOT = (Get-Item .).FullName
$V2_CLI = "$AGENT_ROOT\cli\bin\v2.js"
$PROCESS_FILE = "$AGENT_ROOT\processes\daily-workplan.md"
$LOG_DIR = "$AGENT_ROOT\cron\logs"
$TIMESTAMP = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not (Test-Path -Path $LOG_DIR)) {
    New-Item -ItemType Directory -Path $LOG_DIR | Out-Null
}

Write-Host "========================================="
Write-Host "[$TIMESTAMP] Starting Daily Workplan"
Write-Host "========================================="

# 1. Record heartbeat start
node $V2_CLI heartbeat start --job daily-workplan --json 2>$null

# 2. Run health check first
$HEALTH = node $V2_CLI monitor-check --auto-fix --json 2>$null
if (-not $HEALTH) { $HEALTH = '{"ok":false,"error":"monitor-check failed"}' }
Write-Host "[health] $HEALTH"

# Check if health is critical
if ($HEALTH -match '"critical"') {
    Write-Host "[ABORT] Critical health issue detected. Sending alert email." -ForegroundColor Red
    node $V2_CLI email send `
        --to {{ADMIN_EMAIL}} `
        --subject "ðŸš¨ Daily Workplan Aborted â€” Critical System Issue" `
        --body "The daily workplan at $TIMESTAMP was aborted due to a critical system health issue. Health check output: $HEALTH" `
        --priority high --json 2>$null
    node $V2_CLI heartbeat finish --job daily-workplan --error "Aborted: critical health issue" --json 2>$null
    exit 1
}

# 3. Invoke Hermes with the daily workplan process
Write-Host "[hermes] Starting AI-driven daily workplan..."

$PROMPT = @"
You are running the daily workplan process for {{SITE_NAME}}.agency.

Read the process playbook at: $PROCESS_FILE
Read the guardrails at: $AGENT_ROOT\config\guardrails.json
Read the site config at: $AGENT_ROOT\config\site.json

Follow the playbook step by step. Use the v2 CLI tools (at $V2_CLI) for all data operations.
Make all SEO strategic decisions yourself based on the data you gather.

When finished:
1. Generate a daily report using: node $V2_CLI report daily --json
2. Send a summary email to {{ADMIN_EMAIL}} including:
   - System health status
   - Decisions made and rationale
   - Tasks created/updated
   - Ranking changes detected
   - Your plan for the next 12 hours
   - Any items that need human review

Use: node $V2_CLI email send --to {{ADMIN_EMAIL}} --subject `"ðŸ“Š {{SITE_NAME}} Daily Report â€” $(Get-Date -Format 'yyyy-MM-dd')`" --body `"<your summary>`" --json

3. Record heartbeat finish: node $V2_CLI heartbeat finish --job daily-workplan --json
"@

# Use hermes chat for AI execution if available
$hermesExists = Get-Command hermes -ErrorAction SilentlyContinue
if ($hermesExists) {
    $PROMPT | hermes chat --no-interactive | Tee-Object -FilePath "$LOG_DIR\daily-workplan-$(Get-Date -Format 'yyyy-MM-dd').log" -Append
} else {
    Write-Host "[ERROR] hermes command not found. Falling back to basic execution." -ForegroundColor Yellow
    Write-Host "[fallback] Fetching GSC data..."
    node $V2_CLI gsc-fetch --days 7 --min-impressions 5 --json > "$LOG_DIR\gsc-latest.json"
    Write-Host "[fallback] Running SERP check on tracked keywords..."
    node $V2_CLI serp-check --from-tracked --json > "$LOG_DIR\serp-latest.json"
    Write-Host "[fallback] Generating daily report..."
    node $V2_CLI report daily --json > "$LOG_DIR\report-$(Get-Date -Format 'yyyy-MM-dd').json"
    Write-Host "[fallback] Basic data gathering complete. AI analysis skipped."
    node $V2_CLI heartbeat finish --job daily-workplan --json 2>$null
}

Write-Host "[$TIMESTAMP] Daily Workplan Complete"
