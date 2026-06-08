<#
.SYNOPSIS
  Deprovision (tear down) a site from the Website Autopilot System.

.DESCRIPTION
  Safely removes a provisioned site:
    - Remove from registry.json
    - Archive the GitHub repo (if -ArchiveGit)
    - Delete Cloudflare Pages project (if -DeleteCloudflare)
    - Move site directory to an 'archived/' folder (never deletes)

  Dry-run by default. Pass -Apply to execute.

.PARAMETER Slug
  The site slug to deprovision. Must match an entry in registry.json.

.PARAMETER ArchiveGit
  Archive the GitHub repository (sets it to archived state).

.PARAMETER DeleteCloudflare
  Delete the Cloudflare Pages project.

.PARAMETER Apply
  Actually execute the deprovisioning. Without this, only previews.

.PARAMETER Force
  Skip confirmation prompts.

.EXAMPLE
  pwsh ./provision/deprovision-site.ps1 -Slug acme-plumbing
  pwsh ./provision/deprovision-site.ps1 -Slug acme-plumbing -Apply
  pwsh ./provision/deprovision-site.ps1 -Slug acme-plumbing -Apply -ArchiveGit -DeleteCloudflare
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Slug,

    [switch]$ArchiveGit,
    [switch]$DeleteCloudflare,
    [switch]$Apply,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$scriptDir = $PSScriptRoot

Write-Host ""
Write-Host "============================================================" -ForegroundColor Red
Write-Host "         Website Autopilot -- Site Deprovisioner            " -ForegroundColor Red
$modeLabel = if ($Apply) { '          *** APPLY MODE ***' } else { '            (DRY RUN)' }
Write-Host ("         " + $modeLabel) -ForegroundColor $(if ($Apply) { 'Yellow' } else { 'Green' })
Write-Host "============================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Slug: $Slug" -ForegroundColor White
Write-Host ""

# ============================================================
# 1. LOAD REGISTRY
# ============================================================
$registryPath = Join-Path $scriptDir 'registry.json'
if (-not (Test-Path $registryPath)) {
    throw "Registry not found: $registryPath"
}

$registry = Get-Content -Raw -Path $registryPath -Encoding UTF8 | ConvertFrom-Json

# Find the site entry
$siteEntry = $null
$siteIdx   = -1
for ($i = 0; $i -lt $registry.sites.Count; $i++) {
    if ($registry.sites[$i].slug -eq $Slug) {
        $siteEntry = $registry.sites[$i]
        $siteIdx = $i
        break
    }
}

if ($null -eq $siteEntry) {
    Write-Host ("  [FAIL] Site '" + $Slug + "' not found in registry.") -ForegroundColor Red
    Write-Host "    Registered sites:" -ForegroundColor Yellow
    foreach ($s in $registry.sites) {
        Write-Host ("      - " + $s.slug + " (" + $s.domain + ")") -ForegroundColor Gray
    }
    Write-Host ""
    throw "Site '$Slug' not found in registry.json"
}

Write-Host "  Found site:" -ForegroundColor Green
Write-Host ("    Domain:        " + $siteEntry.domain) -ForegroundColor White
Write-Host ("    Site Name:     " + $siteEntry.site_name) -ForegroundColor White
Write-Host ("    Output Dir:    " + $siteEntry.output_dir) -ForegroundColor White
Write-Host ("    Provisioned:   " + $siteEntry.provisioned_at) -ForegroundColor White
Write-Host ""

# ============================================================
# 2. CONFIRMATION
# ============================================================
if ($Apply -and -not $Force) {
    Write-Host "  [!] WARNING: This will deprovision '$Slug'." -ForegroundColor Yellow
    Write-Host "    The site directory will be archived (not deleted)." -ForegroundColor Yellow
    if ($ArchiveGit) {
        Write-Host "    The GitHub repo will be archived." -ForegroundColor Yellow
    }
    if ($DeleteCloudflare) {
        Write-Host "    The Cloudflare Pages project will be DELETED." -ForegroundColor Red
    }
    Write-Host ""
    $confirm = Read-Host "  Type the slug '$Slug' to confirm"
    if ($confirm -ne $Slug) {
        Write-Host "  Aborted." -ForegroundColor Yellow
        return
    }
    Write-Host ""
}

# ============================================================
# 3. ARCHIVE SITE DIRECTORY
# ============================================================
Write-Host "  --- Step 1: Archive site directory ---" -ForegroundColor Cyan

