<#
.SYNOPSIS
  Inject client variables into the three production skill files.

.DESCRIPTION
  Reads site.config.json (for {{TOKENS}}) and optionally website-profile.json
  (for structural data extracted by analyze-website.ps1), then performs two
  layers of customization on the production skill files:

  LAYER 1 -- Token replacement (deterministic, same as customize.ps1):
    {{DOMAIN}}, {{SITE_NAME}}, {{NICHE}}, {{AUDIENCE}}
    Plus secondary tokens: {{OWNER_NAME}}, {{ADMIN_EMAIL}}, {{TIMEZONE}}, etc.

  LAYER 2 -- Structural injection (from website-profile.json):
    - Project directory paths (where the site lives on disk)
    - Source post references (for scaffold-blog.ps1)
    - Analytics IDs (GA4, GTM, Clarity)
    - Social media handles
    - Brand palette hex codes
    - Blog card CSS classes
    - Favicon paths

  SAFE BY DEFAULT: dry run. Pass -Apply to write.

.PARAMETER ConfigPath
  Path to site.config.json. Default: ../site.config.json

.PARAMETER ProfilePath
  Path to website-profile.json (from analyze-website.ps1). Default: ../website-profile.json.
  If missing, only Layer 1 (token replacement) runs.

.PARAMETER Apply
  Actually write changes to the skill files.

.PARAMETER SkillsDir
  Path to the directory containing the three skill files. Default: ../Agentic SEO/tools

.EXAMPLE
  pwsh ./setup/inject-skills.ps1                  # preview token + structural changes
  pwsh ./setup/inject-skills.ps1 -Apply           # apply all changes
#>

[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ProfilePath,
    [string]$SkillsDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not $ConfigPath)  { $ConfigPath  = Join-Path $repoRoot 'site.config.json' }
if (-not $ProfilePath) { $ProfilePath = Join-Path $repoRoot 'website-profile.json' }
if (-not $SkillsDir)   { $SkillsDir   = Join-Path $repoRoot 'Agentic SEO/tools' }

if (-not (Test-Path $ConfigPath)) { throw "site.config.json not found: $ConfigPath" }

# ============================================================
# 1. LOAD INPUTS
# ============================================================
$cfg = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json

$hasProfile = Test-Path $ProfilePath
$wp = $null
if ($hasProfile) {
    $wp = Get-Content -Raw -Path $ProfilePath | ConvertFrom-Json
}

Write-Host ""
Write-Host "=== inject-skills ($(if ($Apply) {'APPLY'} else {'DRY RUN'})) ===" -ForegroundColor Cyan
Write-Host "  Config:  $ConfigPath"
Write-Host "  Profile: $(if ($hasProfile) { $ProfilePath } else { '(not found - Layer 2 skipped)' })"
Write-Host "  Skills:  $SkillsDir"
Write-Host ""

# ============================================================
# 2. THE THREE TARGET FILES
# ============================================================
$targetFiles = @(
    (Join-Path $SkillsDir 'blog-production-skill.md'),
    (Join-Path $SkillsDir 'stats-blog-production-skill.md'),
    (Join-Path $SkillsDir 'SERVICE-PAGE-PRODUCTION-SKILL.md')
)

# Also process scaffold-blog.ps1 (it contains the same tokens)
$scaffoldFile = Join-Path $SkillsDir 'scaffold-blog.ps1'
if (Test-Path $scaffoldFile) { $targetFiles += $scaffoldFile }

# Validate all exist
foreach ($f in $targetFiles) {
    if (-not (Test-Path $f)) {
        Write-Host "  [WARN] Target file not found: $f" -ForegroundColor Yellow
    }
}
$targetFiles = $targetFiles | Where-Object { Test-Path $_ }

# ============================================================
# 3. LAYER 1 -- TOKEN REPLACEMENT
# ============================================================
Write-Host "--- Layer 1: Token Replacement ---" -ForegroundColor Magenta

$pairs = @(
    @('{{DOMAIN}}',           $cfg.domain),
    @('{{SITE_NAME}}',        $cfg.site_name),
    @('{{SITE_DESCRIPTION}}', $cfg.site_description),
    @('{{OWNER_NAME}}',       $cfg.owner_name),
    @('{{NICHE}}',            $cfg.business.niche),
    @('{{AUDIENCE}}',         $cfg.business.audience),
    @('{{BRAND_VOICE}}',      $cfg.business.brand_voice),
    @('{{ADMIN_EMAIL}}',      $cfg.email.admin),
    @('{{TIMEZONE_ABBR}}',    $cfg.timezone_abbr),
    @('{{TIMEZONE}}',         $cfg.timezone)
)

