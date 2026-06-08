<#
.SYNOPSIS
  ONE-TIME: convert this plumbing build into a neutral, reusable template.

.DESCRIPTION
  Run ONCE to birth the template. It:
    1. Tokenizes business identity to {{PLACEHOLDERS}} and renames the namespace
       slug (plumbingseo -> client) across the engine, website, and brain.
    2. Resets the Obsidian brain to seed (clears all client runtime notes,
       restores canonical seed files, keeps the folder taxonomy).
    3. Scrubs secrets: SSH private keys and Credentials.md become placeholders.
    4. Deletes runtime artifacts (logs, compiled brain) and empties client
       strategy data files to stubs.
    5. Renames the plumbingseo skill folder + subfolders.

  After this, fill site.config.json and run customize.ps1 to retarget a real client.

  SAFE BY DEFAULT: dry run. Pass -Apply to write. The repo's .git folders are
  never touched, so a committed state is recoverable.

.EXAMPLE
  pwsh ./setup/make-template.ps1            # preview
  pwsh ./setup/make-template.ps1 -Apply     # convert this folder into the template
#>
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
function Rel($p) { $p.Substring($repoRoot.Length + 1) }
$utf8 = New-Object System.Text.UTF8Encoding($false)

Write-Host ""
Write-Host "=== make-template ($(if ($Apply) {'APPLY'} else {'DRY RUN'})) ===" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------------
# 1. REPLACEMENT MAP  (legacy plumbing identifier -> neutral token / slug)
#    ORDER MATTERS: most-specific first.
# -----------------------------------------------------------------------------
$pairs = @(
  # full /opt paths -> generic structural paths
  @('/opt/plumbingseoagent',     '/opt/client-agent'),
  @('/opt/plumbingseosite',      '/opt/client-site'),
  @('/opt/plumbingsiteobsidian', '/opt/client-obsidian'),
  @('/opt/plumbingsitesqlite',   '/opt/client-sqlite'),
  # urls / domain -> token
  @('https://plumbingseo.agency','https://{{DOMAIN}}'),
  @('plumbingseo.agency',        '{{DOMAIN}}'),
  # env prefix
  @('PLUMBINGSEO_',              'CLIENT_'),
  # brand / site name -> token
  @('PlumbingSEO Agency',        '{{SITE_NAME}}'),
  @('PlumbingSEO',               '{{SITE_NAME}}'),
  # bare path stems (after /opt handled)
  @('plumbingseoagent',          'client-agent'),
  @('plumbingseosite',           'client-site'),
  @('plumbingsiteobsidian',      'client-obsidian'),
  @('plumbingsitesqlite',        'client-sqlite'),
  # generic slug
  @('plumbingseo',               'client'),
  # owner / personal
  @('asirulhasan@gmail.com',     '{{ADMIN_EMAIL}}'),
  @('Asirul Hasan',              '{{OWNER_NAME}}'),
  @('Asirul',                    '{{OWNER_NAME}}'),
  # timezone / locale defaults
  @('Asia/Dhaka',                '{{TIMEZONE}}'),
  @('BDT',                       '{{TIMEZONE_ABBR}}')
)
# niche prose pairs (case-insensitive) handled separately, longest first.
# Bare 'plumb' last catches truncated slugs / fixtures (e.g. auto-plumb-seo).
$prosePairs = @(
  @('plumbers',  '{{AUDIENCE}}'),
  @('plumber',   '{{AUDIENCE}}'),
  @('plumbing',  '{{NICHE}}'),
  @('plumb',     '{{NICHE}}')
)

$includeExt  = @('.js','.mjs','.json','.ps1','.sh','.yaml','.yml','.txt','.md','.html','.css','.py','.bat','.conf','.tsv','.env','.example','.base','.canvas','.service','.timer')
$excludeDirs = @('node_modules', '.git')
# Only the template META-DOCS are protected (they describe the legacy build on
# purpose). Engine sub-folder READMEs are NOT protected -- they get tokenized.
$excludePaths = @(
  (Join-Path $repoRoot 'site.config.json'),
  (Join-Path $repoRoot 'TEMPLATE.md'),
  (Join-Path $repoRoot 'README.md'),
  (Join-Path $repoRoot 'SETUP.md'),
  (Join-Path $repoRoot 'setup/README.md'),
  (Join-Path $repoRoot 'setup/customize.ps1'),
  (Join-Path $repoRoot 'setup/make-template.ps1')
)