$siteDir = $siteEntry.output_dir
$archiveRoot = Join-Path $scriptDir 'archived'
$archiveDir  = Join-Path $archiveRoot ($Slug + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

if ($siteDir -and (Test-Path $siteDir)) {
    if ($Apply) {
        if (-not (Test-Path $archiveRoot)) {
            New-Item -Path $archiveRoot -ItemType Directory -Force | Out-Null
        }
        Move-Item -Path $siteDir -Destination $archiveDir -Force
        Write-Host ("    [OK] Moved to: " + $archiveDir) -ForegroundColor Green
    } else {
        Write-Host "    Would move: $siteDir -> $archiveDir" -ForegroundColor DarkGray
    }
} else {
    Write-Host ("    [INFO] Site directory not found at '" + $siteDir + "' -- nothing to archive") -ForegroundColor Yellow
}

# ============================================================
# 4. ARCHIVE GITHUB REPO
# ============================================================
Write-Host "  --- Step 2: Archive GitHub repository ---" -ForegroundColor Cyan

if ($ArchiveGit) {
    $repoName = if ($siteEntry.PSObject.Properties.Name -contains 'cloudflare_project') {
        $siteEntry.cloudflare_project
    } else { $Slug }

    if ($Apply) {
        try {
            $ghCheck = & gh --version 2>&1
            if ($LASTEXITCODE -ne 0) { throw 'gh CLI not installed' }
            & gh repo archive $repoName --yes 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host ("    [OK] GitHub repo '" + $repoName + "' archived") -ForegroundColor Green
            } else {
                Write-Host ("    [FAIL] Failed to archive repo (exit code " + $LASTEXITCODE + ")") -ForegroundColor Red
            }
        }
        catch {
            Write-Host ("    [FAIL] GitHub archive failed: " + $_.Exception.Message) -ForegroundColor Red
        }
    } else {
        Write-Host "    Would run: gh repo archive $repoName --yes" -ForegroundColor DarkGray
    }
} else {
    Write-Host "    Skipped (use -ArchiveGit to enable)" -ForegroundColor DarkGray
}

# ============================================================
# 5. DELETE CLOUDFLARE PAGES PROJECT
# ============================================================
Write-Host "  --- Step 3: Delete Cloudflare Pages project ---" -ForegroundColor Cyan

if ($DeleteCloudflare) {
    $cfProject = if ($siteEntry.PSObject.Properties.Name -contains 'cloudflare_project') {
        $siteEntry.cloudflare_project
    } else { $Slug }

    if ($Apply) {
        try {
            & npx wrangler pages project delete $cfProject --yes 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host ("    [OK] Cloudflare Pages project '" + $cfProject + "' deleted") -ForegroundColor Green
            } else {
                Write-Host ("    [FAIL] Failed to delete Cloudflare project (exit code " + $LASTEXITCODE + ")") -ForegroundColor Red
            }
        }
        catch {
            Write-Host ("    [FAIL] Cloudflare delete failed: " + $_.Exception.Message) -ForegroundColor Red
        }
    } else {
        Write-Host "    Would run: npx wrangler pages project delete $cfProject --yes" -ForegroundColor DarkGray
    }
} else {
    Write-Host "    Skipped (use -DeleteCloudflare to enable)" -ForegroundColor DarkGray
}

# ============================================================
# 6. REMOVE FROM REGISTRY
# ============================================================
Write-Host "  --- Step 4: Remove from registry ---" -ForegroundColor Cyan

if ($Apply) {
    $sitesList = [System.Collections.ArrayList]@($registry.sites)
    $sitesList.RemoveAt($siteIdx)
    $registry.sites = $sitesList.ToArray()

    $registryJson = $registry | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($registryPath, $registryJson, $utf8)
    $remaining = $registry.sites.Count
    Write-Host ("    [OK] Removed '" + $Slug + "' from registry (" + $remaining + " sites remain)") -ForegroundColor Green
} else {
    Write-Host "    Would remove '$Slug' from registry.json" -ForegroundColor DarkGray
}

# ============================================================
# SUMMARY
# ============================================================
Write-Host ""
if ($Apply) {
    Write-Host ("  [OK] DEPROVISIONED: " + $Slug) -ForegroundColor Green
    if ($siteDir -and (Test-Path $archiveDir)) {
        Write-Host ("    Archive: " + $archiveDir) -ForegroundColor Gray
    }
} else {
    Write-Host "  DRY RUN. Re-run with -Apply to deprovision." -ForegroundColor Green
    $fullCmd = "  pwsh ./provision/deprovision-site.ps1 -Slug `"$Slug`" -Apply"
    if ($ArchiveGit) { $fullCmd += ' -ArchiveGit' }
    if ($DeleteCloudflare) { $fullCmd += ' -DeleteCloudflare' }
    Write-Host "  $fullCmd" -ForegroundColor Gray
}
Write-Host ""

return @{
    Slug       = $Slug
    Applied    = $Apply.IsPresent
    ArchiveDir = $archiveDir
}
