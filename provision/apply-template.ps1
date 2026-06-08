<#
.SYNOPSIS
  [OPTIONAL / NOT IN CANONICAL FLOW] Generate a website from a built-in template.

.NOTES
  This system follows Flow A (Architecture Decision #2): the owner provides their
  OWN website (WordPress -> Simply Static -> Website/). provision-site.ps1 does NOT
  call this script, and the canonical onboarding playbook does not use it.

  This generator is retained only as an optional standalone tool for the rare case
  of spinning up a brand-new site from scratch. It expects templates/local-business/
  and templates/_base/ to exist (they are NOT shipped) and consumes the optional
  business.{services,service_areas,phone,address,city,state,primary_color} fields.

.DESCRIPTION
  Reads a client config JSON and applies the specified website template:
    - Copies template files from templates/{name}/ to the Website/ directory
    - Copies base files from templates/_base/ into css/ and js/ directories
    - Replaces all {{TOKENS}} in copied files with values from the config
    - Generates service pages from business.services (clones service-template.html)
    - Generates area pages from business.service_areas (clones area-template.html)
    - Updates navigation links in all HTML pages
    - Updates sitemap.xml with all generated pages
    - Updates robots.txt with correct domain
    - Updates llms.txt with proper site identity

  Dry-run by default. Pass -Apply to write changes.

.PARAMETER TemplateName
  Template to apply. Default: 'local-business'. Looks in templates/{name}/.

.PARAMETER SitePath
  Path to the Website/ directory to populate. Required.

.PARAMETER ConfigFile
  Path to the client configuration JSON. Required.

.PARAMETER Apply
  Actually write files. Without this, only previews what would happen.

.EXAMPLE
  pwsh ./provision/apply-template.ps1 -ConfigFile ./examples/acme-plumbing.json -SitePath ./output/Website
  pwsh ./provision/apply-template.ps1 -ConfigFile ./examples/acme-plumbing.json -SitePath ./output/Website -Apply
#>

[CmdletBinding()]
param(
    [string]$TemplateName = 'local-business',

    [Parameter(Mandatory = $true)]
    [string]$SitePath,

    [Parameter(Mandatory = $true)]
    [string]$ConfigFile,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$scriptDir  = $PSScriptRoot
$repoRoot   = Split-Path -Parent $scriptDir
$templateDir = Join-Path $repoRoot "templates/$TemplateName"
$baseDir     = Join-Path $repoRoot 'templates/_base'

Write-Host ""
Write-Host "=== apply-template ($(if ($Apply) {'APPLY'} else {'DRY RUN'})) ===" -ForegroundColor Cyan
Write-Host "  Template:  $TemplateName"
Write-Host "  SitePath:  $SitePath"
Write-Host "  Config:    $ConfigFile"
Write-Host ""

# ============================================================
# 1. LOAD CONFIG
# ============================================================
if (-not (Test-Path $ConfigFile)) {
    throw "Config file not found: $ConfigFile"
}
$cfg = Get-Content -Raw -Path $ConfigFile -Encoding UTF8 | ConvertFrom-Json

# Build token map from config
$tokenMap = @{
    '{{DOMAIN}}'              = $cfg.domain
    '{{SITE_NAME}}'           = $cfg.site_name
    '{{SITE_DESCRIPTION}}'    = $cfg.site_description
    '{{OWNER_NAME}}'          = $cfg.owner_name
    '{{NICHE}}'               = $cfg.business.niche
    '{{AUDIENCE}}'            = $cfg.business.audience
    '{{BRAND_VOICE}}'         = $cfg.business.brand_voice
    '{{ADMIN_EMAIL}}'         = $cfg.email.admin
    '{{TIMEZONE}}'            = $cfg.timezone
    '{{TIMEZONE_ABBR}}'       = $cfg.timezone_abbr
    '{{CLOUDFLARE_PROJECT}}'  = $cfg.cloudflare.project_name
    '{{PHONE}}'               = $cfg.business.phone
    '{{ADDRESS}}'             = $cfg.business.address
    '{{CITY}}'                = $cfg.business.city
    '{{STATE}}'               = $cfg.business.state
    '{{PRIMARY_COLOR}}'       = $cfg.business.primary_color
    '{{BUSINESS_TYPE}}'       = $cfg.business.type
    '{{YEAR}}'                = (Get-Date).Year.ToString()
}

# ============================================================
# HELPER: Replace all tokens in text
# ============================================================
function Replace-Tokens {
    param([string]$Text)
    $result = $Text
    foreach ($key in $tokenMap.Keys) {
        $val = $tokenMap[$key]
        if (-not [string]::IsNullOrEmpty($val)) {
            $result = $result.Replace($key, $val)
        }
    }
    return $result
}

# ============================================================
# HELPER: Slugify a service/area name
# ============================================================
function ConvertTo-Slug {
    param([string]$Name)
    $slug = $Name.ToLower().Trim()
    $slug = $slug -replace '[^a-z0-9\s-]', ''
    $slug = $slug -replace '\s+', '-'
    $slug = $slug -replace '-{2,}', '-'
    $slug = $slug.Trim('-')
    return $slug
}

# ============================================================
# HELPER: Write a file with token replacement
# ============================================================
function Write-TemplatedFile {
    param(
        [string]$SourcePath,
        [string]$DestPath,
        [hashtable]$ExtraTokens = @{}
    )

    $content = Get-Content -Raw -Path $SourcePath -Encoding UTF8
    $content = Replace-Tokens $content

    foreach ($key in $ExtraTokens.Keys) {
        $content = $content.Replace($key, $ExtraTokens[$key])
    }

    if ($Apply) {
        $destDir = Split-Path -Parent $DestPath
        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }
        [System.IO.File]::WriteAllText($DestPath, $content, $utf8)
    }
    Write-Host "    + $(Split-Path -Leaf $DestPath)" -ForegroundColor Gray
    return $content
}

# ============================================================
# 2. COPY TEMPLATE FILES
# ============================================================
$copiedFiles = @()

if (Test-Path $templateDir) {
    Write-Host "  Copying template files from templates/$TemplateName/..." -ForegroundColor Yellow
    $templateFiles = Get-ChildItem -Path $templateDir -Recurse -File
    foreach ($tf in $templateFiles) {
        $relativePath = $tf.FullName.Substring($templateDir.Length).TrimStart('\', '/')
        $destPath = Join-Path $SitePath $relativePath

        # Skip template files (they get cloned per-service/area)
        if ($tf.Name -match '-(template|seed)\.(html|md)$') {
            Write-Host "    ~ $relativePath (template -- will clone per item)" -ForegroundColor DarkGray
            continue
        }

        Write-TemplatedFile -SourcePath $tf.FullName -DestPath $destPath | Out-Null
        $copiedFiles += $destPath
    }
} else {
    Write-Host "  [WARN] Template directory not found: $templateDir" -ForegroundColor Yellow
    Write-Host "         Will apply token replacement to existing files in $SitePath" -ForegroundColor Yellow
}

# ============================================================
# 3. COPY BASE FILES (css, js shared across templates)
# ============================================================
if (Test-Path $baseDir) {
    Write-Host "  Copying base assets from templates/_base/..." -ForegroundColor Yellow
    $baseFiles = Get-ChildItem -Path $baseDir -Recurse -File
    foreach ($bf in $baseFiles) {
        $relativePath = $bf.FullName.Substring($baseDir.Length).TrimStart('\', '/')
        $destPath = Join-Path $SitePath $relativePath
        Write-TemplatedFile -SourcePath $bf.FullName -DestPath $destPath | Out-Null
        $copiedFiles += $destPath
    }
} else {
    Write-Host "  [INFO] No templates/_base/ directory found -- skipping base assets" -ForegroundColor DarkGray
}

# ============================================================
# 4. GENERATE SERVICE PAGES
# ============================================================
$servicePages = @()
$serviceTemplateFile = Join-Path $templateDir 'services/service-template.html'
$hasServiceTemplate = Test-Path $serviceTemplateFile

if ($cfg.business.services -and $cfg.business.services.Count -gt 0) {
    Write-Host ""
    Write-Host "  Generating service pages ($($cfg.business.services.Count) services)..." -ForegroundColor Yellow

    if ($hasServiceTemplate) {
        $serviceTemplate = Get-Content -Raw -Path $serviceTemplateFile -Encoding UTF8
    } else {
        # Generate a minimal service page if no template exists
        $serviceTemplate = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{SERVICE_NAME}} | {{SITE_NAME}}</title>
  <meta name="description" content="Professional {{SERVICE_NAME}} services in {{CITY}}, {{STATE}}. {{SITE_NAME}} -- call {{PHONE}} for a free estimate.">
  <link rel="canonical" href="https://{{DOMAIN}}/services/{{SERVICE_SLUG}}">
  <meta property="og:title" content="{{SERVICE_NAME}} | {{SITE_NAME}}">
  <meta property="og:description" content="Professional {{SERVICE_NAME}} services in {{CITY}}, {{STATE}}.">
  <meta property="og:url" content="https://{{DOMAIN}}/services/{{SERVICE_SLUG}}">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="../css/main.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">{{SITE_NAME}}</a>
      {{NAV_LINKS}}
    </nav>
  </header>
  <main>
    <h1>{{SERVICE_NAME}}</h1>
    <p>{{SITE_NAME}} provides expert {{SERVICE_NAME}} services to homeowners and businesses in {{CITY}} and surrounding areas.</p>
    <section>
      <h2>Why Choose {{SITE_NAME}} for {{SERVICE_NAME}}?</h2>
      <ul>
        <li>Licensed, insured, and experienced professionals</li>
        <li>Transparent, upfront pricing</li>
        <li>Fast response times</li>
        <li>100% satisfaction guaranteed</li>
      </ul>
    </section>
    <section>
      <h2>Service Areas</h2>
      <p>We provide {{SERVICE_NAME}} in {{SERVICE_AREAS_TEXT}}.</p>
    </section>
    <section class="cta">
      <h2>Ready to Get Started?</h2>
      <p>Call us today at <a href="tel:{{PHONE}}">{{PHONE}}</a> or request a free estimate online.</p>
    </section>
  </main>
  <footer>
    <p>&copy; {{YEAR}} {{SITE_NAME}}. All rights reserved.</p>
  </footer>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "{{SERVICE_NAME}}",
    "provider": {
      "@type": "LocalBusiness",
      "name": "{{SITE_NAME}}",
      "telephone": "{{PHONE}}",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "{{ADDRESS}}",
        "addressLocality": "{{CITY}}",
        "addressRegion": "{{STATE}}"
      }
    },
    "areaServed": [{{SERVICE_AREAS_JSON}}],
    "url": "https://{{DOMAIN}}/services/{{SERVICE_SLUG}}"
  }
  </script>
</body>
</html>
'@
    }

    $areasText = ($cfg.business.service_areas -join ', ')
    $areasJson = ($cfg.business.service_areas | ForEach-Object { "`"$_`"" }) -join ', '

    foreach ($service in $cfg.business.services) {
        $slug = ConvertTo-Slug $service
        $destPath = Join-Path $SitePath "services/$slug.html"
        $extraTokens = @{
            '{{SERVICE_NAME}}'        = $service
            '{{SERVICE_SLUG}}'        = $slug
            '{{SERVICE_AREAS_TEXT}}'   = $areasText
            '{{SERVICE_AREAS_JSON}}'   = $areasJson
        }

        $pageContent = Replace-Tokens $serviceTemplate
        foreach ($key in $extraTokens.Keys) {
            $pageContent = $pageContent.Replace($key, $extraTokens[$key])
        }

        if ($Apply) {
            $destDir = Split-Path -Parent $destPath
            if (-not (Test-Path $destDir)) {
                New-Item -Path $destDir -ItemType Directory -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($destPath, $pageContent, $utf8)
        }
        Write-Host "    + services/$slug.html" -ForegroundColor Green
        $servicePages += @{ name = $service; slug = $slug; file = "services/$slug.html" }
    }
} else {
    Write-Host "  [INFO] No services defined -- skipping service page generation" -ForegroundColor DarkGray
}

# ============================================================
# 5. GENERATE AREA PAGES
# ============================================================
$areaPages = @()
$areaTemplateFile = Join-Path $templateDir 'areas/area-template.html'
$hasAreaTemplate = Test-Path $areaTemplateFile

if ($cfg.business.service_areas -and $cfg.business.service_areas.Count -gt 0) {
    Write-Host ""
    Write-Host "  Generating area pages ($($cfg.business.service_areas.Count) areas)..." -ForegroundColor Yellow

    if ($hasAreaTemplate) {
        $areaTemplate = Get-Content -Raw -Path $areaTemplateFile -Encoding UTF8
    } else {
        # Generate a minimal area page if no template exists
        $areaTemplate = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{BUSINESS_TYPE}} in {{AREA_NAME}}, {{STATE}} | {{SITE_NAME}}</title>
  <meta name="description" content="{{SITE_NAME}} serves {{AREA_NAME}}, {{STATE}} with professional {{NICHE}} services. Call {{PHONE}} today.">
  <link rel="canonical" href="https://{{DOMAIN}}/areas/{{AREA_SLUG}}">
  <meta property="og:title" content="{{BUSINESS_TYPE}} in {{AREA_NAME}} | {{SITE_NAME}}">
  <meta property="og:description" content="Professional {{NICHE}} services in {{AREA_NAME}}, {{STATE}}.">
  <meta property="og:url" content="https://{{DOMAIN}}/areas/{{AREA_SLUG}}">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="../css/main.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">{{SITE_NAME}}</a>
      {{NAV_LINKS}}
    </nav>
  </header>
  <main>
    <h1>{{BUSINESS_TYPE}} in {{AREA_NAME}}, {{STATE}}</h1>
    <p>{{SITE_NAME}} is proud to serve the {{AREA_NAME}} community with reliable, professional {{NICHE}} services.</p>
    <section>
      <h2>Our Services in {{AREA_NAME}}</h2>
      <ul>
        {{SERVICES_LIST}}
      </ul>
    </section>
    <section class="cta">
      <h2>Need a {{BUSINESS_TYPE}} in {{AREA_NAME}}?</h2>
      <p>Call <a href="tel:{{PHONE}}">{{PHONE}}</a> for fast, reliable service.</p>
    </section>
  </main>
  <footer>
    <p>&copy; {{YEAR}} {{SITE_NAME}}. All rights reserved.</p>
  </footer>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "{{SITE_NAME}}",
    "telephone": "{{PHONE}}",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "{{ADDRESS}}",
      "addressLocality": "{{CITY}}",
      "addressRegion": "{{STATE}}"
    },
    "areaServed": {
      "@type": "City",
      "name": "{{AREA_NAME}}"
    },
    "url": "https://{{DOMAIN}}/areas/{{AREA_SLUG}}"
  }
  </script>
</body>
</html>
'@
    }

    $servicesList = ($cfg.business.services | ForEach-Object {
        $sSlug = ConvertTo-Slug $_
        "        <li><a href=`"../services/$sSlug.html`">$_</a></li>"
    }) -join "`n"

    foreach ($area in $cfg.business.service_areas) {
        $slug = ConvertTo-Slug $area
        $destPath = Join-Path $SitePath "areas/$slug.html"
        $extraTokens = @{
            '{{AREA_NAME}}'     = $area
            '{{AREA_SLUG}}'     = $slug
            '{{SERVICES_LIST}}' = $servicesList
        }

        $pageContent = Replace-Tokens $areaTemplate
        foreach ($key in $extraTokens.Keys) {
            $pageContent = $pageContent.Replace($key, $extraTokens[$key])
        }

        if ($Apply) {
            $destDir = Split-Path -Parent $destPath
            if (-not (Test-Path $destDir)) {
                New-Item -Path $destDir -ItemType Directory -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($destPath, $pageContent, $utf8)
        }
        Write-Host "    + areas/$slug.html" -ForegroundColor Green
        $areaPages += @{ name = $area; slug = $slug; file = "areas/$slug.html" }
    }
} else {
    Write-Host "  [INFO] No service areas defined -- skipping area page generation" -ForegroundColor DarkGray
}

# ============================================================
# 6. UPDATE NAVIGATION LINKS IN ALL HTML PAGES
# ============================================================
Write-Host ""
Write-Host "  Updating navigation links..." -ForegroundColor Yellow

# Build nav link snippets
$navServiceLinks = ($servicePages | ForEach-Object {
    "      <a href=`"/services/$($_.slug).html`">$($_.name)</a>"
}) -join "`n"

$navAreaLinks = ($areaPages | ForEach-Object {
    "      <a href=`"/areas/$($_.slug).html`">$($_.name)</a>"
}) -join "`n"

$navSnippet = @"
      <a href="/">Home</a>
      <a href="/about.html">About</a>
      <a href="/services/">Services</a>
      <a href="/areas/">Areas</a>
      <a href="/blog/">Blog</a>
      <a href="/contact.html">Contact</a>
"@

if (Test-Path $SitePath) {
    $htmlFiles = Get-ChildItem -Path $SitePath -Recurse -Filter '*.html' -ErrorAction SilentlyContinue
    $navUpdated = 0
    foreach ($hf in $htmlFiles) {
        $content = Get-Content -Raw -Path $hf.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($null -eq $content) { continue }
        if ($content -match '{{NAV_LINKS}}') {
            $content = $content.Replace('{{NAV_LINKS}}', $navSnippet)
            if ($Apply) {
                [System.IO.File]::WriteAllText($hf.FullName, $content, $utf8)
            }
            $navUpdated++
        }
    }
    Write-Host "    Updated navigation in $navUpdated file(s)" -ForegroundColor Gray
}

# ============================================================
# 7. UPDATE SITEMAP.XML
# ============================================================
Write-Host ""
Write-Host "  Generating sitemap.xml..." -ForegroundColor Yellow

$today = (Get-Date).ToString('yyyy-MM-dd')
$sitemapEntries = @()
$sitemapEntries += "  <url><loc>https://$($cfg.domain)/</loc><lastmod>$today</lastmod><priority>1.0</priority></url>"

# Static pages
$staticPages = @('about.html', 'contact.html')
foreach ($sp in $staticPages) {
    $sitemapEntries += "  <url><loc>https://$($cfg.domain)/$sp</loc><lastmod>$today</lastmod><priority>0.8</priority></url>"
}

# Service pages
foreach ($svc in $servicePages) {
    $sitemapEntries += "  <url><loc>https://$($cfg.domain)/services/$($svc.slug).html</loc><lastmod>$today</lastmod><priority>0.8</priority></url>"
}

# Area pages
foreach ($area in $areaPages) {
    $sitemapEntries += "  <url><loc>https://$($cfg.domain)/areas/$($area.slug).html</loc><lastmod>$today</lastmod><priority>0.7</priority></url>"
}

# Blog index
$sitemapEntries += "  <url><loc>https://$($cfg.domain)/blog/</loc><lastmod>$today</lastmod><priority>0.6</priority></url>"

$sitemapXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
$($sitemapEntries -join "`n")
</urlset>
"@

$sitemapPath = Join-Path $SitePath 'sitemap.xml'
if ($Apply) {
    [System.IO.File]::WriteAllText($sitemapPath, $sitemapXml, $utf8)
}
Write-Host "    sitemap.xml: $($sitemapEntries.Count) URLs" -ForegroundColor Gray

# ============================================================
# 8. UPDATE ROBOTS.TXT
# ============================================================
Write-Host "  Generating robots.txt..." -ForegroundColor Yellow

$robotsTxt = @"
User-agent: *
Allow: /

Sitemap: https://$($cfg.domain)/sitemap.xml
"@

$robotsPath = Join-Path $SitePath 'robots.txt'
if ($Apply) {
    [System.IO.File]::WriteAllText($robotsPath, $robotsTxt, $utf8)
}
Write-Host "    robots.txt: updated with domain $($cfg.domain)" -ForegroundColor Gray

# ============================================================
# 9. UPDATE LLMS.TXT
# ============================================================
Write-Host "  Generating llms.txt..." -ForegroundColor Yellow

$serviceListText = ($cfg.business.services | ForEach-Object { "- $_" }) -join "`n"
$areaListText    = ($cfg.business.service_areas | ForEach-Object { "- $_" }) -join "`n"

$llmsTxt = @"
# $($cfg.site_name)

> $($cfg.site_description)

## About
$($cfg.site_name) is a $($cfg.business.type) serving $($cfg.business.audience) in the $($cfg.business.niche) space.
Located at $($cfg.business.address), $($cfg.business.city), $($cfg.business.state).
Phone: $($cfg.business.phone)

## Services
$serviceListText

## Service Areas
$areaListText

## Core Pages
- [Home](https://$($cfg.domain)/)
- [About](https://$($cfg.domain)/about.html)
- [Contact](https://$($cfg.domain)/contact.html)
- [Blog](https://$($cfg.domain)/blog/)

## Brand Voice & Guidelines for AI
$($cfg.business.brand_voice)

## Contact
- Website: https://$($cfg.domain)
- Email: $($cfg.email.admin)
- Phone: $($cfg.business.phone)
"@

$llmsPath = Join-Path $SitePath 'llms.txt'
if ($Apply) {
    [System.IO.File]::WriteAllText($llmsPath, $llmsTxt, $utf8)
}
Write-Host "    llms.txt: updated with full site identity" -ForegroundColor Gray

# ============================================================
# 10. TOKEN REPLACEMENT ON ALL EXISTING FILES
# ============================================================
Write-Host ""
Write-Host "  Final token sweep across all files..." -ForegroundColor Yellow

$includeExt = @('.html', '.css', '.js', '.json', '.xml', '.txt', '.md')
if (Test-Path $SitePath) {
    $allFiles = Get-ChildItem -Path $SitePath -Recurse -File |
        Where-Object { $includeExt -contains $_.Extension.ToLower() }

    $tokenHits = 0
    $filesModified = 0
    foreach ($af in $allFiles) {
        $content = Get-Content -Raw -Path $af.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($null -eq $content) { continue }
        $original = $content
        $content = Replace-Tokens $content
        if ($content -ne $original) {
            $filesModified++
            $tokenHits += ([regex]::Matches($original, '\{\{[A-Z_]+\}\}') | Where-Object {
                $replacement = $tokenMap[$_.Value]
                $null -ne $replacement -and $replacement -ne ''
            }).Count
            if ($Apply) {
                [System.IO.File]::WriteAllText($af.FullName, $content, $utf8)
            }
        }
    }
    Write-Host "    $filesModified files modified, ~$tokenHits tokens replaced" -ForegroundColor Gray
}

# ============================================================
# SUMMARY
# ============================================================
Write-Host ""
Write-Host "  ========================================" -ForegroundColor White
Write-Host "  Template:        $TemplateName" -ForegroundColor White
Write-Host "  Service pages:   $($servicePages.Count)" -ForegroundColor White
Write-Host "  Area pages:      $($areaPages.Count)" -ForegroundColor White
Write-Host "  Sitemap URLs:    $($sitemapEntries.Count)" -ForegroundColor White
Write-Host "  ========================================" -ForegroundColor White

if (-not $Apply) {
    Write-Host ""
    Write-Host "  DRY RUN. Re-run with -Apply to write files." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  APPLIED. Website template has been populated." -ForegroundColor Yellow
}
Write-Host ""

return @{
    Template     = $TemplateName
    SitePath     = $SitePath
    ServicePages = $servicePages
    AreaPages    = $areaPages
    SitemapUrls  = $sitemapEntries.Count
    Applied      = $Apply.IsPresent
}
