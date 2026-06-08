<#
.SYNOPSIS
  Analyze an imported website directory and extract a profile for skill customization.

.DESCRIPTION
  Reads the Website/ directory (or a specified path) and extracts:
    - Domain, site name, niche hints from meta tags and content
    - Blog post structure (CSS classes, HTML patterns, header/footer markers)
    - Existing blog slugs and titles for link-registry seeding
    - Brand palette from CSS variables and inline styles
    - Navigation structure and social media handles
    - Analytics IDs (GA, Clarity, GTM)
    - Favicon and asset paths
    - Source post candidates for scaffold-blog.ps1
  Outputs a website-profile.json for use by inject-skills.ps1 and generate-scaffold-config.ps1.

.PARAMETER WebsitePath
  Path to the imported website directory. Default: ../Website relative to this script.

.PARAMETER OutputPath
  Where to write the profile JSON. Default: ../website-profile.json

.EXAMPLE
  pwsh ./setup/analyze-website.ps1
  pwsh ./setup/analyze-website.ps1 -WebsitePath "D:\client-site" -OutputPath "D:\profile.json"
#>

[CmdletBinding()]
param(
    [string]$WebsitePath,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $WebsitePath) { $WebsitePath = Join-Path $repoRoot 'Website' }
if (-not $OutputPath)  { $OutputPath  = Join-Path $repoRoot 'website-profile.json' }

if (-not (Test-Path $WebsitePath)) {
    throw "Website directory not found: $WebsitePath"
}

Write-Host ""
Write-Host "=== analyze-website ===" -ForegroundColor Cyan
Write-Host "  Source: $WebsitePath"
Write-Host ""

