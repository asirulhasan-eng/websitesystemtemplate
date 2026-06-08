# =============================================================================
# youtube-transcript.ps1 - YouTube Transcript -> plain text (no timestamps)
# =============================================================================
# Pulls captions via the RapidAPI "YouTube Captions / Transcript" endpoint,
# parses the JSON, keeps ONLY the spoken text (start/dur dropped), decodes HTML
# entities, and prints clean prose.
#
# USAGE:
#   .\youtube-transcript.ps1 -Video 1gI65iIxbXI
#   .\youtube-transcript.ps1 -Video "https://www.youtube.com/watch?v=1gI65iIxbXI"
#   .\youtube-transcript.ps1 -Video 1gI65iIxbXI -Language en
#   .\youtube-transcript.ps1 -Video 1gI65iIxbXI -Raw             (one line per caption)
#
# Only the transcript text goes to stdout (status msgs go to the host stream),
# so you can pipe it straight into an LLM:
#   .\youtube-transcript.ps1 -Video 1gI65iIxbXI | clip
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Video,                 # video ID or any YouTube URL

    [string]$Language = "en",

    # Raw  = one caption line per row (still no timestamps)
    # off  = reflowed into a single paragraph block (default)
    [switch]$Raw
)

# --- Config ------------------------------------------------------------------
$API_HOST = "youtube-captions-transcript-subtitles-video-combiner.p.rapidapi.com"

# Load RAPIDAPI_KEY from .env file (agent root) or environment variable.
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

$API_KEY = Get-EnvValue 'RAPIDAPI_KEY'
if (-not $API_KEY) {
    Write-Host "[ERROR] RAPIDAPI_KEY not found. Set it in your .env file or as an environment variable." -ForegroundColor Red
    exit 1
}

# --- Resolve video ID from raw ID or URL -------------------------------------
function Resolve-VideoId([string]$v) {
    $v = $v.Trim()
    # youtu.be/<id>  |  watch?v=<id>  |  /embed/<id>  |  /shorts/<id>
    if ($v -match '(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})') {
        return $Matches[1]
    }
    if ($v -match '^[A-Za-z0-9_-]{11}$') { return $v }
    return $v   # fall through; let the API reject it
}

$videoId = Resolve-VideoId $Video
$uri = "https://$API_HOST/download-json/$videoId`?language=$Language&response_mode=default"

$headers = @{
    "Content-Type"    = "application/json"
    "x-rapidapi-host" = $API_HOST
    "x-rapidapi-key"  = $API_KEY
}

# --- Call API ----------------------------------------------------------------
Write-Host "`n[FETCH] Transcript for video '$videoId' (lang=$Language)" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $uri -Method GET -Headers $headers
} catch {
    Write-Host "[ERROR] API Error: $_" -ForegroundColor Red
    exit 1
}

if (-not $response -or $response.Count -eq 0) {
    Write-Host "[WARN] No transcript returned (video may have captions disabled)." -ForegroundColor Yellow
    exit 1
}

# --- Extract text only (drop start/dur) + decode HTML entities ----------------
Add-Type -AssemblyName System.Web
$lines = foreach ($seg in $response) {
    if ($seg.text) { [System.Web.HttpUtility]::HtmlDecode($seg.text).Trim() }
}
$lines = $lines | Where-Object { $_ -ne "" }

if ($Raw) {
    $output = ($lines -join "`n")
} else {
    # Reflow into a single clean paragraph; collapse whitespace.
    $output = (($lines -join " ") -replace '\s+', ' ').Trim()
}

# --- Output (transcript -> stdout, status -> host stream) --------------------
Write-Host "[OK] $($lines.Count) captions parsed`n" -ForegroundColor Green
Write-Output $output
