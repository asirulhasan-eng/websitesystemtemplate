<#
.SYNOPSIS
  Fill this template with a real client's details.

.DESCRIPTION
  Reads site.config.json and replaces the template placeholders ({{DOMAIN}},
  {{SITE_NAME}}, {{NICHE}}, {{AUDIENCE}}, ...) and the structural slug ('client',
  'CLIENT_', '/opt/client-*') with the values from the profile, across the engine,
  website, and brain.

  This is the DETERMINISTIC layer. After it runs, the only judgment work left is
  whatever niche prose you want Hermes to polish (the placeholders give it clean
  anchors). See SETUP.md and TEMPLATE.md.

  SAFE BY DEFAULT: dry run. Pass -Apply to write.

.PARAMETER ConfigPath
  Profile path. Default: ../site.config.json relative to this script.

.PARAMETER Apply
  Actually write changes and rename folders.

.EXAMPLE
  pwsh ./setup/customize.ps1            # preview
  pwsh ./setup/customize.ps1 -Apply     # fill the template for this client
#>
[CmdletBinding()]
param([string]$ConfigPath, [switch]$Apply)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $repoRoot 'site.config.json' }
if (-not (Test-Path $ConfigPath)) { throw "Profile not found: $ConfigPath" }
$cfg = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
$utf8 = New-Object System.Text.UTF8Encoding($false)

# --- Token -> value pairs (placeholders the template ships with) ---
$pairs = @(
  @('{{DOMAIN}}',          $cfg.domain),
  @('{{SITE_NAME}}',       $cfg.site_name),
  @('{{SITE_DESCRIPTION}}',$cfg.site_description),
  @('{{OWNER_NAME}}',      $cfg.owner_name),
  @('{{NICHE}}',           $cfg.business.niche),
  @('{{AUDIENCE}}',        $cfg.business.audience),
  @('{{BRAND_VOICE}}',     $cfg.business.brand_voice),
  @('{{ADMIN_EMAIL}}',     $cfg.email.admin),
  @('{{CLOUDFLARE_PROJECT}}', $cfg.cloudflare.project_name),
  @('{{TIMEZONE_ABBR}}',   $cfg.timezone_abbr),
  @('{{TIMEZONE}}',        $cfg.timezone)
)

# --- Structural slug rename (only if the client wants a non-'client' stem) ---
$slug = $cfg.slug
if ($slug -and $slug -ne 'client') {
  $pairs += ,@('/opt/client-agent',    $cfg.paths.agent_root)
  $pairs += ,@('/opt/client-site',     $cfg.paths.site_root)
  $pairs += ,@('/opt/client-obsidian', $cfg.paths.obsidian_root)
  $pairs += ,@('/opt/client-sqlite',   (Split-Path -Parent $cfg.paths.db_path))
  $pairs += ,@('CLIENT_',              ($slug.ToUpper() + '_'))
  $pairs += ,@('client-agent',         ($slug + '-agent'))
  $pairs += ,@('client-site',          ($slug + '-site'))
  $pairs += ,@('client-obsidian',      ($slug + '-obsidian'))
  $pairs += ,@('client-sqlite',        ($slug + '-sqlite'))
  $pairs += ,@('skills/client',        ('skills/' + $slug))
}

# --- Pre-flight guard: refuse to propagate unfilled placeholders ---
# bootstrap-to-config.ps1 writes '__HERMES_FILL__' for AI-judged fields. If Hermes
# has not filled them, replacing tokens here would bake the literal sentinel across
# hundreds of files. Abort with a clear message instead. (Also catches a value that
# is itself still a {{TOKEN}}.)
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
  throw "customize aborted: unfilled placeholders in site.config.json"
}

$includeExt  = @('.js','.mjs','.json','.ps1','.sh','.yaml','.yml','.txt','.md','.html','.css','.py','.bat','.conf','.tsv','.env','.example','.base','.canvas','.service','.timer')
$excludeDirs = @('node_modules', '.git')
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

Write-Host ""
if ($Apply) {
  Write-Host "  [!] APPLY fills tokens IN PLACE under this folder. Make sure this is a" -ForegroundColor Yellow
  Write-Host "      per-client COPY, not your master template. (See SETUP.md Step 0.)" -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "=== customize ($(if ($Apply) {'APPLY'} else {'DRY RUN'})) ===" -ForegroundColor Cyan
Write-Host ("  {{DOMAIN}}   -> {0}" -f $cfg.domain)
Write-Host ("  {{NICHE}}    -> {0}" -f $cfg.business.niche)
Write-Host ("  {{AUDIENCE}} -> {0}" -f $cfg.business.audience)
Write-Host ("  slug         -> {0}" -f $slug)
Write-Host ""

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

$totHits = 0; $totFiles = 0; $leftover = @{}
foreach ($file in $files) {
  $orig = Get-Content -Raw -Path $file.FullName -ErrorAction SilentlyContinue
  if ($null -eq $orig) { continue }
  $text = $orig; $hits = 0
  foreach ($p in $pairs) {
    if ([string]::IsNullOrEmpty($p[0])) { continue }
    $c = ([regex]::Matches($text, [regex]::Escape($p[0]))).Count
    if ($c -gt 0) { $text = $text.Replace($p[0], [string]$p[1]); $hits += $c }
  }
  if ($hits -gt 0) {
    $totFiles++; $totHits += $hits
    if ($Apply) { [System.IO.File]::WriteAllText($file.FullName, $text, $utf8) }
  }
  # leftovers = placeholders still present AFTER the in-memory replacement.
  # Ignore the meta-words used to *describe* the token system in prose/docs
  # ({{TOKEN}}, {{TOKENS}}, {{PLACEHOLDER}}, {{PLACEHOLDERS}}) -- these are never
  # real fillable tokens, so they are not residue.
  $metaWords = @('{{TOKEN}}','{{TOKENS}}','{{PLACEHOLDER}}','{{PLACEHOLDERS}}')
  foreach ($m in [regex]::Matches($text, '\{\{[A-Z_]+\}\}')) {
    if ($metaWords -contains $m.Value) { continue }
    if (-not $leftover.ContainsKey($m.Value)) { $leftover[$m.Value] = 0 }
    $leftover[$m.Value]++
  }
}

# --- Optional structural folder rename ---
if ($slug -and $slug -ne 'client') {
  $sc = Join-Path $repoRoot 'Agentic SEO/hermes/skills/client'
  if ((Test-Path $sc) -and $Apply) {
    Move-Item -LiteralPath $sc -Destination (Join-Path (Split-Path -Parent $sc) $slug)
  }
}

Write-Host ("  {0} files, {1} replacements" -f $totFiles, $totHits)
Write-Host ""
# Report placeholders still present after replacement (tokens with no profile value).
if ($leftover.Count -gt 0) {
  Write-Host "--- Unfilled placeholders (add a value to site.config.json) ---" -ForegroundColor Yellow
  $leftover.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { Write-Host ("  {0}  x{1}" -f $_.Key, $_.Value) }
}
if (-not $Apply) { Write-Host "`nDRY RUN. Re-run with -Apply to write." -ForegroundColor Green }
else { Write-Host "`nFILLED. Next: AI-polish any niche prose, import the client site into Website/, reset secrets. See SETUP.md." -ForegroundColor Yellow }