# ============================================================
# REGEX PATTERNS (PS 5.1 safe: use double-quoted strings for [^ patterns)
# ============================================================
# PS 5.1 parses [^ inside single-quoted strings as a type literal.
# Using double-quoted strings with backtick-escaped quotes avoids this.
$Q = '"'  # quote char for building regex patterns safely
$rxCanonical = "(?i)<link\s+rel\s*=\s*[`"']canonical[`"']\s+href\s*=\s*[`"']([^`"']*)[`"']"

# ============================================================
# HELPERS
# ============================================================
function Extract-MetaContent {
    param([string]$Html, [string]$Name)
    $p1 = "(?i)<meta\s+(?:name|property)\s*=\s*[`"']$Name[`"']\s+content\s*=\s*[`"']([^`"']*)[`"']"
    $p2 = "(?i)<meta\s+content\s*=\s*[`"']([^`"']*)[`"']\s+(?:name|property)\s*=\s*[`"']$Name[`"']"
    $m = [regex]::Match($Html, $p1)
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($Html, $p2)
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Extract-TagContent {
    param([string]$Html, [string]$Tag)
    $p = "(?i)<$Tag[^>]*>(.*?)</$Tag>"
    $m = [regex]::Match($Html, $p, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return $null
}

function Match-ClassPattern {
    # Safely match class="...<keyword>..." patterns in PS 5.1
    param([string]$Html, [string]$Keyword)
    $p = "class=$Q(" + '[^"]*' + $Keyword + '[^"]*' + ")$Q"
    $rx = New-Object regex($p)
    return $rx.Match($Html)
}

function MatchAll-ClassPattern {
    param([string]$Html, [string]$Keyword)
    $p = "class=$Q(" + '[^"]*' + $Keyword + '[^"]*' + ")$Q"
    $rx = New-Object regex($p)
    return $rx.Matches($Html)
}

# ============================================================
# 1. SCAN ALL HTML FILES
# ============================================================
$htmlFiles = Get-ChildItem -Path $WebsitePath -Recurse -Filter '*.html' |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' -and $_.FullName -notmatch '[\\/]\.git[\\/]' }

Write-Host "  Found $($htmlFiles.Count) HTML files" -ForegroundColor Gray

# ============================================================
# 2. ANALYZE INDEX / HOME PAGE
# ============================================================
$profile = @{
    generated_at      = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
    source_path       = $WebsitePath
    identity          = @{}
    analytics         = @{}
    social            = @{}
    structure         = @{}
    blog              = @{}
    services          = @{}
    brand             = @{}
    favicon           = @{}
    scaffold          = @{}
}

$indexFile = $htmlFiles | Where-Object { $_.Name -eq 'index.html' -and $_.DirectoryName -eq (Resolve-Path $WebsitePath).Path } | Select-Object -First 1
if ($indexFile) {
    $indexHtml = Get-Content -Raw -Path $indexFile.FullName -Encoding UTF8
    Write-Host "  Analyzing index.html..." -ForegroundColor Gray

    # Domain from canonical or og:url
    $canonical = $null
    $m = [regex]::Match($indexHtml, $rxCanonical)
    if ($m.Success) { $canonical = $m.Groups[1].Value }
    $ogUrl = Extract-MetaContent $indexHtml 'og:url'
    $rawUrl = if ($canonical) { $canonical } elseif ($ogUrl) { $ogUrl } else { $null }
    if ($rawUrl) {
        try {
            $uri = [System.Uri]::new($rawUrl)
            $profile.identity.domain = $uri.Host
            $profile.identity.base_url = "$($uri.Scheme)://$($uri.Host)"
        } catch {
            $profile.identity.domain = $rawUrl -replace '^https?://', '' -replace '/.*$', ''
            $profile.identity.base_url = $rawUrl -replace '(/[^/]*)$', ''
            Write-Host "  [WARN] Could not parse URL '$rawUrl' -- likely a placeholder. Fill site.config.json." -ForegroundColor Yellow
        }
    }

    # Site name
    $profile.identity.site_name = Extract-MetaContent $indexHtml 'og:site_name'
    if (-not $profile.identity.site_name) {
        $titleTag = Extract-TagContent $indexHtml 'title'
        if ($titleTag) {
            $parts = $titleTag -split '\s*[\|~\-]\s*'
            $profile.identity.site_name = $parts[0].Trim()
        }
    }

    # Site description
    $profile.identity.site_description = Extract-MetaContent $indexHtml 'description'
    $profile.identity.og_description   = Extract-MetaContent $indexHtml 'og:description'

    # Title tag
    $profile.identity.title_tag = Extract-TagContent $indexHtml 'title'

    # H1
    $profile.identity.h1 = Extract-TagContent $indexHtml 'h1'
} else {
    Write-Host "  [WARN] No root index.html found" -ForegroundColor Yellow
}

# ============================================================
# 3. EXTRACT ANALYTICS IDs FROM ANY HTML
# ============================================================
foreach ($f in $htmlFiles) {
    $html = Get-Content -Raw -Path $f.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $html) { continue }

    if (-not $profile.analytics.ga4_id) {
        $m = [regex]::Match($html, 'G-[A-Z0-9]{6,12}')
        if ($m.Success) { $profile.analytics.ga4_id = $m.Value }
    }
    if (-not $profile.analytics.gtm_id) {
        $m = [regex]::Match($html, 'GTM-[A-Z0-9]{5,8}')
        if ($m.Success) { $profile.analytics.gtm_id = $m.Value }
    }
    if (-not $profile.analytics.clarity_id) {
        $m = [regex]::Match($html, 'clarity\.ms/tag/([a-z0-9]+)')
        if ($m.Success) { $profile.analytics.clarity_id = $m.Groups[1].Value }
    }

    if ($profile.analytics.ga4_id -and $profile.analytics.gtm_id -and $profile.analytics.clarity_id) { break }
}

# ============================================================
# 4. EXTRACT SOCIAL HANDLES
# ============================================================
$allHtml = ($htmlFiles | ForEach-Object { Get-Content -Raw -Path $_.FullName -Encoding UTF8 -ErrorAction SilentlyContinue }) -join "`n"

$socialPatterns = @{
    facebook  = 'facebook\.com/(\w[\w.]+)'
    twitter   = '(?:twitter\.com|x\.com)/(\w+)'
    instagram = 'instagram\.com/(\w[\w.]+)'
    linkedin  = 'linkedin\.com/(?:company|in)/([\w-]+)'
    youtube   = 'youtube\.com/(?:@|channel/|c/)([\w-]+)'
    pinterest = 'pinterest\.com/(\w+)'
    tiktok    = 'tiktok\.com/@(\w[\w.]+)'
}
foreach ($platform in $socialPatterns.Keys) {
    $m = [regex]::Match($allHtml, $socialPatterns[$platform])
    if ($m.Success) { $profile.social[$platform] = $m.Groups[1].Value }
}

$twitterSite = Extract-MetaContent $allHtml 'twitter:site'
if ($twitterSite) { $profile.social.twitter_handle = $twitterSite }

# ============================================================
# 5. ANALYZE BLOG STRUCTURE
# ============================================================
$blogDir = Get-ChildItem -Path $WebsitePath -Directory -Recurse |
    Where-Object { $_.Name -eq 'blog' } | Select-Object -First 1

if ($blogDir) {
    Write-Host "  Analyzing blog/ directory..." -ForegroundColor Gray
    $blogHtmlFiles = Get-ChildItem -Path $blogDir.FullName -Filter '*.html' |
        Where-Object { $_.Name -ne 'index.html' }

    $profile.blog.directory   = $blogDir.FullName -replace [regex]::Escape($WebsitePath), ''
    $profile.blog.post_count  = $blogHtmlFiles.Count
    $profile.blog.posts       = @()

    # Analyze blog index for card pattern
    $blogIndex = Join-Path $blogDir.FullName 'index.html'
    if (Test-Path $blogIndex) {
        $blogIndexHtml = Get-Content -Raw -Path $blogIndex -Encoding UTF8
        $cardClasses = @()
        $cardMatches = MatchAll-ClassPattern $blogIndexHtml 'card'
        foreach ($m in $cardMatches) {
            $cls = $m.Groups[1].Value
            if ($cls -notmatch 'nav|menu|footer|header') { $cardClasses += $cls }
        }
        $profile.blog.card_classes = ($cardClasses | Sort-Object -Unique)
    }

    # Analyze individual blog posts
    $largestPost = $null
    $largestSize = 0
    foreach ($post in $blogHtmlFiles) {
        $postHtml = Get-Content -Raw -Path $post.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
        if (-not $postHtml) { continue }

        $slug  = $post.BaseName
        $title = Extract-TagContent $postHtml 'title'
        $h1    = Extract-TagContent $postHtml 'h1'

        $profile.blog.posts += @{
            slug        = $slug
            title       = if ($title) { $title } else { $h1 }
            file        = $post.Name
            size_bytes  = $post.Length
        }

        if ($post.Length -gt $largestSize) {
            $largestSize = $post.Length
            $largestPost = $post.Name
        }

        # Extract structural patterns from the first post analyzed
        if (-not $profile.blog.html_patterns) {
            $profile.blog.html_patterns = @{}

            $m = Match-ClassPattern $postHtml 'article'
            if ($m.Success) { $profile.blog.html_patterns.article_content_class = $m.Groups[1].Value }

            $m = Match-ClassPattern $postHtml 'tldr'
            if ($m.Success) { $profile.blog.html_patterns.tldr_class = $m.Groups[1].Value }

            $m = Match-ClassPattern $postHtml 'faq'
            if ($m.Success) { $profile.blog.html_patterns.faq_class = $m.Groups[1].Value }

            $m = Match-ClassPattern $postHtml 'related'
            if ($m.Success) { $profile.blog.html_patterns.related_posts_class = $m.Groups[1].Value }

            $m = Match-ClassPattern $postHtml 'cta'
            if ($m.Success) { $profile.blog.html_patterns.cta_class = $m.Groups[1].Value }

            $m = Match-ClassPattern $postHtml 'topbar'
            $profile.blog.html_patterns.has_topbar    = $m.Success
            $profile.blog.html_patterns.has_mobile_nav = ($postHtml -match 'mobile-nav')

            $m = Match-ClassPattern $postHtml 'breadcrumb'
            if ($m.Success) { $profile.blog.html_patterns.breadcrumb_class = $m.Groups[1].Value }
        }
    }

    $profile.scaffold.best_source_post = $largestPost
} else {
    Write-Host "  [WARN] No blog/ directory found" -ForegroundColor Yellow
}

# ============================================================
# 6. ANALYZE SERVICE PAGES
# ============================================================
$servicesDirs = Get-ChildItem -Path $WebsitePath -Directory -Recurse |
    Where-Object { $_.Name -match '^(pages|services)$' } | Select-Object -First 1

if ($servicesDirs) {
    Write-Host "  Analyzing services/pages directory..." -ForegroundColor Gray
    $serviceFiles = Get-ChildItem -Path $servicesDirs.FullName -Filter '*.html' |
        Where-Object { $_.Name -ne 'index.html' }

    $profile.services.directory  = $servicesDirs.FullName -replace [regex]::Escape($WebsitePath), ''
    $profile.services.page_count = $serviceFiles.Count
    $profile.services.pages      = @()

    $largestService = $null
    $largestServiceSize = 0
    foreach ($svc in $serviceFiles) {
        $svcHtml = Get-Content -Raw -Path $svc.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
        if (-not $svcHtml) { continue }

        $title = Extract-TagContent $svcHtml 'title'
        $h1    = Extract-TagContent $svcHtml 'h1'

        $profile.services.pages += @{
            slug  = $svc.BaseName
            title = if ($title) { $title } else { $h1 }
            file  = $svc.Name
        }

        if ($svc.Length -gt $largestServiceSize) {
            $largestServiceSize = $svc.Length
            $largestService = $svc.Name
        }
    }
    $profile.scaffold.best_service_source = $largestService
}

# ============================================================
# 7. EXTRACT BRAND PALETTE FROM CSS
# ============================================================
$cssFiles = Get-ChildItem -Path $WebsitePath -Recurse -Include '*.css' |
    Where-Object { $_.FullName -notmatch 'node_modules' }

$cssColors = @{}
$cssVars   = @{}
$rxCssVar   = New-Object regex('--(\w[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8})')
$rxCssColor = New-Object regex('(?:background|color|border-color|fill|stroke)\s*:\s*(#[0-9a-fA-F]{3,8})')

foreach ($cssFile in $cssFiles) {
    $css = Get-Content -Raw -Path $cssFile.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $css) { continue }

    foreach ($m in $rxCssVar.Matches($css)) {
        $cssVars[$m.Groups[1].Value] = $m.Groups[2].Value
    }
    foreach ($m in $rxCssColor.Matches($css)) {
        $hex = $m.Groups[1].Value.ToUpper()
        if (-not $cssColors.ContainsKey($hex)) { $cssColors[$hex] = 0 }
        $cssColors[$hex]++
    }
}