function In-Excluded($path) {
  foreach ($d in $excludeDirs) { if ($path -match "[\\/]$([regex]::Escape($d))[\\/]") { return $true } }
  return $false
}

# -----------------------------------------------------------------------------
# STEP A: reset the Obsidian brain (do this BEFORE tokenizing so we don't
#         process hundreds of files we're about to delete).
# -----------------------------------------------------------------------------
$brain = Join-Path $repoRoot 'Obsidian Agent Brain'
$seed  = Join-Path $repoRoot 'Agentic SEO/processes/brain-seed/01-Agent-Brain'

# Folders whose entire contents are client runtime data -> clear, keep folder.
$runtimeDirs = @('02-Tasks','03-Topics','04-Pages','04-Dashboards','05-Targets','12-Reports','14-System-Logs')
Write-Host "--- Brain reset ---" -ForegroundColor Cyan
foreach ($d in $runtimeDirs) {
  $full = Join-Path $brain $d
  if (Test-Path $full) {
    $n = (Get-ChildItem $full -Recurse -File | Measure-Object).Count
    Write-Host ("  clear {0} ({1} files)" -f $d, $n)
    if ($Apply) {
      Get-ChildItem $full -Force | Remove-Item -Recurse -Force
      Set-Content -Path (Join-Path $full '.gitkeep') -Value '' -NoNewline
    }
  }
}

# 01-Agent-Brain: keep only the canonical seed files; drop compiled/decisions/
# lessons/credentials runtime. Restore the 6 seed files.
$agentBrain = Join-Path $brain '01-Agent-Brain'
$keepSeed = @('Operating Rules.md','Risk Lanes.md','SEO Strategy.md','Task Generation Rules.md','User Preferences.md','No-Go Sources.md')
Write-Host "  reset 01-Agent-Brain to seed (+ scrub Credentials.md)"
if ($Apply -and (Test-Path $agentBrain)) {
  Get-ChildItem $agentBrain -Force | Remove-Item -Recurse -Force
  foreach ($f in $keepSeed) {
    $src = Join-Path $seed $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $agentBrain $f) -Force }
  }
  # Credentials.md -> empty template stub (never ship real creds)
  $credStub = @'
---
title: Credentials
type: brain
brain_domain: credentials
status: template
---
# Credentials

Template stub. Add operational credentials here per client, or leave blank and
keep secrets in the agent .env. Never commit real secrets to a shared template.
'@
  Set-Content -Path (Join-Path $agentBrain 'Credentials.md') -Value $credStub
}

# 00-Dashboard: clear generated dashboards, keep folder.
$dash = Join-Path $brain '00-Dashboard'
if (Test-Path $dash) {
  Write-Host "  clear 00-Dashboard (regenerated by agent)"
  if ($Apply) {
    Get-ChildItem $dash -Force | Remove-Item -Recurse -Force
    Set-Content -Path (Join-Path $dash '.gitkeep') -Value '' -NoNewline
  }
}

# -----------------------------------------------------------------------------
# STEP A2: reset the Website to a clean placeholder skeleton.
#          Each client brings their own static site (e.g. Simply Static export),
#          so the demo plumbing site is removed. .git is preserved.
# -----------------------------------------------------------------------------
Write-Host "--- Website reset ---" -ForegroundColor Cyan
$web = Join-Path $repoRoot 'Website'
if (Test-Path $web) {
  $n = (Get-ChildItem $web -Recurse -File -Force | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } | Measure-Object).Count
  Write-Host ("  clear Website ({0} files) -> placeholder skeleton" -f $n)
  if ($Apply) {
    Get-ChildItem $web -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
    New-Item -ItemType Directory -Path (Join-Path $web 'blog') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $web 'assets') -Force | Out-Null
    Set-Content -Path (Join-Path $web 'blog/.gitkeep') -Value '' -NoNewline
    Set-Content -Path (Join-Path $web 'assets/.gitkeep') -Value '' -NoNewline
    $idx = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{SITE_NAME}}</title>
  <meta name="description" content="{{SITE_DESCRIPTION}}">
  <link rel="canonical" href="https://{{DOMAIN}}/">
