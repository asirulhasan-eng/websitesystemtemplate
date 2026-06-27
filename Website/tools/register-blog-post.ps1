<#
.SYNOPSIS
  Register a blog post across a static website.

.DESCRIPTION
  Adds a blog card to blog/index.html, sorts the blog index latest-first, adds a
  sitemap entry, and appends metadata to tools/link-registry.json.

  The script is intentionally generic. It does not hardcode a client/site domain.
  Provide -BaseUrl, set WEBSITE_AGENT_BASE_URL / WEBSITE_BASE_URL / SITE_BASE_URL,
  or keep a concrete homepage <loc> in sitemap.xml so the script can infer it.

  Do not add blog clean-URL rewrites to _redirects when your host already resolves
  /blog/[slug] to /blog/[slug].html. Explicit rewrites can create redirect loops.

  The script is idempotent: if an entry already exists, it skips that entry instead
  of duplicating it.

.PARAMETER Slug
  URL-safe blog slug. Accepts "my-post", "/blog/my-post", or "my-post.html".

.PARAMETER Title
  Blog post title used in the blog index card and link registry.

.PARAMETER Category
  Short category label displayed on the card.

.PARAMETER Excerpt
  One or two sentence blog index excerpt.

.PARAMETER Date
  Display date for the card. Defaults to today's date.

.PARAMETER LastMod
  ISO date for sitemap lastmod. Defaults to today's date. Must be YYYY-MM-DD.

.PARAMETER BaseUrl
  Site origin, for example https://example.com. If omitted, the script checks
  WEBSITE_AGENT_BASE_URL, WEBSITE_BASE_URL, SITE_BASE_URL, then sitemap.xml.

.PARAMETER Topics
  Topic tags added to tools/link-registry.json.

.PARAMETER Anchors
  Suggested internal-link anchors added to tools/link-registry.json.

.PARAMETER UseHtmlLinksInIndex
  Use /blog/[slug].html in blog/index.html. Use only for local static preview.
  Default is the clean live SEO URL: /blog/[slug].

.PARAMETER NoRedirect
  Deprecated. Blog redirects are not added by default because many static hosts
  already resolve clean blog URLs.

.PARAMETER NoSitemap
  Skip sitemap.xml update. Use for noindex placeholder posts.

.PARAMETER NoLinkRegistry
  Skip tools/link-registry.json update. Use for noindex placeholder posts.

.PARAMETER ImageSrc
  Optional image URL/path for the card image area. If omitted, a default inline
  checklist icon is used.

.PARAMETER ImageAlt
  Alt text for ImageSrc.

.EXAMPLE
  ./register-blog-post.ps1 `
    -Slug "roofing-seo-pricing" `
    -Title "Roofing SEO Pricing: What Should You Pay For?" `
    -Category "SEO Pricing" `
    -Excerpt "Learn what to expect from transparent SEO pricing, deliverables, and monthly work." `
    -BaseUrl "https://example.com"

.EXAMPLE
  ./register-blog-post.ps1 `
    -Slug "sample-local-seo-checklist" `
    -Title "Sample Local SEO Checklist" `
    -Category "Local SEO" `
    -Excerpt "A short placeholder article for previewing the blog layout." `
    -UseHtmlLinksInIndex `
    -NoSitemap `
    -NoLinkRegistry
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Slug,

    [Parameter(Mandatory=$true)]
    [string]$Title,

    [string]$Category = "Website SEO",

    [Parameter(Mandatory=$true)]
    [string]$Excerpt,

    [string]$Date,

    [string]$LastMod,

    [string]$BaseUrl,

    [string[]]$Topics = @("website SEO", "content marketing", "organic search"),

    [string[]]$Anchors = @("website SEO services", "organic search checklist", "content visibility audit"),

    [switch]$UseHtmlLinksInIndex,

    [switch]$NoRedirect,

    [switch]$NoSitemap,

    [switch]$NoLinkRegistry,

    [string]$ImageSrc,

    [string]$ImageAlt = ""
)

$ErrorActionPreference = 'Stop'

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$blogIndexPath = Join-Path $rootDir 'blog/index.html'
$redirectsPath = Join-Path $rootDir '_redirects'
$sitemapPath = Join-Path $rootDir 'sitemap.xml'
$registryPath = Join-Path $PSScriptRoot 'link-registry.json'
$indexMarker = '<!-- ADD NEW BLOG CARDS ABOVE THIS LINE -->'
$sitemapMarker = '<!-- Blog Posts: Add new posts below this line -->'

if (-not $Date) { $Date = (Get-Date).ToString('MMMM d, yyyy') }
if (-not $LastMod) { $LastMod = (Get-Date).ToString('yyyy-MM-dd') }

