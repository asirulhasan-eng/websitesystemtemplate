<#
.SYNOPSIS
  Scaffold a new blog post by cloning header/footer from an existing post.

.DESCRIPTION
  Creates a new blog HTML file with:
    - Full <head> (meta, OG, Twitter, schema, stylesheets)
    - Topbar, header nav, mobile nav (copied verbatim)
    - Article header with breadcrumbs, category, title, date, read-time
    - TLDR placeholder + PART markers for fragmented content injection
    - Full footer + scripts (copied verbatim)
  All post-specific values (title, slug, date, category, description,
  read-time) are injected programmatically from parameters.

.PARAMETER Title
  The full blog post title (used in <title>, <h1>, schema, OG, etc.).

.PARAMETER Slug
  URL-safe slug. Auto-generated from Title if omitted.

.PARAMETER Category
  Short category label (e.g. "Local SEO", "Google Maps").

.PARAMETER Description
  Meta description (<=155 chars recommended).

.PARAMETER ReadTime
  Estimated read time (default: "8 min read").

.PARAMETER SourcePost
  Filename of the blog post to clone header/footer from.
  Defaults to the most recently modified .html in blog/.

.PARAMETER Date
  Publish date. Defaults to today (e.g. "May 18, 2026").

.EXAMPLE
  .\scaffold-blog.ps1 -Title "How to Win More {{NICHE}} Jobs With Google Ads" -Category "PPC" -Description "A practical guide to Google Ads for {{NICHE}} companies."
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Title,

    [string]$Slug,

    [string]$Category = "SEO Guide",

    [string]$Description = "",

    [string]$ReadTime = "8 min read",

    [string]$SourcePost,

    [string]$Date
)

# ============================================================
# CONFIG
# ============================================================
$ErrorActionPreference = 'Stop'
$blogDir   = Join-Path $PSScriptRoot '..\blog'
$blogDir   = (Resolve-Path $blogDir).Path
$logFile   = Join-Path $PSScriptRoot 'scaffold-blog.log'
$today     = Get-Date
$isoDate   = $today.ToString('yyyy-MM-dd')

# ============================================================
# LOGGING
# ============================================================
function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $entry = "[$ts] [$Level] $Message"
    Add-Content -Path $logFile -Value $entry -Encoding UTF8
    if ($Level -eq 'ERROR') { Write-Host "[ERROR] $Message" -ForegroundColor Red }
    elseif ($Level -eq 'WARN')  { Write-Host "[WARN]  $Message" -ForegroundColor Yellow }
    else                        { Write-Host "[OK]    $Message" -ForegroundColor Green }
}

Write-Log 'INFO' '========== scaffold-blog.ps1 START =========='
Write-Log 'INFO' "Title: $Title"

# ============================================================
# 1. GENERATE SLUG (if not provided)
# ============================================================
if (-not $Slug) {
    $Slug = $Title.ToLower() `
        -replace '[^a-z0-9\s-]', '' `
        -replace '\s+', '-' `
        -replace '-+', '-' `
        -replace '(^-|-$)', ''
    Write-Log 'INFO' "Auto-generated slug: $Slug"
} else {
    Write-Log 'INFO' "Using provided slug: $Slug"
}

# ============================================================
# 2. CHECK IF FILE ALREADY EXISTS
# ============================================================
$outputFile = Join-Path $blogDir "$Slug.html"
if (Test-Path $outputFile) {
    Write-Log 'ERROR' "File already exists: $outputFile"
    Write-Log 'ERROR' 'Aborting to prevent overwrite. Delete the file first or use a different slug.'
    throw "File already exists: $outputFile"
}

# ============================================================
# 3. SET DATE
# ============================================================
if (-not $Date) {
    $Date = $today.ToString('MMMM d, yyyy')
    Write-Log 'INFO' "Using today''s date: $Date"
} else {
    Write-Log 'INFO' "Using provided date: $Date"
}