</head>
<body>
  <h1>{{SITE_NAME}}</h1>
  <p>Placeholder home page. Replace the contents of <code>Website/</code> with your
     static site (e.g. a WordPress site exported via Simply Static, or custom HTML/CSS/JS).</p>
</body>
</html>
'@
    Set-Content -Path (Join-Path $web 'index.html') -Value $idx
    Set-Content -Path (Join-Path $web 'robots.txt') -Value "User-agent: *`nAllow: /`nSitemap: https://{{DOMAIN}}/sitemap.xml`n"
    Set-Content -Path (Join-Path $web 'sitemap.xml') -Value "<?xml version=`"1.0`" encoding=`"UTF-8`"?>`n<urlset xmlns=`"http://www.sitemaps.org/schemas/sitemap/0.9`">`n  <url><loc>https://{{DOMAIN}}/</loc></url>`n</urlset>`n"
    Set-Content -Path (Join-Path $web '_headers') -Value "/*`n  X-Frame-Options: SAMEORIGIN`n  X-Content-Type-Options: nosniff`n"
    Set-Content -Path (Join-Path $web '_redirects') -Value "# /old /new 301`n"
    $llms = @'
# {{SITE_NAME}}

> {{SITE_DESCRIPTION}}

## About
{{SITE_NAME}} serves {{AUDIENCE}} in the {{NICHE}} space.

