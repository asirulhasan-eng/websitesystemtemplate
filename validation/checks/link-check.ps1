<#
.SYNOPSIS
  Check for broken internal links in all HTML files.

.DESCRIPTION
  Parses every HTML file for href and src attributes, identifies internal
  links, and verifies that each points to an existing file on disk.

.PARAMETER SitePath
  Root path of the provisioned site to scan.

.EXAMPLE
  pwsh ./validation/checks/link-check.ps1 -SitePath ./sites/acme-plumbing
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'

Write-Host "  --- Link Check ---" -ForegroundColor Magenta

# Locate the Website directory
$websiteDir = $SitePath
if (Test-Path (Join-Path $SitePath 'Website')) {
    $websiteDir = Join-Path $SitePath 'Website'
}

if (-not (Test-Path $websiteDir)) {
    Write-Host "    [FAIL] Website directory not found" -ForegroundColor Red
    return @{
        Check    = 'link-check'
        Status   = 'WARN'
        Severity = 'WARN'
        Issues   = @(@{ File = '(none)'; Message = 'Website directory not found' })
    }
}

$absWebsiteDir = [regex]::Escape((Resolve-Path $websiteDir).Path)
$htmlFiles = Get-ChildItem -Path $websiteDir -Recurse -Filter '*.html' |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' -and $_.FullName -notmatch '[\\/]\.git[\\/]' }

$issues     = @()
$totalLinks = 0
$brokenLinks = 0
$checkedPairs = @{}

# Pattern to extract href and src
$Q = [char]34   # double quote
$A = [char]39   # single quote
$rxPattern = "(?:href|src)\s*=\s*[$Q$A]([^$Q$A#][^$Q$A]*)(?:#[^$Q$A]*)?[$Q$A]"
$rxLinks = New-Object regex($rxPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

foreach ($file in $htmlFiles) {
    $relativePath = [regex]::Replace($file.FullName, "^$absWebsiteDir", "", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).TrimStart('\', '/')
    $fileDir = Split-Path -Parent $file.FullName
    $html = Get-Content -Raw -Path $file.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($null -eq $html) { continue }

    $linkMatches = $rxLinks.Matches($html)
    foreach ($m in $linkMatches) {
        $link = $m.Groups[1].Value.Trim()

        # Strip fragment
        $fragIdx = $link.IndexOf('#')
        if ($fragIdx -ge 0) { $link = $link.Substring(0, $fragIdx) }
        if ([string]::IsNullOrWhiteSpace($link)) { continue }

        # Skip external links
        if ($link -match '^(https?://|//|mailto:|tel:|data:|javascript:|ftp:)') { continue }

        $totalLinks++

        # Resolve the link target path
        $targetPath = $null
        if ($link.StartsWith('/')) {
            $targetPath = Join-Path $websiteDir $link.TrimStart('/')
        } else {
            $targetPath = Join-Path $fileDir $link
        }

        # Check existence
        $found = $false
        try {
            if ($targetPath.EndsWith('/') -or $targetPath.EndsWith('\')) {
                if (Test-Path $targetPath) { $found = $true }
                if (-not $found -and (Test-Path (Join-Path $targetPath 'index.html'))) { $found = $true }
            }
            if (-not $found -and (Test-Path $targetPath)) { $found = $true }
            if (-not $found -and (Test-Path ($targetPath + '.html'))) { $found = $true }
            if (-not $found -and (Test-Path (Join-Path $targetPath 'index.html'))) { $found = $true }
        }
        catch {
            continue
        }

        if ($found) { continue }

        # Broken link
        $pairKey = $relativePath + '|' + $link
        if ($checkedPairs.ContainsKey($pairKey)) { continue }
        $checkedPairs[$pairKey] = $true

        $brokenLinks++
        $issues += @{
            File    = $relativePath
            Link    = $link
            Target  = $targetPath
            Message = "Broken link: $link"
        }

        if ($brokenLinks -le 20) {
            Write-Host ("    [WARN] " + $relativePath + " -- broken: " + $link) -ForegroundColor Yellow
        }
    }
}

if ($brokenLinks -gt 20) {
    Write-Host ("    ... and " + ($brokenLinks - 20) + " more broken links") -ForegroundColor Yellow
}

# ============================================================
# SUMMARY
# ============================================================
$status = if ($brokenLinks -eq 0) { 'PASS' } else { 'WARN' }
$tag    = if ($status -eq 'PASS') { 'PASS' } else { 'WARN' }

Write-Host ""
Write-Host ("    [$tag] Link check: $totalLinks links scanned, $brokenLinks broken") -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } else { 'Yellow' })

return @{
    Check       = 'link-check'
    Status      = $status
    Severity    = 'WARN'
    Issues      = $issues
    TotalLinks  = $totalLinks
    BrokenLinks = $brokenLinks
    HtmlFiles   = $htmlFiles.Count
}