function Write-Step {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Skip {
    param([string]$Message)
    Write-Host "[SKIP] $Message" -ForegroundColor Yellow
}

function Escape-Html {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return [System.Net.WebUtility]::HtmlEncode($Value)
}

function Assert-SitemapLastMod {
    param([string]$Value)

    if ($Value -notmatch '^\d{4}-\d{2}-\d{2}$') {
        throw "Sitemap LastMod must use YYYY-MM-DD format, got: $Value"
    }
    try {
        [void][datetime]::ParseExact($Value, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        throw "Sitemap LastMod is not a valid calendar date: $Value"
    }
}

function Get-SiteBaseUrl {
    param([string]$ExplicitBaseUrl, [string]$SitemapPath)

    $candidates = @(
        $ExplicitBaseUrl,
        $env:WEBSITE_AGENT_BASE_URL,
        $env:WEBSITE_BASE_URL,
        $env:SITE_BASE_URL
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        $trimmed = $candidate.Trim().TrimEnd('/')
        if ($trimmed -match '^https?://[^/]+$' -and $trimmed -notmatch '\{\{') {
            return $trimmed
        }
    }

    if (Test-Path $SitemapPath) {
        $xmlText = Get-Content -Path $SitemapPath -Raw
        $match = [regex]::Match($xmlText, '<loc>\s*(https?://[^<\s/]+)(?:/[^<]*)?</loc>')
        if ($match.Success -and $match.Groups[1].Value -notmatch '\{\{') {
            return $match.Groups[1].Value.TrimEnd('/')
        }
    }

    throw 'BaseUrl could not be inferred. Pass -BaseUrl https://example.com or set WEBSITE_AGENT_BASE_URL.'
}

function Normalize-Slug {
    param([string]$Value)
    $normalized = $Value.Trim()
    $normalized = $normalized -replace '^https?://[^/]+/blog/', ''
    $normalized = $normalized -replace '^/blog/', ''
    $normalized = $normalized -replace '^blog/', ''
    $normalized = $normalized -replace '\.html$', ''
    $normalized = $normalized.Trim('/')
    if (-not $normalized) { throw 'Slug cannot be empty after normalization.' }
    if ($normalized -match '[^a-zA-Z0-9-]') {
        throw "Slug must contain only letters, numbers, and hyphens after normalization: $normalized"
    }
    return $normalized.ToLowerInvariant()
}

function Get-CardMediaHtml {
    param([string]$ImageSrc, [string]$ImageAlt)
    if ($ImageSrc) {
        $src = Escape-Html $ImageSrc
        $alt = Escape-Html $ImageAlt
        return "                <img src=`"$src`" alt=`"$alt`" loading=`"lazy`" style=`"width:100%;height:100%;object-fit:cover;`">"
    }

    return @'
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M8 14a6 6 0 1 1 8 0c-.8.7-1.4 1.7-1.7 2.8H9.7C9.4 15.7 8.8 14.7 8 14Z" />
                  <path d="m9.5 9.5 1.5 1.5 3.5-3.5" />
                </svg>
'@
}

function Add-BlogIndexCard {
    param(
        [string]$Path,
        [string]$Slug,
        [string]$Title,
        [string]$Category,
        [string]$Excerpt,
        [string]$Date,
        [string]$Href,
        [string]$ImageSrc,
        [string]$ImageAlt
    )

    if (-not (Test-Path $Path)) {
        throw "Blog index not found: $Path. Import/create Website/blog/index.html before registering blog posts."
    }

    $html = Get-Content -Path $Path -Raw
    if ($html -notmatch [regex]::Escape($indexMarker)) {
        throw "Blog index marker not found: $indexMarker"
    }

    if ($html -match [regex]::Escape("/blog/$Slug") -or $html -match [regex]::Escape("$Slug.html")) {
        Write-Skip "Blog index already references $Slug"
        return
    }

    $safeTitle = Escape-Html $Title
    $safeCategory = Escape-Html $Category
    $safeExcerpt = Escape-Html $Excerpt
    $safeDate = Escape-Html $Date
    $safeHref = Escape-Html $Href
    $media = Get-CardMediaHtml -ImageSrc $ImageSrc -ImageAlt $ImageAlt

    $card = @"
          <div class="blog-card reveal">
            <a href="$safeHref" class="blog-card__image-link" aria-hidden="true" tabindex="-1">
              <div class="blog-card__image" style="background:linear-gradient(135deg, rgba(23,107,154,0.15), rgba(116,201,167,0.12));">
$media
              </div>
            </a>
            <div class="blog-card__content">
              <div class="blog-card__meta">
                <span>$safeCategory</span> &bull; $safeDate
              </div>
              <h2 class="blog-card__title">
                <a href="$safeHref">$safeTitle</a>
              </h2>
              <p class="blog-card__excerpt">$safeExcerpt</p>
              <a href="$safeHref" class="blog-card__read-more">Read Article <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>
            </div>
          </div>
"@

    $updated = $html.Replace("          $indexMarker", "$card`r`n          $indexMarker")
    Set-Content -Path $Path -Value $updated -Encoding UTF8
    Write-Step "Added blog index card"
}

function Remove-ConflictingBlogRedirect {
    param([string]$Path, [string]$Slug)

    if (-not (Test-Path $Path)) { return }

    $lines = Get-Content -Path $Path
    $pattern = "^/blog/$([regex]::Escape($Slug))\s+"
    $filtered = @($lines | Where-Object { $_ -notmatch $pattern })

    if ($filtered.Count -eq $lines.Count) {
        Write-Skip 'No blog redirect needed for clean URL handling'
        return
    }

    Set-Content -Path $Path -Value $filtered -Encoding UTF8
    Write-Step "Removed conflicting blog clean URL route from _redirects"
}

function Add-SitemapEntry {
    param(
        [string]$Path,
        [string]$Slug,
        [string]$LastMod,
        [string]$BaseUrl
    )

    if (-not (Test-Path $Path)) {
        throw "Sitemap not found: $Path"
    }

    Assert-SitemapLastMod $LastMod
    $origin = Get-SiteBaseUrl -ExplicitBaseUrl $BaseUrl -SitemapPath $Path
    $loc = "$origin/blog/$Slug"
    $xmlText = Get-Content -Path $Path -Raw
    if ($xmlText -match [regex]::Escape("<loc>$loc</loc>")) {
        Write-Skip "Sitemap already contains $loc"
        return
    }
    if ($xmlText -notmatch [regex]::Escape($sitemapMarker)) {
        throw "Sitemap marker not found: $sitemapMarker"
    }

    $entry = @"
  <url>
    <loc>$loc</loc>
    <lastmod>$LastMod</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
"@

    $updated = $xmlText.Replace("  $sitemapMarker", "  $sitemapMarker`r`n$entry")
    [xml]$validate = $updated
    Set-Content -Path $Path -Value $updated -Encoding UTF8
    Write-Step "Added sitemap entry"
}

function Sort-BlogIndexByPublishDate {
    param([string]$Path)

    $sortScript = Join-Path $PSScriptRoot 'sort-blog-index.js'
    if (-not (Test-Path $sortScript)) {
        throw "Blog index sort script not found: $sortScript"
    }
    node $sortScript $Path | Write-Host
    Write-Step 'Sorted blog index by publish date, latest first'
}

function Add-LinkRegistryEntry {
    param(
        [string]$Path,
        [string]$Slug,
        [string]$Title,
        [string[]]$Topics,
        [string[]]$Anchors
    )

    if (Test-Path $Path) {
        $json = Get-Content -Path $Path -Raw | ConvertFrom-Json
    } else {
        $json = [pscustomobject]@{
            _comment = 'Internal link registry - maps keywords to URLs for cross-linking. Used by blog scaffolding and SEO audit scripts.'
            internal = [pscustomobject]@{ blog = @() }
        }
    }

    if (-not ($json.PSObject.Properties.Name -contains 'internal')) {
        $json | Add-Member -MemberType NoteProperty -Name internal -Value ([pscustomobject]@{})
    }
    if (-not ($json.internal.PSObject.Properties.Name -contains 'blog')) {
        $json.internal | Add-Member -MemberType NoteProperty -Name blog -Value @()
    }

    $cleanSlug = "/blog/$Slug"
    $existing = @($json.internal.blog) | Where-Object { $_.slug -eq $cleanSlug }
    if ($existing.Count -gt 0) {
        Write-Skip "Link registry already contains $cleanSlug"
        return
    }

    $entry = [pscustomobject]@{
        slug = $cleanSlug
        title = $Title
        topics = @($Topics)
        anchors = @($Anchors)
    }

    $json.internal.blog = @($json.internal.blog) + $entry
    $json | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
    Write-Step "Added link registry entry"
}

$normalizedSlug = Normalize-Slug $Slug
$cleanHref = "/blog/$normalizedSlug"
$indexHref = $cleanHref
if ($UseHtmlLinksInIndex) {
    $indexHref = "/blog/$normalizedSlug.html"
}

Write-Host "Registering blog post: $Title" -ForegroundColor Cyan
Write-Host "Slug: $normalizedSlug" -ForegroundColor Cyan
Write-Host "Index href: $indexHref" -ForegroundColor Cyan

Add-BlogIndexCard `
    -Path $blogIndexPath `
    -Slug $normalizedSlug `
    -Title $Title `
    -Category $Category `
    -Excerpt $Excerpt `
    -Date $Date `
    -Href $indexHref `
    -ImageSrc $ImageSrc `
    -ImageAlt $ImageAlt

Sort-BlogIndexByPublishDate -Path $blogIndexPath

Remove-ConflictingBlogRedirect -Path $redirectsPath -Slug $normalizedSlug

if ($NoSitemap) {
    Write-Skip 'Sitemap update skipped'
} else {
    Add-SitemapEntry -Path $sitemapPath -Slug $normalizedSlug -LastMod $LastMod -BaseUrl $BaseUrl
}

if ($NoLinkRegistry) {
    Write-Skip 'Link registry update skipped'
} else {
    Add-LinkRegistryEntry `
        -Path $registryPath `
        -Slug $normalizedSlug `
        -Title $Title `
        -Topics $Topics `
        -Anchors $Anchors
}

Write-Step 'Blog registration complete'