# ============================================================
# 4. FIND SOURCE POST
# ============================================================
# Default to a known-good reference post for reliable extraction
$defaultSource = 'google-maps-seo-for-{{AUDIENCE}}.html'

if (-not $SourcePost) {
    $defaultPath = Join-Path $blogDir $defaultSource
    if (Test-Path $defaultPath) {
        $sourceFile = $defaultPath
        Write-Log 'INFO' "Using default reference post: $defaultSource"
    } else {
        # Fallback: pick the largest .html file (most likely to be complete)
        $candidates = Get-ChildItem -Path $blogDir -Filter '*.html' |
            Where-Object { $_.Name -ne 'index.html' -and $_.Name -ne "$Slug.html" -and $_.Name -ne 'test-scaffold-validation.html' } |
            Sort-Object Length -Descending
        if ($candidates.Count -eq 0) {
            Write-Log 'ERROR' 'No existing blog posts found to clone from.'
            throw 'No source post available.'
        }
        $sourceFile = $candidates[0].FullName
        Write-Log 'INFO' "Fallback source post: $($candidates[0].Name)"
    }
} else {
    $sourceFile = Join-Path $blogDir $SourcePost
    if (-not (Test-Path $sourceFile)) {
        Write-Log 'ERROR' "Source post not found: $sourceFile"
        throw "Source post not found: $sourceFile"
    }
    Write-Log 'INFO' "Using provided source post: $SourcePost"
}

# ============================================================
# 5. READ SOURCE POST
# ============================================================
try {
    $sourceContent = Get-Content -Path $sourceFile -Raw -Encoding UTF8
    $sourceLines   = Get-Content -Path $sourceFile -Encoding UTF8
    Write-Log 'INFO' "Source post loaded: $($sourceLines.Count) lines"
} catch {
    Write-Log 'ERROR' "Failed to read source post: $_"
    throw
}

# ============================================================
# 6. EXTRACT SECTIONS FROM SOURCE
# ============================================================
# Strategy: find line indices using actual HTML element patterns
# (not comments which vary between posts).
# We extract:
#   A) TOPBAR + HEADER + MOBILE NAV  (from topbar div to just before <main>)
#   B) FOOTER + SCRIPTS              (from <footer to </body>)

# --- Find line indices ---
$topbarStart  = -1
$mainStart    = -1
$footerStart  = -1
$footerEnd    = -1
$bodyEnd      = -1

for ($i = 0; $i -lt $sourceLines.Count; $i++) {
    $line = $sourceLines[$i]
    # Topbar: look for the actual topbar div or its comment
    if ($topbarStart -eq -1 -and ($line -match 'class="topbar"' -or $line -match 'TOP BAR')) {
        # If it is a comment line, use it; otherwise back up 1 line for the comment
        if ($line -match '<!--') { $topbarStart = $i }
        else { $topbarStart = [Math]::Max(0, $i - 1) }
    }
    # Main: first occurrence of <main> tag
    if ($mainStart -eq -1 -and $line -match '^\s*<main') { $mainStart = $i }
    # Footer: first occurrence of <footer tag (not </footer>)
    if ($footerStart -eq -1 -and $line -match '<footer\s' -and $line -notmatch '</footer') {
        # Check if there is a comment line above it
        if ($i -gt 0 -and $sourceLines[$i - 1] -match '<!--.*FOOTER') {
            $footerStart = $i - 1
        } else {
            $footerStart = $i
        }
    }
    # Footer end: </footer> tag
    if ($line -match '^\s*</footer>') { $footerEnd = $i }
    # Body end: </body> tag
    if ($line -match '^\s*</body>') { $bodyEnd = $i }
}

# Validate all boundaries found
$missing = @()
if ($topbarStart -eq -1) { $missing += 'topbar element' }
if ($mainStart   -eq -1) { $missing += '<main> tag' }
if ($footerStart -eq -1) { $missing += '<footer> tag' }
if ($footerEnd   -eq -1) { $missing += '</footer> tag' }
if ($bodyEnd     -eq -1) { $missing += '</body> tag' }

