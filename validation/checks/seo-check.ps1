<#
.SYNOPSIS
  Check SEO fundamentals in all HTML files.

.DESCRIPTION
  Validates every HTML file for essential SEO elements:
    - title tag, meta description, h1 (exactly one), canonical URL
    - Open Graph tags (og:title, og:description, og:url)
    - Schema.org JSON-LD structured data
    - robots.txt and sitemap.xml

.PARAMETER SitePath
  Root path of the provisioned site to scan.

.EXAMPLE
  pwsh ./validation/checks/seo-check.ps1 -SitePath ./sites/acme-plumbing
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'

Write-Host "  --- SEO Check ---" -ForegroundColor Magenta

# Locate the Website directory
$websiteDir = $SitePath
if (Test-Path (Join-Path $SitePath 'Website')) {
    $websiteDir = Join-Path $SitePath 'Website'
}

if (-not (Test-Path $websiteDir)) {
    Write-Host "    [FAIL] Website directory not found" -ForegroundColor Red
    return @{
        Check    = 'seo-check'
        Status   = 'FAIL'
        Severity = 'WARN'
        Issues   = @(@{ File = '(none)'; Message = 'Website directory not found' })
    }
}

$issues = @()
$checks = 0
$passed = 0

# ============================================================
# 1. CHECK ALL HTML FILES
# ============================================================
$htmlFiles = Get-ChildItem -Path $websiteDir -Recurse -Filter '*.html' |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' -and $_.FullName -notmatch '[\\/]\.git[\\/]' }

Write-Host ("    Scanning " + $htmlFiles.Count + " HTML file(s)...") -ForegroundColor Gray

