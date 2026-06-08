<#
.SYNOPSIS
  Master validation runner for a provisioned Website Autopilot site.

.DESCRIPTION
  Executes all validation checks against a provisioned site and produces
  a formatted report:

  1. Token Residue Check (CRITICAL) - no {{TOKENS}} left in any file
  2. Config Check (CRITICAL/WARN)   - all config files present and valid
  3. SEO Check (WARN)               - HTML files have proper SEO elements
  4. Brain Check (WARN)             - Obsidian vault has expected structure
  5. Link Check (WARN)              - no broken internal links

  Returns exit code 0 if all CRITICAL checks pass, 1 otherwise.
  WARN checks are reported but do not fail the overall validation.

.PARAMETER SitePath
  Root path of the provisioned site to validate. Required.

.PARAMETER SkipChecks
  Array of check names to skip. Example: -SkipChecks @('link-check', 'brain-check')

.PARAMETER OutputReport
  Optional path to write a JSON report file.

.EXAMPLE
  pwsh ./validation/validate-site.ps1 -SitePath ./sites/acme-plumbing
  pwsh ./validation/validate-site.ps1 -SitePath ./sites/acme-plumbing -OutputReport ./report.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath,

    [string[]]$SkipChecks = @(),

    [string]$OutputReport
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$scriptDir = $PSScriptRoot
$checksDir = Join-Path $scriptDir 'checks'

$startTime = Get-Date

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "           Website Autopilot - Site Validator                " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Site Path: $SitePath" -ForegroundColor White

if (-not (Test-Path $SitePath)) {
    Write-Host "  [X] Site path not found: $SitePath" -ForegroundColor Red
    Write-Host ""
    return @{
        SitePath     = $SitePath
        Status       = 'FAIL'
        CriticalFail = $true
        TotalChecks  = 0
        Passed       = 0
        Failed       = 1
        Warnings     = 0
        Results      = @()
    }
}

Write-Host ""

# ============================================================
# DEFINE CHECKS (order matters -- critical first)
# ============================================================
$checkDefinitions = @(
    @{
        Name     = 'token-check'
        Label    = 'Token Residue'
        Script   = 'token-check.ps1'
        Severity = 'CRITICAL'
    },
    @{
        Name     = 'config-check'
        Label    = 'Configuration Files'
        Script   = 'config-check.ps1'
        Severity = 'CRITICAL'
    },
    @{
        Name     = 'seo-check'
        Label    = 'SEO Fundamentals'
        Script   = 'seo-check.ps1'
        Severity = 'WARN'
    },
    @{
        Name     = 'brain-check'
        Label    = 'Obsidian Agent Brain'
        Script   = 'brain-check.ps1'
        Severity = 'WARN'
    },
    @{
        Name     = 'link-check'
        Label    = 'Internal Links'
        Script   = 'link-check.ps1'
        Severity = 'WARN'
    }
)

# ============================================================
# RUN CHECKS
# ============================================================
$results       = @()
$criticalFail  = $false
$totalPassed   = 0
$totalFailed   = 0
$totalWarnings = 0

foreach ($check in $checkDefinitions) {
    # Skip if requested
    if ($SkipChecks -contains $check.Name) {
        Write-Host "  -- $($check.Label) -- SKIPPED" -ForegroundColor DarkGray
        $results += @{
            Name     = $check.Name
            Label    = $check.Label
            Status   = 'SKIP'
            Severity = $check.Severity
            Issues   = @()
        }
        continue
    }

    Write-Host "  -- $($check.Label) --" -ForegroundColor White

    $scriptPath = Join-Path $checksDir $check.Script
    if (-not (Test-Path $scriptPath)) {
        Write-Host "    [X] Check script not found: $($check.Script)" -ForegroundColor Red
        $results += @{
            Name     = $check.Name
            Label    = $check.Label
            Status   = 'ERROR'
            Severity = $check.Severity
            Issues   = @(@{ Message = "Check script not found: $scriptPath" })
        }
        if ($check.Severity -eq 'CRITICAL') {
            $criticalFail = $true
            $totalFailed++
        } else {
            $totalWarnings++
        }
        continue
    }

    try {
        $checkResult = & $scriptPath -SitePath $SitePath

        $results += @{
            Name        = $check.Name
            Label       = $check.Label
            Status      = $checkResult.Status
            Severity    = if ($checkResult.Severity) { $checkResult.Severity } else { $check.Severity }
            Issues      = if ($checkResult.Issues) { $checkResult.Issues } else { @() }
            TotalChecks = $checkResult.TotalChecks
            Passed      = $checkResult.Passed
        }

        if ($checkResult.Status -eq 'PASS') {
            $totalPassed++
        } elseif ($checkResult.Status -eq 'FAIL') {
            if ($check.Severity -eq 'CRITICAL' -or $checkResult.Severity -eq 'CRITICAL') {
                $criticalFail = $true
                $totalFailed++
            } else {
                $totalWarnings++
            }
        } else {
            # WARN
            $totalWarnings++
        }
    } catch {
        Write-Host "    [X] Check failed with error: $($_.Exception.Message)" -ForegroundColor Red
        $results += @{
            Name     = $check.Name
            Label    = $check.Label
            Status   = 'ERROR'
            Severity = $check.Severity
            Issues   = @(@{ Message = "Error: $($_.Exception.Message)" })
        }
        if ($check.Severity -eq 'CRITICAL') {
            $criticalFail = $true
            $totalFailed++
        } else {
            $totalWarnings++
        }
    }

    Write-Host ""
}

