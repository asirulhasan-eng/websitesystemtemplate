# =============================================================================
# serper-batch.ps1 - Batch SERP research across multiple keywords
# =============================================================================
# USAGE:
#   .\serper-batch.ps1 -Keywords "{{AUDIENCE}} seo","{{NICHE}} marketing","{{AUDIENCE}} ads"
#   .\serper-batch.ps1 -KeywordFile .\keywords.txt
#   .\serper-batch.ps1 -KeywordFile .\keywords.txt -Country "us" -Num 20
# =============================================================================

param(
    [string[]]$Keywords,
    [string]$KeywordFile,

    [string]$Country   = "us",
    [string]$Language  = "en",
    [int]$Num          = 10,

    # Delay between requests in ms (avoid rate limits)
    [int]$DelayMs      = 600
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

$ENDPOINT = "https://google.serper.dev/search"

$headers = @{
    "X-API-KEY"    = $API_KEY
    "Content-Type" = "application/json"
}

# --- Load keywords -----------------------------------------------------------
if ($KeywordFile) {
    if (-not (Test-Path $KeywordFile)) {
        Write-Host "[ERROR] Keyword file not found: $KeywordFile" -ForegroundColor Red
        exit 1
    }
    $Keywords = Get-Content $KeywordFile | Where-Object { $_.Trim() -ne "" }
}

if (-not $Keywords -or $Keywords.Count -eq 0) {
    Write-Host "[ERROR] No keywords provided. Use -Keywords or -KeywordFile." -ForegroundColor Red
    exit 1
}

Write-Host "`n[BATCH] Starting batch SERP research - $($Keywords.Count) keywords" -ForegroundColor Cyan
Write-Host "   Country: $Country | Results: $Num | Delay: ${DelayMs}ms`n"

# --- Collect results ---------------------------------------------------------
$allOrganic    = [System.Collections.Generic.List[object]]::new()
$allPAA        = [System.Collections.Generic.List[object]]::new()
$allRelated    = [System.Collections.Generic.List[object]]::new()
$i = 0

foreach ($kw in $Keywords) {
    $i++
    Write-Host "[$i/$($Keywords.Count)] $kw ..." -NoNewline

    $body = @{
        q           = $kw
        gl          = $Country
        hl          = $Language
        num         = $Num
        autocorrect = $true
    } | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod -Uri $ENDPOINT -Method POST -Headers $headers -Body $body

        foreach ($r in $resp.organic) {
            $allOrganic.Add([PSCustomObject]@{
                Keyword  = $kw
                Position = $r.position
                Title    = $r.title
                URL      = $r.link
                Snippet  = $r.snippet
                Date     = (Get-Date -Format "yyyy-MM-dd")
                Country  = $Country
            })
        }

        foreach ($q in $resp.peopleAlsoAsk) {
            $allPAA.Add([PSCustomObject]@{
                Keyword  = $kw
                Question = $q.question
                URL      = $q.link
            })
        }

        foreach ($s in $resp.relatedSearches) {
            $allRelated.Add([PSCustomObject]@{
                Keyword        = $kw
                RelatedSearch  = $s.query
            })
        }

        Write-Host " [OK] ($($resp.organic.Count) results)" -ForegroundColor Green
    } catch {
        Write-Host " [FAIL] Error: $_" -ForegroundColor Red
    }

    if ($i -lt $Keywords.Count) { Start-Sleep -Milliseconds $DelayMs }
}

# --- Export ------------------------------------------------------------------
$exportDir = Join-Path $PSScriptRoot "exports"
if (-not (Test-Path $exportDir)) { New-Item -ItemType Directory -Path $exportDir | Out-Null }

$timestamp = Get-Date -Format "yyyyMMdd-HHmm"

$organicPath = Join-Path $exportDir "batch_organic_$timestamp.csv"
$paaPath     = Join-Path $exportDir "batch_paa_$timestamp.csv"
$relatedPath = Join-Path $exportDir "batch_related_$timestamp.csv"

$allOrganic | Export-Csv -Path $organicPath -NoTypeInformation
$allPAA     | Export-Csv -Path $paaPath     -NoTypeInformation
$allRelated | Export-Csv -Path $relatedPath -NoTypeInformation

Write-Host "`n[OK] Export complete:"
Write-Host "   Organic  : $organicPath ($($allOrganic.Count) rows)"
Write-Host "   PAA      : $paaPath ($($allPAA.Count) rows)"
Write-Host "   Related  : $relatedPath ($($allRelated.Count) rows)"