foreach ($file in $htmlFiles) {
    $relativePath = $file.FullName.Replace($websiteDir, '').TrimStart('\', '/')
    $html = Get-Content -Raw -Path $file.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($null -eq $html) { continue }

    # --- title tag ---
    $checks++
    $titleRx = New-Object regex('(?i)<title[^>]*>(.*?)</title>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $titleMatch = $titleRx.Match($html)
    if ($titleMatch.Success -and $titleMatch.Groups[1].Value.Trim().Length -gt 0) {
        $passed++
    } else {
        $issues += @{ File = $relativePath; Element = 'title'; Message = 'Missing or empty title tag' }
        Write-Host ("    [WARN] " + $relativePath + " -- missing title") -ForegroundColor Yellow
    }

    # --- meta description ---
    $checks++
    $descRx1 = New-Object regex("(?i)<meta\s+name\s*=\s*[`"']description[`"']\s+content\s*=\s*[`"']([^`"']*)[`"']")
    $descRx2 = New-Object regex("(?i)<meta\s+content\s*=\s*[`"']([^`"']*)[`"'].*?name\s*=\s*[`"']description[`"']")
    $descMatch = $descRx1.Match($html)
    if (-not $descMatch.Success) { $descMatch = $descRx2.Match($html) }
    if ($descMatch.Success -and $descMatch.Groups[1].Value.Trim().Length -gt 0) {
        $passed++
    } else {
        $issues += @{ File = $relativePath; Element = 'meta-description'; Message = 'Missing meta description' }
        Write-Host ("    [WARN] " + $relativePath + " -- missing meta description") -ForegroundColor Yellow
    }

    # --- h1 (exactly one) ---
    $checks++
    $h1Rx = New-Object regex('(?i)<h1[\s>]')
    $h1Matches = $h1Rx.Matches($html)
    if ($h1Matches.Count -eq 1) {
        $passed++
    } elseif ($h1Matches.Count -eq 0) {
        $issues += @{ File = $relativePath; Element = 'h1'; Message = 'No h1 tag found' }
        Write-Host ("    [WARN] " + $relativePath + " -- no h1 tag") -ForegroundColor Yellow
    } else {
        $issues += @{ File = $relativePath; Element = 'h1'; Message = ($h1Matches.Count.ToString() + ' h1 tags found (should be 1)') }
        Write-Host ("    [WARN] " + $relativePath + " -- " + $h1Matches.Count + " h1 tags") -ForegroundColor Yellow
    }

    # --- canonical ---
    $checks++
    $canonRx = New-Object regex("(?i)<link\s+rel\s*=\s*[`"']canonical[`"']")
    if ($canonRx.IsMatch($html)) {
        $passed++
    } else {
        $issues += @{ File = $relativePath; Element = 'canonical'; Message = 'Missing canonical link' }
        Write-Host ("    [WARN] " + $relativePath + " -- missing canonical") -ForegroundColor Yellow
    }

    # --- Open Graph tags ---
    $ogTags = @('og:title', 'og:description', 'og:url')
    foreach ($og in $ogTags) {
        $checks++
        $ogRx1 = New-Object regex("(?i)<meta\s+(?:property|name)\s*=\s*[`"']$([regex]::Escape($og))[`"']")
        $ogRx2 = New-Object regex("(?i)<meta\s+content\s*=\s*[`"'][^`"']*[`"']\s+(?:property|name)\s*=\s*[`"']$([regex]::Escape($og))[`"']")
        if ($ogRx1.IsMatch($html) -or $ogRx2.IsMatch($html)) {
            $passed++
        } else {
            $issues += @{ File = $relativePath; Element = $og; Message = "Missing OG tag: $og" }
        }
    }

    # --- Schema.org JSON-LD ---
    $checks++
    $ldRx = New-Object regex("(?i)<script\s+type\s*=\s*[`"']application/ld\+json[`"']")
    if ($ldRx.IsMatch($html)) {
        $passed++
    } else {
        $issues += @{ File = $relativePath; Element = 'json-ld'; Message = 'No Schema.org JSON-LD' }
    }
}

# ============================================================
# 2. CHECK robots.txt
# ============================================================
$checks++
$robotsPath = Join-Path $websiteDir 'robots.txt'
if (Test-Path $robotsPath) {
    $robotsContent = Get-Content -Raw -Path $robotsPath -Encoding UTF8
    if ($robotsContent -match 'User-agent:' -and $robotsContent -match 'Sitemap:') {
        $passed++
        Write-Host "    [PASS] robots.txt valid" -ForegroundColor Green
    } else {
        $issues += @{ File = 'robots.txt'; Element = 'robots'; Message = 'Incomplete robots.txt' }
        Write-Host "    [WARN] robots.txt -- incomplete" -ForegroundColor Yellow
    }
} else {
    $issues += @{ File = 'robots.txt'; Element = 'robots'; Message = 'robots.txt not found' }
    Write-Host "    [WARN] robots.txt not found" -ForegroundColor Yellow
}

# ============================================================
# 3. CHECK sitemap.xml
# ============================================================
$checks++
$sitemapPath = Join-Path $websiteDir 'sitemap.xml'
if (Test-Path $sitemapPath) {
    $sitemapContent = Get-Content -Raw -Path $sitemapPath -Encoding UTF8
    $locRx = New-Object regex('<loc>(.*?)</loc>')
    $sitemapUrls = $locRx.Matches($sitemapContent)

    if ($sitemapUrls.Count -gt 0) {
        $passed++
        Write-Host ("    [PASS] sitemap.xml valid (" + $sitemapUrls.Count + " URLs)") -ForegroundColor Green
    } else {
        $issues += @{ File = 'sitemap.xml'; Element = 'sitemap'; Message = 'sitemap.xml has no URL entries' }
        Write-Host "    [WARN] sitemap.xml -- no URL entries" -ForegroundColor Yellow
    }
} else {
    $issues += @{ File = 'sitemap.xml'; Element = 'sitemap'; Message = 'sitemap.xml not found' }
    Write-Host "    [WARN] sitemap.xml not found" -ForegroundColor Yellow
}

# ============================================================
# SUMMARY
# ============================================================
$status = if ($issues.Count -eq 0) { 'PASS' } else { 'WARN' }
$tag    = if ($status -eq 'PASS') { 'PASS' } else { 'WARN' }

Write-Host ""
Write-Host ("    [$tag] SEO check: $passed/$checks passed, " + $issues.Count + " issue(s)") -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } else { 'Yellow' })

return @{
    Check       = 'seo-check'
    Status      = $status
    Severity    = 'WARN'
    Issues      = $issues
    TotalChecks = $checks
    Passed      = $passed
    HtmlFiles   = $htmlFiles.Count
}