# --- Pre-flight guard: refuse to propagate unfilled placeholders ---
# Mirrors customize.ps1. If Hermes has not filled an __HERMES_FILL__ field (or a
# value is itself still a {{TOKEN}}), abort instead of baking the sentinel into the
# production skill files. In the canonical flow customize.ps1 catches this first;
# this guard protects standalone runs of inject-skills.ps1.
$badPairs = @()
foreach ($p in $pairs) {
    $val = [string]$p[1]
    if ($val -match '__HERMES_FILL__' -or $val -match '\{\{[A-Z_]+\}\}') {
        $badPairs += ("{0} = '{1}'" -f $p[0], $val)
    }
}
if ($badPairs.Count -gt 0) {
    Write-Host ""
    Write-Host "  [ABORT] site.config.json has unfilled values:" -ForegroundColor Red
    foreach ($b in $badPairs) { Write-Host ("    " + $b) -ForegroundColor Red }
    Write-Host "  Fill every __HERMES_FILL__ field (see Onboarding Phase 2), then re-run." -ForegroundColor Yellow
    Write-Host ""
    throw "inject-skills aborted: unfilled placeholders in site.config.json"
}

# Show mapping
foreach ($p in $pairs) {
    $val = if ([string]::IsNullOrEmpty($p[1])) { '(EMPTY - will not replace)' } else { $p[1] }
    $color = if ([string]::IsNullOrEmpty($p[1])) { 'Yellow' } else { 'Gray' }
    Write-Host ("  {0,-25} -> {1}" -f $p[0], $val) -ForegroundColor $color
}
Write-Host ""

# ============================================================
# 4. LAYER 2 -- STRUCTURAL INJECTION (from website-profile.json)
# ============================================================
# These are non-token replacements: specific hardcoded values in the skill files
# that need to match the actual imported website structure.

$structuralPairs = @()

if ($hasProfile -and $wp) {
    Write-Host "--- Layer 2: Structural Injection ---" -ForegroundColor Magenta

    # 4a. Project paths -- the skill files reference "c:\Users\Administrator\Documents\{{NICHE}} website 2\tools"
    #     Replace with the actual website path from the profile
    $websitePath = $wp.source_path
    if ($websitePath) {
        # The skill files use this pattern:
        $structuralPairs += ,@(
            'c:\Users\Administrator\Documents\{{NICHE}} website 2\tools',
            (Join-Path $websitePath 'tools')
        )
        $structuralPairs += ,@(
            'd:\Projects\{{NICHE}} SEO Agency\tools',
            (Join-Path $websitePath 'tools')
        )
        $structuralPairs += ,@(
            'd:\Projects\{{NICHE}} SEO Agency',
            $websitePath
        )
        $structuralPairs += ,@(
            '{{NICHE}} website 2/',
            (Split-Path -Leaf $websitePath) + '/'
        )
        $structuralPairs += ,@(
            '{{NICHE}} SEO Agency/',
            (Split-Path -Leaf $websitePath) + '/'
        )
    }

    # 4b. Source post reference
    if ($wp.scaffold -and $wp.scaffold.best_source_post) {
        $bestSource = $wp.scaffold.best_source_post
        Write-Host "  Source post:    $bestSource" -ForegroundColor Gray

        # The scaffold defaults to google-maps-seo-for-{{AUDIENCE}}.html
        # Replace with the actual best source post
        $structuralPairs += ,@(
            'google-maps-seo-for-{{AUDIENCE}}.html',
            $bestSource
        )
    }

    # 4c. Service page reference (for SERVICE-PAGE-PRODUCTION-SKILL)
    if ($wp.scaffold -and $wp.scaffold.best_service_source) {
        $bestService = $wp.scaffold.best_service_source
        Write-Host "  Service source: $bestService" -ForegroundColor Gray
        $structuralPairs += ,@(
            'drain-cleaning.html',
            $bestService
        )
    }

    # 4d. Analytics IDs
    if ($wp.analytics) {
        if ($wp.analytics.ga4_id) {
            Write-Host "  GA4 ID:        $($wp.analytics.ga4_id)" -ForegroundColor Gray
            $structuralPairs += ,@('G-H9RD5BVGR8', $wp.analytics.ga4_id)
        }
        if ($wp.analytics.clarity_id) {
            Write-Host "  Clarity ID:    $($wp.analytics.clarity_id)" -ForegroundColor Gray
            $structuralPairs += ,@('ww29j18bkr', $wp.analytics.clarity_id)
        }
    }

    # 4e. Social media handles
    if ($wp.social) {
        if ($wp.social.twitter_handle) {
            Write-Host "  Twitter:       $($wp.social.twitter_handle)" -ForegroundColor Gray
            $structuralPairs += ,@('@clientagen', $wp.social.twitter_handle)
        }
        if ($wp.social.facebook) {
            $structuralPairs += ,@('clientagency/', "$($wp.social.facebook)/")
        }
        if ($wp.social.youtube) {
            $structuralPairs += ,@('@{{SITE_NAME}}Agency', "@$($wp.social.youtube)")
        }
    }

    # 4f. Serper API key reference — already replaced with .env placeholder in
    # the template source (stats-blog-production-skill.md). No replacement needed.
    # If you are processing an older copy that still has the raw key, run this
    # script again after updating the template.

    foreach ($sp in $structuralPairs) {
        $label = $sp[0]
        if ($label.Length -gt 55) { $label = $label.Substring(0,52) + '...' }
        Write-Host ("  {0,-55} -> {1}" -f $label, $sp[1]) -ForegroundColor Gray
    }
    Write-Host ""
}