# ============================================================
# REPORT
# ============================================================
$endTime  = Get-Date
$duration = $endTime - $startTime

Write-Host "============================================================" -ForegroundColor $(if ($criticalFail) { 'Red' } else { 'Green' })
Write-Host "                   VALIDATION REPORT                        " -ForegroundColor $(if ($criticalFail) { 'Red' } else { 'Green' })
Write-Host "============================================================" -ForegroundColor $(if ($criticalFail) { 'Red' } else { 'Green' })
Write-Host ""

foreach ($r in $results) {
    $icon = switch ($r.Status) {
        'PASS'  { '[OK]' }
        'SKIP'  { '[ ]' }
        'WARN'  { '[!]' }
        default { '[X]' }
    }
    $color = switch ($r.Status) {
        'PASS'  { 'Green' }
        'SKIP'  { 'DarkGray' }
        'WARN'  { 'Yellow' }
        default { 'Red' }
    }
    $issueCount = if ($r.Issues) { $r.Issues.Count } else { 0 }
    $detail = if ($r.Status -eq 'PASS') { '' }
              elseif ($r.Status -eq 'SKIP') { '(skipped)' }
              else { "($issueCount issue$(if ($issueCount -ne 1){'s'}))" }

    Write-Host ("  {0}  {1,-25} {2,-8} {3}" -f $icon, $r.Label, "[$($r.Status)]", $detail) -ForegroundColor $color
}

Write-Host ""
Write-Host ("  Duration:   {0:F1}s" -f $duration.TotalSeconds) -ForegroundColor White
Write-Host ("  Passed:     {0}" -f $totalPassed) -ForegroundColor Green
Write-Host ("  Warnings:   {0}" -f $totalWarnings) -ForegroundColor $(if ($totalWarnings -gt 0) { 'Yellow' } else { 'White' })
Write-Host ("  Failed:     {0}" -f $totalFailed) -ForegroundColor $(if ($totalFailed -gt 0) { 'Red' } else { 'White' })
Write-Host ""

if ($criticalFail) {
    Write-Host '  X VALIDATION FAILED -- critical checks did not pass.' -ForegroundColor Red
    Write-Host "    Fix the issues above before deploying." -ForegroundColor Red
} else {
    Write-Host '  VALIDATION PASSED -- all critical checks passed.' -ForegroundColor Green
    if ($totalWarnings -gt 0) {
        Write-Host "    (There are $totalWarnings warning(s) -- review before deploying.)" -ForegroundColor Yellow
    }
}
Write-Host ""

# ============================================================
# OUTPUT REPORT (optional)
# ============================================================
if ($OutputReport) {
    $reportData = @{
        site_path   = $SitePath
        status      = if ($criticalFail) { 'FAIL' } else { 'PASS' }
        generated_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        duration_ms = [int]$duration.TotalMilliseconds
        summary     = @{
            passed   = $totalPassed
            warnings = $totalWarnings
            failed   = $totalFailed
        }
        checks      = $results
    }
    $reportJson = $reportData | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($OutputReport, $reportJson, $utf8)
    Write-Host "  Report written to: $OutputReport" -ForegroundColor Gray
    Write-Host ""
}

# Return structured result
$finalResult = @{
    SitePath     = $SitePath
    Status       = if ($criticalFail) { 'FAIL' } else { 'PASS' }
    CriticalFail = $criticalFail
    TotalChecks  = $results.Count
    Passed       = $totalPassed
    Failed       = $totalFailed
    Warnings     = $totalWarnings
    Results      = $results
    Duration     = $duration
}

# Set exit code
if ($criticalFail) {
    $host.SetShouldExit(1)
}

return $finalResult