## Core Pages
- [Home](https://{{DOMAIN}}/)
- [About](https://{{DOMAIN}}/about)
- [Contact](https://{{DOMAIN}}/contact)
- [Blog](https://{{DOMAIN}}/blog/)

## Brand Voice & Guidelines for AI
{{BRAND_VOICE}}

## Contact
- Website: https://{{DOMAIN}}
'@
    Set-Content -Path (Join-Path $web 'llms.txt') -Value $llms
    $webReadme = @'
# Website/

Replace everything in this folder with your client's static site.

Typical source: a WordPress site exported to static HTML via the **Simply Static**
plugin, or custom HTML/CSS/JS. Cloudflare Pages deploys this folder.

Keep/maintain these SEO basics: `robots.txt`, `sitemap.xml`, `llms.txt`,
`_headers`, `_redirects`. The blog scaffolder (`Agentic SEO/tools/scaffold-blog.ps1`)
clones YOUR blog post markup, so point it at a real post after you import the site.
'@
    Set-Content -Path (Join-Path $web 'README.md') -Value $webReadme
  }
}

# -----------------------------------------------------------------------------
# STEP B: scrub secrets in connection/
# -----------------------------------------------------------------------------
Write-Host "--- Secret scrub ---" -ForegroundColor Cyan
$conn = Join-Path $repoRoot 'Agentic SEO/connection'
foreach ($k in @('id_rsa','key.ppk')) {
  $kp = Join-Path $conn $k
  if (Test-Path $kp) {
    Write-Host ("  scrub SSH key: {0}" -f (Rel $kp)) -ForegroundColor Yellow
    if ($Apply) { Set-Content -Path $kp -Value "# PLACEHOLDER - generate a fresh keypair per client. Do NOT commit a real private key.`n" }
  }
}

# -----------------------------------------------------------------------------
# STEP C: delete runtime artifacts
# -----------------------------------------------------------------------------
Write-Host "--- Artifact cleanup ---" -ForegroundColor Cyan
$artifacts = @('Agentic SEO/tools/scaffold-blog.log')
foreach ($a in $artifacts) {
  $ap = Join-Path $repoRoot $a
  if (Test-Path $ap) { Write-Host ("  delete {0}" -f $a); if ($Apply) { Remove-Item $ap -Force } }
}

# -----------------------------------------------------------------------------
# STEP D: empty client strategy DATA files to stubs (pure per-client data)
# -----------------------------------------------------------------------------
Write-Host "--- Strategy-data stubs ---" -ForegroundColor Cyan
$dataStubs = @{
  'Agentic SEO/config/rank_tracking_keywords.txt' = "# One keyword per line. Fill per client.`n"
  'Agentic SEO/config/money-keywords-seed.tsv'    = "keyword`tintent`ttarget_path`n"
}
foreach ($k in $dataStubs.Keys) {
  $p = Join-Path $repoRoot $k
  if (Test-Path $p) { Write-Host ("  stub {0}" -f $k); if ($Apply) { Set-Content -Path $p -Value $dataStubs[$k] -NoNewline } }
}

# -----------------------------------------------------------------------------
# STEP E: tokenize everything (engine + website + brain seed)
# -----------------------------------------------------------------------------
Write-Host "--- Tokenize identity + niche prose ---" -ForegroundColor Cyan
$scopeDirs = @(
  (Join-Path $repoRoot 'Agentic SEO'),
  (Join-Path $repoRoot 'Website'),
  (Join-Path $repoRoot 'Obsidian Agent Brain')
)
$files = foreach ($dir in $scopeDirs) {
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Recurse -File | Where-Object {
      (($includeExt -contains $_.Extension.ToLower()) -or ($_.Extension -eq '')) -and `
      -not (In-Excluded $_.FullName) -and -not ($excludePaths -contains $_.FullName)
    }
  }
}
$totHits = 0; $totFiles = 0
foreach ($file in $files) {
  $orig = Get-Content -Raw -Path $file.FullName -ErrorAction SilentlyContinue
  if ($null -eq $orig) { continue }
  $text = $orig; $hits = 0
  foreach ($p in $pairs) {
    $c = ([regex]::Matches($text, [regex]::Escape($p[0]))).Count
    if ($c -gt 0) { $text = $text.Replace($p[0], $p[1]); $hits += $c }
  }
  foreach ($p in $prosePairs) {
    $c = ([regex]::Matches($text, "(?i)" + [regex]::Escape($p[0]))).Count
    if ($c -gt 0) { $text = [regex]::Replace($text, "(?i)" + [regex]::Escape($p[0]), $p[1]); $hits += $c }
  }
  if ($hits -gt 0) {
    $totFiles++; $totHits += $hits
    if ($Apply) { [System.IO.File]::WriteAllText($file.FullName, $text, $utf8) }
  }
}
Write-Host ("  {0} files, {1} replacements" -f $totFiles, $totHits)

# -----------------------------------------------------------------------------
# STEP F: rename skill folders
# -----------------------------------------------------------------------------
Write-Host "--- Skill folder renames ---" -ForegroundColor Cyan
$skillRoot = Join-Path $repoRoot 'Agentic SEO/hermes/skills/plumbingseo'
if (Test-Path $skillRoot) {
  if ($Apply) {
    Get-ChildItem $skillRoot -Directory | Where-Object { $_.Name -like 'plumbingseo-*' } | ForEach-Object {
      $nn = $_.Name -replace '^plumbingseo-', 'client-'
      Move-Item -LiteralPath $_.FullName -Destination (Join-Path $_.Parent.FullName $nn)
    }
    Move-Item -LiteralPath $skillRoot -Destination (Join-Path (Split-Path -Parent $skillRoot) 'client')
  }
  Write-Host "  skills/plumbingseo -> skills/client (+ plumbingseo-* -> client-*)"
} else { Write-Host "  (already renamed)" }

Write-Host ""
if ($Apply) {
  Write-Host "TEMPLATE CREATED. Next: verify no 'plumb' remains, then fill site.config.json." -ForegroundColor Green
} else {
  Write-Host "DRY RUN done. Re-run with -Apply to convert this folder into the template." -ForegroundColor Green
}
