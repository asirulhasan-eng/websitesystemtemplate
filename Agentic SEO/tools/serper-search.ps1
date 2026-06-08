# =============================================================================
# serper-search.ps1 - Google SERP Search via Serper.dev
# =============================================================================
# USAGE:
#   .\serper-search.ps1 -Query "{{AUDIENCE}} seo"
#   .\serper-search.ps1 -Query "{{AUDIENCE}} near me" -Country "us" -Num 20
#   .\serper-search.ps1 -Query "{{NICHE}} services" -Export
#   .\serper-search.ps1 -Query "{{NICHE}}" -Mode paa          (People Also Ask)
#   .\serper-search.ps1 -Query "{{NICHE}}" -Mode related      (Related Searches)
#   .\serper-search.ps1 -Query "{{NICHE}}" -Mode all          (Everything)
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Query,

    [string]$Country   = "us",
    [string]$Language  = "en",
    [int]$Num          = 10,
    [int]$Page         = 1,

    # Mode: organic | paa | related | kg | all
    [ValidateSet("organic","paa","related","kg","all")]
    [string]$Mode = "organic",

    # Export results to CSV in .\exports\
    [switch]$Export
)

# --- Config ------------------------------------------------------------------
# Load SERPER_API_KEY from .env file (agent root) or environment variable.
# Never hardcode API keys in scripts.
function Get-EnvValue([string]$Key) {
    # Check process environment first
    $val = [System.Environment]::GetEnvironmentVariable($Key)
    if ($val) { return $val }
    # Search for .env in script dir, then two levels up (agent root convention)
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

$ENDPOINT = "https://google.serper.dev/search"

$headers = @{
    "X-API-KEY"    = $API_KEY
    "Content-Type" = "application/json"
}

$body = @{
    q            = $Query
    gl           = $Country
    hl           = $Language
    num          = $Num
    page         = $Page
    autocorrect  = $true
} | ConvertTo-Json

# --- Call API ----------------------------------------------------------------
Write-Host "`n[SEARCH] Searching: '$Query' (country=$Country, num=$Num, page=$Page)" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $ENDPOINT -Method POST -Headers $headers -Body $body
} catch {
    Write-Host "[ERROR] API Error: $_" -ForegroundColor Red
    exit 1
}

# --- Output ------------------------------------------------------------------
function Show-Organic {
    Write-Host "`n--- ORGANIC RESULTS ---" -ForegroundColor Yellow
    Write-Host ("-" * 70)
    foreach ($r in $response.organic) {
        Write-Host "#$($r.position)  $($r.title)" -ForegroundColor White
        Write-Host "    URL: $($r.link)" -ForegroundColor DarkCyan
        if ($r.snippet) { Write-Host "    $($r.snippet)" -ForegroundColor Gray }
        Write-Host ""
    }
}

function Show-KnowledgeGraph {
    if ($response.knowledgeGraph) {
        $kg = $response.knowledgeGraph
        Write-Host "`n--- KNOWLEDGE GRAPH ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        Write-Host "  Title   : $($kg.title)"
        Write-Host "  Type    : $($kg.type)"
        Write-Host "  Website : $($kg.website)"
        Write-Host "  Desc    : $($kg.description)"
        if ($kg.attributes) {
            Write-Host "  Attributes:"
            $kg.attributes.PSObject.Properties | ForEach-Object {
                Write-Host "    $($_.Name): $($_.Value)"
            }
        }
    }
}

function Show-PAA {
    if ($response.peopleAlsoAsk) {
        Write-Host "`n--- PEOPLE ALSO ASK ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        foreach ($q in $response.peopleAlsoAsk) {
            Write-Host "  Q: $($q.question)" -ForegroundColor White
            if ($q.snippet) { Write-Host "     $($q.snippet)" -ForegroundColor Gray }
            Write-Host "     URL: $($q.link)" -ForegroundColor DarkCyan
            Write-Host ""
        }
    }
}

function Show-Related {
    if ($response.relatedSearches) {
        Write-Host "`n--- RELATED SEARCHES ---" -ForegroundColor Yellow
        Write-Host ("-" * 70)
        $response.relatedSearches | ForEach-Object { Write-Host "  - $($_.query)" }
    }
}

switch ($Mode) {
    "organic" { Show-Organic }
    "kg"      { Show-KnowledgeGraph }
    "paa"     { Show-PAA }
    "related" { Show-Related }
    "all"     {
        Show-KnowledgeGraph
        Show-Organic
        Show-PAA
        Show-Related
    }
}

# --- Export ------------------------------------------------------------------
if ($Export) {
    $exportDir = Join-Path $PSScriptRoot "exports"
    if (-not (Test-Path $exportDir)) { New-Item -ItemType Directory -Path $exportDir | Out-Null }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmm"
    $slug = $Query -replace '[^a-zA-Z0-9]', '_'
    $csvPath = Join-Path $exportDir "serp_${slug}_${timestamp}.csv"

    $rows = foreach ($r in $response.organic) {
        [PSCustomObject]@{
            Position = $r.position
            Title    = $r.title
            URL      = $r.link
            Snippet  = $r.snippet
            Query    = $Query
            Country  = $Country
            Date     = (Get-Date -Format "yyyy-MM-dd")
        }
    }
    $rows | Export-Csv -Path $csvPath -NoTypeInformation
    Write-Host "`n[OK] Exported to: $csvPath" -ForegroundColor Green
}