if ($missing.Count -gt 0) {
    Write-Log 'ERROR' "Could not locate structural boundaries in source: $($missing -join ', ')"
    Write-Log 'ERROR' "Source file may have non-standard structure. Use -SourcePost to specify a known-good post."
    throw "Missing boundaries: $($missing -join ', ')"
}

# Sanity check ordering
if ($topbarStart -ge $mainStart -or $mainStart -ge $footerStart -or $footerStart -ge $footerEnd -or $footerEnd -ge $bodyEnd) {
    Write-Log 'ERROR' "Boundary ordering invalid: TopBar:$topbarStart Main:$mainStart Footer:$footerStart FooterEnd:$footerEnd BodyEnd:$bodyEnd"
    Write-Log 'ERROR' "Source HTML structure is malformed. Use -SourcePost to specify a known-good post (e.g. $defaultSource)."
    throw "Boundary ordering invalid in source file."
}

Write-Log 'INFO' "Boundaries found - TopBar:$topbarStart  Main:$mainStart  Footer:$footerStart  FooterEnd:$footerEnd  BodyEnd:$bodyEnd"

# Extract the nav block (topbar -> just before <main>)
$navBlock = ($sourceLines[$topbarStart..($mainStart - 1)]) -join "`r`n"

# Extract footer + scripts (footer tag -> just before </body>)
$footerAndScriptsBlock = ($sourceLines[$footerStart..($bodyEnd - 1)]) -join "`r`n"

# Strip any post-specific FAQPage schema from the footer/scripts block
# (AI will inject a new one per post)
$footerAndScriptsBlock = $footerAndScriptsBlock -replace '(?s)<script type="application/ld\+json">\s*\{[^}]*"@type"\s*:\s*"FAQPage".*?</script>', ''

