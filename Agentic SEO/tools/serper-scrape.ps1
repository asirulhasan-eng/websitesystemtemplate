# =============================================================================
# serper-scrape.ps1 - Webpage Scraper via Serper.dev
# =============================================================================
# USAGE:
#   .\serper-scrape.ps1 -Url "https://example.com"
#   .\serper-scrape.ps1 -Url "https://example.com" -Mode markdown
#   .\serper-scrape.ps1 -Url "https://example.com" -Mode text
#   .\serper-scrape.ps1 -Url "https://example.com" -Save
#   .\serper-scrape.ps1 -Url "https://example.com" -Mode markdown -Save
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Url,

    # Mode: text | markdown | both | meta
    [ValidateSet("text","markdown","both","meta")]
    [string]$Mode = "both",

    # Save output to .\exports\scraped\
    [switch]$Save
)

# --- Config ------------------------------------------------------------------
# Load SERPER_API_KEY from .env file (agent root) or environment variable.
# Never hardcode API keys in scripts.
function Get-EnvValue([string]$Key) {
    $val = [System.Environment]::GetEnvironmentVariable($Key)
    if ($val) { return $val }
    $searchPaths = @(
        (Join-Path $PSScriptRoot ".env"),
        (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) ".env")
    )
    foreach ($envFile in $searchPaths) {
        if (Test-Path $envFile) {
            $line = Get-Content $envFile | Where-Object { $_ -match "^${Key}\s*=\s*(.+)$" } | Select-Object -First 1
            if ($line -match "^${Key}\s*=\s*(.+)$") { return $Matches[1].Trim().Trim('"').Trim("'") }
        }
    }
    return $null
}

$API_KEY = Get-EnvValue 'SERPER_API_KEY'
if (-not $API_KEY) {
    Write-Host "[ERROR] SERPER_API_KEY not found. Set it in your .env file or as an environment variable." -ForegroundColor Red
    exit 1
}

$ENDPOINT = "https://scrape.serper.dev"

$headers = @{
    "X-API-KEY"    = $API_KEY
    "Content-Type" = "application/json"
}

$body = @{
    url             = $Url
    includeMarkdown = $true
} | ConvertTo-Json

# --- Call API ----------------------------------------------------------------
Write-Host "`n[SCRAPE] Scraping: $Url" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $ENDPOINT -Method POST -Headers $headers -Body $body
} catch {
    Write-Host "[ERROR] API Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "   Credits used: $($response.credits)" -ForegroundColor DarkGray
Write-Host "   Page title  : $($response.metadata.title)" -ForegroundColor DarkGray

# --- Output ------------------------------------------------------------------
switch ($Mode) {
    "meta" {
        Write-Host "`n--- METADATA ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        $response.metadata.PSObject.Properties | ForEach-Object {
            Write-Host "  $($_.Name): $($_.Value)"
        }
    }
    "text" {
        Write-Host "`n--- PLAIN TEXT ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        Write-Host $response.text
    }
    "markdown" {
        Write-Host "`n--- MARKDOWN ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        Write-Host $response.markdown
    }
    "both" {
        Write-Host "`n--- PLAIN TEXT ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        Write-Host $response.text
        Write-Host "`n--- MARKDOWN ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        Write-Host $response.markdown
    }
}

# --- Save --------------------------------------------------------------------
if ($Save) {
    $exportDir = Join-Path $PSScriptRoot "exports\scraped"
    if (-not (Test-Path $exportDir)) { New-Item -ItemType Directory -Path $exportDir | Out-Null }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmm"
    $slug = ($Url -replace 'https?://', '' -replace '[^a-zA-Z0-9]', '_').TrimEnd('_')

    if ($Mode -in "markdown","both") {
        $mdPath = Join-Path $exportDir "${slug}_${timestamp}.md"
        $response.markdown | Out-File -FilePath $mdPath -Encoding utf8
        Write-Host "`n[OK] Markdown saved: $mdPath" -ForegroundColor Green
    }
    if ($Mode -in "text","both") {
        $txtPath = Join-Path $exportDir "${slug}_${timestamp}.txt"
        $response.text | Out-File -FilePath $txtPath -Encoding utf8
        Write-Host "[OK] Text saved    : $txtPath" -ForegroundColor Green
    }
}