# ============================================================
# 5. APPLY REPLACEMENTS
# ============================================================
$totalHits = 0
$totalFiles = 0

foreach ($file in $targetFiles) {
    $orig = Get-Content -Raw -Path $file -ErrorAction SilentlyContinue
    if ($null -eq $orig) { continue }
    $text = $orig
    $hits = 0

    # Layer 1: Token replacement
    foreach ($p in $pairs) {
        if ([string]::IsNullOrEmpty($p[0]) -or [string]::IsNullOrEmpty($p[1])) { continue }
        $c = ([regex]::Matches($text, [regex]::Escape($p[0]))).Count
        if ($c -gt 0) { $text = $text.Replace($p[0], [string]$p[1]); $hits += $c }
    }

    # Layer 2: Structural replacement
    foreach ($sp in $structuralPairs) {
        if ([string]::IsNullOrEmpty($sp[0]) -or [string]::IsNullOrEmpty($sp[1])) { continue }
        $c = ([regex]::Matches($text, [regex]::Escape($sp[0]))).Count
        if ($c -gt 0) { $text = $text.Replace($sp[0], [string]$sp[1]); $hits += $c }
    }

    $fname = Split-Path -Leaf $file
    if ($hits -gt 0) {
        $totalFiles++
        $totalHits += $hits
        Write-Host "  $fname  ->  $hits replacements" -ForegroundColor White
        if ($Apply) {
            [System.IO.File]::WriteAllText($file, $text, $utf8)
        }
    } else {
        Write-Host "  $fname  ->  (no matches)" -ForegroundColor DarkGray
    }

    # Report leftover placeholders
    $leftovers = [regex]::Matches($text, '\{\{[A-Z_]+\}\}')
    if ($leftovers.Count -gt 0) {
        $unique = ($leftovers | ForEach-Object { $_.Value } | Sort-Object -Unique) -join ', '
        Write-Host "    [WARN] Unfilled tokens remain: $unique" -ForegroundColor Yellow
    }
}

# ============================================================
# 6. SUMMARY
# ============================================================
Write-Host ""
Write-Host ("  {0} files, {1} total replacements" -f $totalFiles, $totalHits) -ForegroundColor White
Write-Host ""

if (-not $Apply) {
    Write-Host "DRY RUN. Re-run with -Apply to write." -ForegroundColor Green
} else {
    Write-Host "APPLIED. Skill files are now customized for this client." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Review the skill files for any remaining {{TOKENS}} or placeholder text" -ForegroundColor Gray
    Write-Host "  2. Run: pwsh ./setup/generate-scaffold-config.ps1  (optional)" -ForegroundColor Gray
    Write-Host "  3. AI prose polish: read the voice guide sections and tailor to the client's brand" -ForegroundColor Gray
    Write-Host ""
}