Write-Log 'INFO' "Extracted nav block: $($navBlock.Split("`n").Count) lines"
Write-Log 'INFO' "Extracted footer+scripts block (FAQ schema stripped)"

# ============================================================
# 7. BUILD THE SCAFFOLDED HTML
# ============================================================
# Escape description for HTML attributes
$descEscaped = $Description -replace '"', '&quot;'

# Use provided description or a placeholder
if (-not $Description) {
    $descEscaped = "TODO: Write meta description for $Title"
    Write-Log 'WARN' 'No description provided. Using placeholder.'
}

$scaffoldHtml = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "ww29j18bkr");
  </script>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-H9RD5BVGR8"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-H9RD5BVGR8');
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>$Title</title>
  <meta name="description" content="$descEscaped">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://{{DOMAIN}}/blog/$Slug">

  <!-- Open Graph -->
  <meta property="og:title" content="$Title">
  <meta property="og:description" content="$descEscaped">
  <meta property="og:url" content="https://{{DOMAIN}}/blog/$Slug">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="{{SITE_NAME}}.agency">
  <meta property="og:locale" content="en_US">
  <meta property="og:image" content="https://{{DOMAIN}}/assets/images/blog/$Slug-og.webp">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@clientagen">
  <meta name="twitter:title" content="$Title">
  <meta name="twitter:description" content="$descEscaped">
  <meta name="twitter:image" content="https://{{DOMAIN}}/assets/images/blog/$Slug-og.webp">

  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://www.google-analytics.com">

  <link rel="stylesheet" href="../css/main.css">
  <link rel="stylesheet" href="../css/blog.css">
  <link rel="stylesheet" href="/css/floating-cta.css?v=1">

  <!-- Favicon -->
  <link rel="icon" type="image/x-icon" href="/assets/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.webp">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.webp">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.webp">
  <link rel="manifest" href="/assets/site.webmanifest">
  <meta name="theme-color" content="#0F2A44">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "$Title",
    "description": "$descEscaped",
    "url": "https://{{DOMAIN}}/blog/$Slug",
    "datePublished": "$isoDate",
    "dateModified": "$isoDate",
    "author": {
      "@type": "Organization",
      "name": "{{SITE_NAME}}.agency",
      "url": "https://{{DOMAIN}}",
      "logo": {
        "@type": "ImageObject",
        "url": "https://{{DOMAIN}}/{{NICHE}}-seo-agency-logo-200.webp"
      },
      "sameAs": [
        "https://www.facebook.com/clientagency/",
        "https://www.youtube.com/@{{SITE_NAME}}Agency",
        "https://www.instagram.com/{{NICHE}}_seoagency/",
        "https://x.com/clientagen",
        "https://www.linkedin.com/company/{{NICHE}}-seo-agency",
        "https://www.pinterest.com/client/",
        "https://medium.com/@{{DOMAIN}}",
        "https://substack.com/@clientagency"
      ]
    },
    "publisher": {
      "@type": "Organization",
      "name": "{{SITE_NAME}}.agency",
      "url": "https://{{DOMAIN}}",
      "logo": {
        "@type": "ImageObject",
        "url": "https://{{DOMAIN}}/{{NICHE}}-seo-agency-logo-200.webp"
      },
      "sameAs": [
        "https://www.facebook.com/clientagency/",
        "https://www.youtube.com/@{{SITE_NAME}}Agency",
        "https://www.instagram.com/{{NICHE}}_seoagency/",
        "https://x.com/clientagen",
        "https://www.linkedin.com/company/{{NICHE}}-seo-agency",
        "https://www.pinterest.com/client/",
        "https://medium.com/@{{DOMAIN}}",
        "https://substack.com/@clientagency"
      ]
    },
    "mainEntityOfPage": "https://{{DOMAIN}}/blog/$Slug",
    "image": "https://{{DOMAIN}}/assets/images/blog/$Slug-og.webp"
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://{{DOMAIN}}/"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Blog",
        "item": "https://{{DOMAIN}}/blog/"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "$Title",
        "item": "https://{{DOMAIN}}/blog/$Slug"
      }
    ]
  }
  </script>
</head>
<body>
  <!--
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  -->

  $navBlock

  <main>
    <article>
      <!-- ARTICLE HEADER -->
      <header class="article-header">
        <div class="container">
          <div class="breadcrumbs" style="justify-content: center; margin-bottom: var(--space-4);">
            <a href="../">Home</a> <span>/</span> <a href="./">Blog</a> <span>/</span> $Category
          </div>
          <div class="article-header__meta">$Category</div>
          <h1 class="article-header__title">$Title</h1>
          <div class="article-header__author">
            <span>Published $Date</span> &bull; <span>$ReadTime</span>
          </div>
        </div>
      </header>

      <div class="article-layout">
        <div class="container">
          <div class="article-container article-content">

            <!-- TLDR -->
            <div class="tldr-box">
              <div class="tldr-box__label">The Bottom Line for Busy {{AUDIENCE}}</div>
              <ul>
                <li><!-- TLDR_ITEM_1 --></li>
                <li><!-- TLDR_ITEM_2 --></li>
                <li><!-- TLDR_ITEM_3 --></li>
              </ul>
            </div>

            <!-- ============================================ -->
            <!-- CONTENT STARTS HERE                         -->
            <!-- Use PART markers for fragmented injection   -->
            <!-- ============================================ -->

            <!-- PART1_MARKER -->

            <!-- PART2_MARKER -->

            <!-- PART3_MARKER -->

            <!-- ============================================ -->
            <!-- FAQ SECTION (inject FAQ accordion here)     -->
            <!-- ============================================ -->
            <!-- FAQ_MARKER -->

            <!-- ============================================ -->
            <!-- RELATED POSTS (inject 3 sibling links)      -->
            <!-- ============================================ -->
            <!-- RELATED_POSTS_MARKER -->

            <!-- ============================================ -->
            <!-- BOTTOM CTA                                  -->
            <!-- ============================================ -->
            <!-- CTA_MARKER -->

          </div>
        </div>
      </div>
    </article>
  </main>

  $footerAndScriptsBlock

  <!-- ============================================ -->
  <!-- FAQPage Schema (inject after content done)  -->
  <!-- ============================================ -->
  <!-- FAQSCHEMA_MARKER -->

</body>
</html>
"@

# ============================================================
# 8. WRITE THE FILE
# ============================================================
try {
    # Ensure consistent line endings (CRLF for Windows)
    $scaffoldHtml = $scaffoldHtml -replace "`r?`n", "`r`n"
    [System.IO.File]::WriteAllText($outputFile, $scaffoldHtml, [System.Text.UTF8Encoding]::new($false))
    Write-Log 'INFO' "Scaffolded blog post written: $outputFile"
} catch {
    Write-Log 'ERROR' "Failed to write output file: $_"
    throw
}

# ============================================================
# 9. VALIDATE OUTPUT
# ============================================================
$validation = @()
$outputContent = Get-Content -Path $outputFile -Raw -Encoding UTF8

# Check critical elements exist
if ($outputContent -notmatch '<!DOCTYPE html>')           { $validation += 'Missing <!DOCTYPE html>' }
if ($outputContent -notmatch '<html lang="en">')          { $validation += 'Missing <html lang="en">' }
if ($outputContent -notmatch '</head>')                   { $validation += 'Missing </head>' }
if ($outputContent -notmatch '<body>')                    { $validation += 'Missing <body>' }
if ($outputContent -notmatch '</body>')                   { $validation += 'Missing </body>' }
if ($outputContent -notmatch '</html>')                   { $validation += 'Missing </html>' }
if ($outputContent -notmatch '<main>')                    { $validation += 'Missing <main>' }
if ($outputContent -notmatch '</main>')                   { $validation += 'Missing </main>' }
if ($outputContent -notmatch '<footer')                   { $validation += 'Missing <footer>' }
if ($outputContent -notmatch '</footer>')                 { $validation += 'Missing </footer>' }
if ($outputContent -notmatch 'class="header"')            { $validation += 'Missing site header' }
if ($outputContent -notmatch 'class="topbar"')            { $validation += 'Missing topbar' }
if ($outputContent -notmatch 'mobile-nav')                { $validation += 'Missing mobile nav' }
if ($outputContent -notmatch 'PART1_MARKER')              { $validation += 'Missing PART1_MARKER' }
if ($outputContent -notmatch 'PART2_MARKER')              { $validation += 'Missing PART2_MARKER' }
if ($outputContent -notmatch 'PART3_MARKER')              { $validation += 'Missing PART3_MARKER' }
if ($outputContent -notmatch 'FAQ_MARKER')                { $validation += 'Missing FAQ_MARKER' }
if ($outputContent -notmatch 'RELATED_POSTS_MARKER')      { $validation += 'Missing RELATED_POSTS_MARKER' }
if ($outputContent -notmatch 'CTA_MARKER')                { $validation += 'Missing CTA_MARKER' }
if ($outputContent -notmatch 'FAQSCHEMA_MARKER')          { $validation += 'Missing FAQSCHEMA_MARKER' }
if ($outputContent -notmatch [regex]::Escape($Title))     { $validation += 'Title not found in output' }
if ($outputContent -notmatch [regex]::Escape($Slug))      { $validation += 'Slug not found in output' }
if ($outputContent -notmatch 'BlogPosting')               { $validation += 'Missing BlogPosting schema' }
if ($outputContent -notmatch 'BreadcrumbList')             { $validation += 'Missing BreadcrumbList schema' }
if ($outputContent -notmatch 'og:title')                  { $validation += 'Missing og:title' }
if ($outputContent -notmatch 'twitter:card')              { $validation += 'Missing twitter:card' }
if ($outputContent -notmatch '/css/floating-cta\.css\?v=1') { $validation += 'Missing floating CTA stylesheet' }
if ($outputContent -notmatch '/js/floating-cta\.js\?v=1')    { $validation += 'Missing floating CTA script' }
if ($outputContent -notmatch 'G-H9RD5BVGR8')             { $validation += 'Missing Google Analytics tag' }

# Check for .html in URLs (GOLDEN RULE violation)
$htmlLinkMatches = [regex]::Matches($outputContent, 'href="[^"]*\.html"')
$violations = @()
foreach ($m in $htmlLinkMatches) {
    $val = $m.Value
    # Allow relative stylesheet links and source post references
    if ($val -match '\.css"' -or $val -match 'favicon' -or $val -match 'webmanifest') { continue }
    $violations += $val
}
if ($violations.Count -gt 0) {
    foreach ($v in $violations) {
        $validation += "GOLDEN RULE: .html in link -> $v"
    }
}

if ($validation.Count -gt 0) {
    Write-Log 'WARN' "Validation issues ($($validation.Count)):"
    foreach ($issue in $validation) {
        Write-Log 'WARN' "  - $issue"
    }
} else {
    Write-Log 'INFO' 'All validation checks passed.'
}

# ============================================================
# 10. SUMMARY
# ============================================================
$lineCount = (Get-Content $outputFile).Count
Write-Log 'INFO' "========== SCAFFOLD COMPLETE =========="
Write-Log 'INFO' "  File:      $outputFile"
Write-Log 'INFO' "  Slug:      $Slug"
Write-Log 'INFO' "  Title:     $Title"
Write-Log 'INFO' "  Category:  $Category"
Write-Log 'INFO' "  Date:      $Date"
Write-Log 'INFO' "  Lines:     $lineCount"
Write-Log 'INFO' "  Source:    $(Split-Path $sourceFile -Leaf)"

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  SCAFFOLD COMPLETE' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "  File:  blog/$Slug.html" -ForegroundColor White
Write-Host "  Lines: $lineCount" -ForegroundColor White
Write-Host ''
Write-Host '  Next steps for AI:' -ForegroundColor Yellow
Write-Host '  1. Replace TLDR_ITEM_1/2/3 placeholders' -ForegroundColor Gray
Write-Host '  2. Inject content at PART1_MARKER' -ForegroundColor Gray
Write-Host '  3. Inject content at PART2_MARKER' -ForegroundColor Gray
Write-Host '  4. Inject content at PART3_MARKER' -ForegroundColor Gray
Write-Host '  5. Inject FAQ accordion at FAQ_MARKER' -ForegroundColor Gray
Write-Host '  6. Inject related posts at RELATED_POSTS_MARKER' -ForegroundColor Gray
Write-Host '  7. Inject bottom CTA at CTA_MARKER' -ForegroundColor Gray
Write-Host '  8. Inject FAQPage schema at FAQSCHEMA_MARKER' -ForegroundColor Gray
Write-Host '  9. Update blog/index.html, sitemap.xml, link-registry.json' -ForegroundColor Gray
Write-Host ''

# Return structured output for programmatic consumption
return @{
    Success    = $true
    OutputFile = $outputFile
    Slug       = $Slug
    Title      = $Title
    Category   = $Category
    Date       = $Date
    IsoDate    = $isoDate
    LineCount  = $lineCount
    SourcePost = (Split-Path $sourceFile -Leaf)
    Validation = $validation
    Markers    = @(
        'TLDR_ITEM_1', 'TLDR_ITEM_2', 'TLDR_ITEM_3',
        'PART1_MARKER', 'PART2_MARKER', 'PART3_MARKER',
        'FAQ_MARKER', 'RELATED_POSTS_MARKER', 'CTA_MARKER',
        'FAQSCHEMA_MARKER'
    )
}
