<#
.SYNOPSIS
  Check configuration files for completeness and validity.

.DESCRIPTION
  Validates critical configuration files:
    - site.config.json exists and parses with required fields
    - .env.example exists in Agentic SEO/
    - config/site.json exists and parses
    - config/guardrails.json exists and parses

.PARAMETER SitePath
  Root path of the provisioned site to scan.

.EXAMPLE
  pwsh ./validation/checks/config-check.ps1 -SitePath ./sites/acme-plumbing
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'

Write-Host "  --- Config Check ---" -ForegroundColor Magenta

$issues  = @()
$checks  = 0
$passed  = 0

# ============================================================
# 1. site.config.json
# ============================================================
$checks++
$configPath = Join-Path $SitePath 'site.config.json'
if (Test-Path $configPath) {
    $parseOk = $true
    try {
        $cfg = Get-Content -Raw -Path $configPath -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        $parseOk = $false
        $issues += @{ File = 'site.config.json'; Message = ('Invalid JSON: ' + $_.Exception.Message) }
        Write-Host "    [FAIL] site.config.json -- invalid JSON" -ForegroundColor Red
    }

    if ($parseOk) {
        $passed++
        Write-Host "    [PASS] site.config.json -- valid JSON" -ForegroundColor Green

        # Check required top-level fields
        $requiredFields = @(
            'slug', 'domain', 'site_name', 'site_description', 'owner_name',
            'business', 'paths', 'git', 'email', 'apis', 'cloudflare',
            'timezone', 'timezone_abbr'
        )
        foreach ($field in $requiredFields) {
            $checks++
            $val = $null
            if ($cfg.PSObject.Properties.Name -contains $field) {
                $val = $cfg.$field
            }
            if ($null -ne $val -and "$val" -ne '') {
                $passed++
            } else {
                $issues += @{ File = 'site.config.json'; Field = $field; Message = "Required field missing: $field" }
                Write-Host ("    [WARN] site.config.json -- missing field: " + $field) -ForegroundColor Yellow
            }
        }

        # Check nested business fields
        $businessFields = @('type', 'niche', 'audience', 'brand_voice')
        if ($cfg.business) {
            foreach ($bf in $businessFields) {
                $checks++
                if ($cfg.business.PSObject.Properties.Name -contains $bf -and
                    -not [string]::IsNullOrWhiteSpace($cfg.business.$bf)) {
                    $passed++
                } else {
                    $issues += @{ File = 'site.config.json'; Field = "business.$bf"; Message = "Missing business.$bf" }
                    Write-Host ("    [WARN] site.config.json -- missing: business." + $bf) -ForegroundColor Yellow
                }
            }
        }
    }
} else {
    $issues += @{ File = 'site.config.json'; Message = 'File not found' }
    Write-Host "    [FAIL] site.config.json -- not found" -ForegroundColor Red
}

# ============================================================
# 2. .env.example
# ============================================================
$checks++
$agenticDir = Join-Path $SitePath 'Agentic SEO'
$envExamplePath = Join-Path $agenticDir '.env.example'
if (Test-Path $envExamplePath) {
    $passed++
    Write-Host "    [PASS] .env.example -- found" -ForegroundColor Green
} else {
    $issues += @{ File = '.env.example'; Message = 'Not found in Agentic SEO/' }
    Write-Host "    [WARN] .env.example -- not found" -ForegroundColor Yellow
}

# ============================================================
# 3. config/site.json
# ============================================================
$checks++
$siteJsonPath = Join-Path $agenticDir 'config/site.json'
if (Test-Path $siteJsonPath) {
    $siteParseOk = $true
    try {
        $null = Get-Content -Raw -Path $siteJsonPath -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        $siteParseOk = $false
        $issues += @{ File = 'config/site.json'; Message = ('Invalid JSON: ' + $_.Exception.Message) }
        Write-Host "    [FAIL] config/site.json -- invalid JSON" -ForegroundColor Red
    }
    if ($siteParseOk) {
        $passed++
        Write-Host "    [PASS] config/site.json -- valid JSON" -ForegroundColor Green
    }
} else {
    $issues += @{ File = 'config/site.json'; Message = 'Not found' }
    Write-Host "    [WARN] config/site.json -- not found" -ForegroundColor Yellow
}

# ============================================================
# 4. config/guardrails.json
# ============================================================
$checks++
$guardrailsPath = Join-Path $agenticDir 'config/guardrails.json'
if (Test-Path $guardrailsPath) {
    $grParseOk = $true
    try {
        $null = Get-Content -Raw -Path $guardrailsPath -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        $grParseOk = $false
        $issues += @{ File = 'config/guardrails.json'; Message = ('Invalid JSON: ' + $_.Exception.Message) }
        Write-Host "    [FAIL] config/guardrails.json -- invalid JSON" -ForegroundColor Red
    }
    if ($grParseOk) {
        $passed++
        Write-Host "    [PASS] config/guardrails.json -- valid JSON" -ForegroundColor Green
    }
} else {
    $issues += @{ File = 'config/guardrails.json'; Message = 'Not found' }
    Write-Host "    [WARN] config/guardrails.json -- not found" -ForegroundColor Yellow
}

# ============================================================
# SUMMARY
# ============================================================
$hasCritical = ($issues | Where-Object { $_.File -eq 'site.config.json' -and $_.Message -match 'not found|Invalid JSON' }).Count -gt 0
$status = if ($hasCritical) { 'FAIL' } elseif ($issues.Count -gt 0) { 'WARN' } else { 'PASS' }
$tag    = if ($status -eq 'PASS') { 'PASS' } elseif ($status -eq 'WARN') { 'WARN' } else { 'FAIL' }

Write-Host ""
Write-Host ("    [$tag] Config check: $passed/$checks passed, " + $issues.Count + " issue(s)") -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'WARN') { 'Yellow' } else { 'Red' })

return @{
    Check       = 'config-check'
    Status      = $status
    Severity    = if ($status -eq 'FAIL') { 'CRITICAL' } else { 'WARN' }
    Issues      = $issues
    TotalChecks = $checks
    Passed      = $passed
}