$profile.brand.css_variables = $cssVars
$profile.brand.top_colors = ($cssColors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 12 |
    ForEach-Object { @{ hex = $_.Key; usage_count = $_.Value } })

$profile.structure.css_files = ($cssFiles | ForEach-Object {
    $_.FullName -replace [regex]::Escape($WebsitePath), ''
})

# ============================================================
# 8. DETECT FAVICON PATHS
# ============================================================
$rxFavicon     = New-Object regex('href="(\S*favicon\S*)"')
$rxFaviconVar  = New-Object regex('href="(\S*favicon-\S*)"')
$rxAppleTouch  = New-Object regex('href="(\S*apple-touch-icon\S*)"')
$rxWebmanifest = New-Object regex('href="(\S*webmanifest\S*)"')

$m = $rxFavicon.Match($allHtml)
if ($m.Success) { $profile.favicon.ico = $m.Groups[1].Value }
foreach ($m in $rxFaviconVar.Matches($allHtml)) {
    if (-not $profile.favicon.variants) { $profile.favicon.variants = @() }
    $profile.favicon.variants += $m.Groups[1].Value
}
$m = $rxAppleTouch.Match($allHtml)
if ($m.Success) { $profile.favicon.apple_touch_icon = $m.Groups[1].Value }
$m = $rxWebmanifest.Match($allHtml)
if ($m.Success) { $profile.favicon.webmanifest = $m.Groups[1].Value }

