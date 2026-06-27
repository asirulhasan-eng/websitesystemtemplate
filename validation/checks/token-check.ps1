<#
.SYNOPSIS
  Check for remaining unfilled {{TOKEN}} patterns in all files.

.DESCRIPTION
  Recursively scans all text files under the given site path for any remaining
  {{TOKEN}} patterns (e.g., {{DOMAIN}}, {{SITE_NAME}}). Any remaining token
  indicates an incomplete setup and is a CRITICAL failure.

.PARAMETER SitePath
  Root path of the provisioned site to scan.

.EXAMPLE
  pwsh ./validation/checks/token-check.ps1 -SitePath ./sites/acme-plumbing
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'

Write-Host "  --- Token Residue Check ---" -ForegroundColor Magenta

if (-not (Test-Path $SitePath)) {
    Write-Host ("    [FAIL] Site path not found: " + $SitePath) -ForegroundColor Red
    return @{
        Check    = 'token-check'
        Status   = 'FAIL'
        Severity = 'CRITICAL'
        Issues   = @(@{ File = '(none)'; Message = "Site path not found: $SitePath" })
    }
}

$includeExt = @(
    '.html', '.css', '.js', '.json', '.xml', '.txt', '.md',
    '.ps1', '.sh', '.yaml', '.yml', '.env', '.example',
    '.conf', '.service', '.timer', '.mjs', '.py', '.bat', '.tsv'
)

# Exclude:
#  - dependencies / vcs
#  - provisioning + setup + validation TOOLING (these intentionally contain
#    {{TOKEN}} examples and template heredocs -- e.g. apply-template.ps1 -- and are
#    not part of the deployed site)
#  - root meta-docs that describe the token system in prose
$excludePatterns = @(
    '[\\/]node_modules[\\/]',
    '[\\/]\.git[\\/]',
    '[\\/]provision[\\/]',
    '[\\/]setup[\\/]',
    '[\\/]validation[\\/]',
    '[\\/]scratch[\\/]',
    '[\\/]Website[\\/]setup\.ps1$',
    '[\\/]Website[\\/]deployment-docs[\\/]',
    'website-profile\.json$',
    'scaffold-config\.json$',
    '_post-template\.html$',
    '_service-template\.html$',
    '[\\/]tools[\\/].*-skill\.md$',
    '[\\/]tools[\\/]SERVICE-PAGE.*\.md$',
    '[\\/]processes[\\/]schema\.json$',
    '[\\/](TEMPLATE|SETUP|README|SKILL-SETUP-GUIDE|SETUP-CHECKLIST)\.md$',
    '[\\/]site\.config\.json$',
    '[\\/]client-config\.schema\.json$'
)

# Meta-words used to *describe* the token system in prose or dynamic tags filled at runtime.
$metaTokens = @(
    '{{TOKEN}}', '{{TOKENS}}', '{{PLACEHOLDER}}', '{{PLACEHOLDERS}}',
    '{{TELEGRAM_CHAT_ID}}', '{{POST_TITLE}}', '{{POST_DESCRIPTION}}',
    '{{POST_IMAGE}}', '{{POST_SLUG}}', '{{POST_DATE}}', '{{POST_INFOGRAPHIC}}',
    '{{POST_INTRO}}', '{{POST_TITLE_SHORT}}', '{{POST_DATE_DISPLAY}}',
    '{{BRAND_NAME}}', '{{FULL_DOMAIN}}', '{{TAGLINE}}', '{{TOPBAR_TEXT}}',
    '{{CONTACT_EMAIL}}', '{{LOGO_TEXT}}', '{{LOGO_ACCENT}}', '{{PRICE_RANGE}}',
    '{{AREA_SERVED}}', '{{SERVICE_TYPE}}', '{{LOGO_FILE}}', '{{SERVICE_NOUN}}',
    '{{GTM_ID}}', '{{GA_ID}}', '{{BOOKING_URL}}', '{{HOME_TITLE}}',
    '{{HOME_DESCRIPTION}}', '{{NICHE_PLURAL}}', '{{NICHE_ADJ}}',
    '{{PROFESSIONAL}}', '{{PROFESSIONAL_PLURAL}}', '{{DOMAIN_SLUG}}',
    '{{PROJECT_SLUG}}', '{{PROJECT_NAME}}', '{{FORM_API_KEY}}',
    '{{SOCIAL_FACEBOOK}}', '{{SOCIAL_TWITTER}}', '{{SOCIAL_INSTAGRAM}}',
    '{{SOCIAL_LINKEDIN}}', '{{SOCIAL_YOUTUBE}}', '{{SOCIAL_PINTEREST}}',
    '{{SOCIAL_SUBSTACK}}', '{{SOCIAL_MEDIUM}}', '{{DEFAULT_OG_IMAGE}}',
    '{{INFOGRAPHIC_ALT}}', '{{TWITTER_HANDLE}}'
)

# Get all files then filter
$absSitePath = [regex]::Escape((Resolve-Path $SitePath).Path)
$allFiles = Get-ChildItem -Path $SitePath -Recurse -File |
    Where-Object { $includeExt -contains $_.Extension.ToLower() }

$files = @()
foreach ($f in $allFiles) {
    $exclude = $false
    foreach ($pattern in $excludePatterns) {
        if ($f.FullName -match $pattern) { $exclude = $true; break }
    }
    if (-not $exclude) { $files += $f }
}

$issues = @()
$totalTokens = 0

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -ErrorAction SilentlyContinue
    if ($null -eq $content) { continue }

    $lineNum = 0
    foreach ($line in $content) {
        $lineNum++
        $matches_ = [regex]::Matches($line, '\{\{[A-Z][A-Z0-9_]*\}\}')
        foreach ($m in $matches_) {
            if ($metaTokens -contains $m.Value) { continue }
            $totalTokens++
            $relativePath = [regex]::Replace($file.FullName, "^$absSitePath", "", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).TrimStart('\', '/')
            $issues += @{
                File    = $relativePath
                Line    = $lineNum
                Token   = $m.Value
                Context = $line.Trim().Substring(0, [Math]::Min($line.Trim().Length, 100))
                Message = "Unfilled token $($m.Value) at line $lineNum"
            }
            if ($issues.Count -le 25) {
                Write-Host ("    [FAIL] " + $relativePath + ":" + $lineNum + " -- " + $m.Value) -ForegroundColor Red
            }
        }
    }
}

if ($issues.Count -gt 25) {
    Write-Host ("    ... and " + ($issues.Count - 25) + " more") -ForegroundColor Red
}

if ($issues.Count -eq 0) {
    Write-Host ("    [PASS] No unfilled tokens found (" + $files.Count + " files scanned)") -ForegroundColor Green
    return @{
        Check      = 'token-check'
        Status     = 'PASS'
        Severity   = 'CRITICAL'
        Issues     = @()
        FileCount  = $files.Count
    }
} else {
    Write-Host ("    [FAIL] " + $totalTokens + " unfilled token(s) in " + $issues.Count + " location(s)") -ForegroundColor Red
    return @{
        Check      = 'token-check'
        Status     = 'FAIL'
        Severity   = 'CRITICAL'
        Issues     = $issues
        FileCount  = $files.Count
        TokenCount = $totalTokens
    }
}
