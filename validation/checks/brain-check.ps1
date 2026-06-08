<#
.SYNOPSIS
  Check Obsidian Agent Brain directory for required structure.

.DESCRIPTION
  Verifies the Obsidian Agent Brain directory has expected seed directories
  (00-Dashboard through 14-System-Logs) and that 01-Agent-Brain has notes.

.PARAMETER SitePath
  Root path of the provisioned site to scan.

.EXAMPLE
  pwsh ./validation/checks/brain-check.ps1 -SitePath ./sites/acme-plumbing
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'

Write-Host "  --- Brain Check ---" -ForegroundColor Magenta

$issues  = @()
$checks  = 0
$passed  = 0

# ============================================================
# 1. OBSIDIAN DIRECTORY EXISTS
# ============================================================
$obsidianDir = Join-Path $SitePath 'Obsidian Agent Brain'
$checks++

if (-not (Test-Path $obsidianDir)) {
    $issues += @{ Dir = 'Obsidian Agent Brain'; Message = 'Directory not found' }
    Write-Host "    [FAIL] Obsidian Agent Brain/ -- not found" -ForegroundColor Red
    return @{
        Check       = 'brain-check'
        Status      = 'WARN'
        Severity    = 'WARN'
        Issues      = $issues
        TotalChecks = $checks
        Passed      = $passed
    }
}
$passed++
Write-Host "    [PASS] Obsidian Agent Brain/ exists" -ForegroundColor Green

# ============================================================
# 2. EXPECTED SEED DIRECTORIES
# ============================================================
$expectedDirs = @(
    '00-Dashboard',
    '01-Agent-Brain',
    '02-Tasks',
    '03-Topics',
    '04-Dashboards',
    '04-Pages',
    '05-Targets',
    '12-Reports',
    '14-System-Logs'
)

foreach ($dir in $expectedDirs) {
    $checks++
    $dirPath = Join-Path $obsidianDir $dir
    if (Test-Path $dirPath) {
        $passed++
        Write-Host ("    [PASS] " + $dir + "/") -ForegroundColor Green
    } else {
        $issues += @{ Dir = $dir; Message = 'Expected directory not found' }
        Write-Host ("    [WARN] " + $dir + "/ -- missing") -ForegroundColor Yellow
    }
}

# ============================================================
# 3. AGENT BRAIN SEED NOTES
# ============================================================
$brainDir = Join-Path $obsidianDir '01-Agent-Brain'
if (Test-Path $brainDir) {
    $brainNotes = Get-ChildItem -Path $brainDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @('.md', '.canvas') }

    $checks++
    if ($brainNotes.Count -gt 0) {
        $passed++
        Write-Host ("    [PASS] 01-Agent-Brain/ has " + $brainNotes.Count + " note(s)") -ForegroundColor Green

        # Check if notes are non-empty
        foreach ($note in $brainNotes) {
            $checks++
            if ($note.Length -gt 10) {
                $passed++
            } else {
                $issues += @{
                    Dir     = '01-Agent-Brain'
                    File    = $note.Name
                    Message = ('Note is empty or nearly empty (' + $note.Length + ' bytes)')
                }
                Write-Host ("    [WARN] 01-Agent-Brain/" + $note.Name + " -- nearly empty (" + $note.Length + " bytes)") -ForegroundColor Yellow
            }
        }
    } else {
        $issues += @{ Dir = '01-Agent-Brain'; Message = 'No seed notes found' }
        Write-Host "    [WARN] 01-Agent-Brain/ -- no notes found" -ForegroundColor Yellow
    }
}

# ============================================================
# SUMMARY
# ============================================================
$status = if ($issues.Count -eq 0) { 'PASS' } else { 'WARN' }
$tag    = if ($status -eq 'PASS') { 'PASS' } else { 'WARN' }

Write-Host ""
Write-Host ("    [$tag] Brain check: $passed/$checks passed, " + $issues.Count + " issue(s)") -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } else { 'Yellow' })

return @{
    Check       = 'brain-check'
    Status      = $status
    Severity    = 'WARN'
    Issues      = $issues
    TotalChecks = $checks
    Passed      = $passed
}