# ============================================================
# 9. DETECT DIRECTORY STRUCTURE
# ============================================================
$profile.structure.directories = (Get-ChildItem -Path $WebsitePath -Directory -Recurse |
    Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' -and $_.FullName -notmatch 'node_modules' } |
    ForEach-Object { $_.FullName -replace [regex]::Escape($WebsitePath), '' })

$profile.structure.js_files = (Get-ChildItem -Path $WebsitePath -Recurse -Filter '*.js' |
    Where-Object { $_.FullName -notmatch 'node_modules' } |
    ForEach-Object { $_.FullName -replace [regex]::Escape($WebsitePath), '' })

# ============================================================
# 10. NICHE / AUDIENCE HINTS
# ============================================================
$nicheHints = @()
if ($profile.identity.site_description) { $nicheHints += "site_description: $($profile.identity.site_description)" }
if ($profile.identity.h1)               { $nicheHints += "h1: $($profile.identity.h1)" }
if ($profile.identity.og_description)   { $nicheHints += "og_description: $($profile.identity.og_description)" }

$profile.identity.niche_hints    = $nicheHints
$profile.identity.audience_hints = @()
$profile.identity._note = "NICHE and AUDIENCE must be set manually in site.config.json. These hints are from the site content to help you decide."

# ============================================================
# OUTPUT
# ============================================================
$json = $profile | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "=== PROFILE GENERATED ===" -ForegroundColor Green
Write-Host "  Output:       $OutputPath" -ForegroundColor White
Write-Host "  HTML files:   $($htmlFiles.Count)" -ForegroundColor White
Write-Host "  Blog posts:   $($profile.blog.post_count)" -ForegroundColor White
Write-Host "  Service pages:$($profile.services.page_count)" -ForegroundColor White
Write-Host "  CSS variables: $($cssVars.Count)" -ForegroundColor White
Write-Host "  Domain:       $($profile.identity.domain)" -ForegroundColor White
Write-Host "  Site name:    $($profile.identity.site_name)" -ForegroundColor White
Write-Host "  GA4:          $($profile.analytics.ga4_id)" -ForegroundColor White
Write-Host "  Best source:  $($profile.scaffold.best_source_post)" -ForegroundColor White
Write-Host ""
Write-Host "  Next: Review website-profile.json, fill site.config.json, then run:" -ForegroundColor Yellow
Write-Host "    pwsh ./setup/inject-skills.ps1" -ForegroundColor Gray
Write-Host ""
