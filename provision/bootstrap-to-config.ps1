<#
.SYNOPSIS
  Transform a minimal bootstrap config into a complete site.config.json.

.DESCRIPTION
  Reads a bootstrap JSON (human-provided minimal config) and an optional
  website-profile.json (from analyze-website.ps1), then merges them into
  a complete site.config.json with:

    - All bootstrap values used directly
    - paths.* auto-generated from slug: /opt/{slug}-agent, /opt/{slug}-site, etc.
    - git.* filled with standard defaults (main branch, origin remote, 'SEO Agent')
    - apis.gsc_property derived from domain (sc-domain:{domain})
    - site_name and site_description extracted from website-profile.json
    - email.from defaulted to seo-agent@{domain} if not in bootstrap
    - email.from_name defaulted to '{site_name} SEO Agent'
    - cloudflare.project_name defaulted to slug if not in bootstrap
    - business.* fields set as "__HERMES_FILL__" placeholders for AI judgment
    - _tokens mapping section for customize.ps1 compatibility

  SAFE BY DEFAULT: dry run. Pass -Apply to write.

.PARAMETER BootstrapFile
  Path to the bootstrap JSON file. REQUIRED.

.PARAMETER ProfileFile
  Path to website-profile.json from analyze-website.ps1. Optional.
  If provided, site_name and site_description are extracted from it.

.PARAMETER OutputPath
  Where to write the generated site.config.json. Default: site.config.json in repo root.

.PARAMETER Apply
  Actually write the output file. Without this flag, only a preview is shown.

.EXAMPLE
  pwsh ./provision/bootstrap-to-config.ps1 -BootstrapFile ./provision/examples/bootstrap-acme.json
  pwsh ./provision/bootstrap-to-config.ps1 -BootstrapFile ./bootstrap.json -ProfileFile ./website-profile.json -Apply
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BootstrapFile,

    [string]$ProfileFile,

    [string]$OutputPath,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$repoRoot  = Split-Path -Parent $scriptDir

if (-not $OutputPath) { $OutputPath = Join-Path $repoRoot 'site.config.json' }

# ============================================================
# HELPERS
# ============================================================
function Resolve-JsonPath {
    param($Obj, [string]$Path)
    $parts = $Path -split '\.'
    $current = $Obj
    foreach ($p in $parts) {
        if ($null -eq $current) { return $null }
        if ($current.PSObject.Properties.Name -contains $p) {
            $current = $current.$p
        } else {
            return $null
        }
    }
    return $current
}

function Write-Field {
    param([string]$Label, [string]$Value, [string]$Source)
    $color = switch ($Source) {
        'bootstrap'   { 'Green'   }
        'derived'     { 'Cyan'    }
        'profile'     { 'Magenta' }
        'default'     { 'Gray'    }
        'hermes'      { 'Yellow'  }
        default       { 'White'   }
    }
    $tag = switch ($Source) {
        'bootstrap'   { 'BOOTSTRAP' }
        'derived'     { 'DERIVED  ' }
        'profile'     { 'PROFILE  ' }
        'default'     { 'DEFAULT  ' }
        'hermes'      { 'HERMES   ' }
        default       { 'UNKNOWN  ' }
    }
    $display = if ($Value.Length -gt 60) { $Value.Substring(0, 57) + '...' } else { $Value }
    Write-Host ("  [{0}] {1,-35} = {2}" -f $tag, $Label, $display) -ForegroundColor $color
}

# ============================================================
# LOAD BOOTSTRAP
# ============================================================
Write-Host ""
Write-Host "=== bootstrap-to-config ($(if ($Apply) {'APPLY'} else {'DRY RUN'})) ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $BootstrapFile)) {
    throw "Bootstrap file not found: $BootstrapFile"
}

try {
    $boot = Get-Content -Raw -Path $BootstrapFile -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw "Failed to parse bootstrap JSON: $($_.Exception.Message)"
}

Write-Host "  Bootstrap: $BootstrapFile" -ForegroundColor White

# --- Validate required fields ---
$requiredFields = @('slug', 'domain', 'owner_name', 'timezone', 'timezone_abbr')
$missing = @()
foreach ($field in $requiredFields) {
    $val = Resolve-JsonPath $boot $field
    if ([string]::IsNullOrWhiteSpace($val)) { $missing += $field }
}

$adminEmail = Resolve-JsonPath $boot 'email.admin'
if ([string]::IsNullOrWhiteSpace($adminEmail)) { $missing += 'email.admin' }

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  MISSING REQUIRED FIELDS:" -ForegroundColor Red
    foreach ($m in $missing) {
        Write-Host "    - $m" -ForegroundColor Red
    }
    throw "Bootstrap file is missing required fields: $($missing -join ', ')"
}

# ============================================================
# LOAD WEBSITE PROFILE (optional)
# ============================================================
$profile = $null
if ($ProfileFile) {
    if (-not (Test-Path $ProfileFile)) {
        Write-Host "  [WARN] Profile file not found: $ProfileFile (will use placeholders)" -ForegroundColor Yellow
    } else {
        try {
            $profile = Get-Content -Raw -Path $ProfileFile -Encoding UTF8 | ConvertFrom-Json
            Write-Host "  Profile:   $ProfileFile" -ForegroundColor White
        } catch {
            Write-Host "  [WARN] Failed to parse profile JSON: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# ============================================================
# EXTRACT VALUES
# ============================================================
$slug   = $boot.slug
$domain = $boot.domain

# --- site_name: from profile > fallback to placeholder ---
$siteName = $null
if ($profile) {
    $siteName = Resolve-JsonPath $profile 'identity.site_name'
}
$siteNameSource = 'profile'
if ([string]::IsNullOrWhiteSpace($siteName) -or $siteName -match '\{\{') {
    $siteName = '__HERMES_FILL__'
    $siteNameSource = 'hermes'
}

# --- site_description: from profile > fallback to placeholder ---
$siteDescription = $null
if ($profile) {
    $siteDescription = Resolve-JsonPath $profile 'identity.site_description'
}
$siteDescSource = 'profile'
if ([string]::IsNullOrWhiteSpace($siteDescription) -or $siteDescription -match '\{\{') {
    $siteDescription = '__HERMES_FILL__'
    $siteDescSource = 'hermes'
}

# --- email.from: bootstrap > default ---
$emailFrom = Resolve-JsonPath $boot 'email.from'
$emailFromSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($emailFrom)) {
    $emailFrom = "seo-agent@$domain"
    $emailFromSource = 'default'
}

# --- email.from_name: bootstrap > default (uses site_name) ---
$emailFromName = Resolve-JsonPath $boot 'email.from_name'
$emailFromNameSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($emailFromName)) {
    if ($siteName -ne '__HERMES_FILL__') {
        $emailFromName = "$siteName SEO Agent"
    } else {
        $emailFromName = 'SEO Agent'
    }
    $emailFromNameSource = 'default'
}

# --- cloudflare.project_name: bootstrap > slug ---
$cfProject = Resolve-JsonPath $boot 'cloudflare.project_name'
$cfProjectSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($cfProject)) {
    $cfProject = $slug
    $cfProjectSource = 'derived'
}

# --- cloudflare.production_branch: bootstrap > 'main' ---
$cfBranch = Resolve-JsonPath $boot 'cloudflare.production_branch'
$cfBranchSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($cfBranch)) {
    $cfBranch = 'main'
    $cfBranchSource = 'default'
}

# --- apis: bootstrap overrides > defaults ---
$serpProvider = Resolve-JsonPath $boot 'apis.serp_provider'
$serpProviderSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($serpProvider)) {
    $serpProvider = 'serper'
    $serpProviderSource = 'default'
}

$serpLocation = Resolve-JsonPath $boot 'apis.location'
$serpLocationSource = 'bootstrap'
if ([string]::IsNullOrWhiteSpace($serpLocation)) {
    $serpLocation = 'United States'
    $serpLocationSource = 'default'
}

# --- server: optional, include if provided ---
$serverIp = Resolve-JsonPath $boot 'server.ip'
$sshUser  = Resolve-JsonPath $boot 'server.ssh_user'
$sshKey   = Resolve-JsonPath $boot 'server.ssh_key_path'

if ([string]::IsNullOrWhiteSpace($sshUser))  { $sshUser = 'root' }
if ([string]::IsNullOrWhiteSpace($sshKey))   { $sshKey  = './connection/id_rsa' }

# ============================================================
# BUILD THE FULL CONFIG
# ============================================================
Write-Host "  --- Bootstrap Fields (human-provided) ---" -ForegroundColor White
Write-Field 'slug'               $slug               'bootstrap'
Write-Field 'domain'             $domain              'bootstrap'
Write-Field 'owner_name'         $boot.owner_name     'bootstrap'
Write-Field 'email.admin'        $adminEmail          'bootstrap'
Write-Field 'timezone'           $boot.timezone       'bootstrap'
Write-Field 'timezone_abbr'      $boot.timezone_abbr  'bootstrap'

Write-Host ""
Write-Host "  --- Auto-Derived Fields ---" -ForegroundColor White
Write-Field 'site_name'          $siteName            $siteNameSource
Write-Field 'site_description'   $siteDescription     $siteDescSource
Write-Field 'paths.agent_root'   "/opt/$slug-agent"   'derived'
Write-Field 'paths.site_root'    "/opt/$slug-site"    'derived'
Write-Field 'paths.obsidian_root' "/opt/$slug-obsidian" 'derived'
Write-Field 'paths.db_path'      "/opt/$slug-sqlite/seo-agent.db" 'derived'
Write-Field 'paths.logs'         "/opt/$slug-agent/tools/out/logs" 'derived'
Write-Field 'git.main_branch'    'main'               'default'
Write-Field 'git.remote'         'origin'             'default'
Write-Field 'git.user_name'      'SEO Agent'          'default'
Write-Field 'git.user_email'     "agent@$domain"      'derived'
Write-Field 'apis.gsc_property'  "sc-domain:$domain"  'derived'
Write-Field 'apis.serp_provider' $serpProvider         $serpProviderSource
Write-Field 'apis.location'      $serpLocation         $serpLocationSource
Write-Field 'email.from'         $emailFrom           $emailFromSource
Write-Field 'email.from_name'    $emailFromName        $emailFromNameSource
Write-Field 'cloudflare.project_name'      $cfProject  $cfProjectSource
Write-Field 'cloudflare.production_branch' $cfBranch   $cfBranchSource

Write-Host ""
Write-Host "  --- Hermes AI Placeholders (filled by agent) ---" -ForegroundColor White
# Flow A (canonical): the engine only needs niche/audience/brand_voice (which
# customize.ps1 maps to {{NICHE}}/{{AUDIENCE}}/{{BRAND_VOICE}}) plus type for
# brain/strategy context. Contact/location/service fields (phone, address, city,
# state, primary_color, services, service_areas) are NOT scaffolded here -- this
# template does not generate a website, so they are optional. Hermes adds them to
# site.config.json only if they exist on the imported site and are useful.
$hermesFields = @(
    'business.type', 'business.niche', 'business.audience', 'business.brand_voice'
)
foreach ($hf in $hermesFields) {
    Write-Field $hf '__HERMES_FILL__' 'hermes'
}
if ($siteNameSource -eq 'hermes') {
    Write-Host "  [NOTE] site_name not found in profile -- also needs Hermes" -ForegroundColor Yellow
}
if ($siteDescSource -eq 'hermes') {
    Write-Host "  [NOTE] site_description not found in profile -- also needs Hermes" -ForegroundColor Yellow
}

# --- Build the ordered config object ---
# PowerShell doesn't guarantee property order on PSCustomObject, so we build
# an ordered hashtable and serialize it.
$config = [ordered]@{
    '_comment' = "Generated by bootstrap-to-config.ps1 from $($BootstrapFile | Split-Path -Leaf). Business fields marked __HERMES_FILL__ must be replaced by the Hermes AI agent."

    'slug'             = $slug
    '_slug_help'       = "Structural namespace used in folder names, env-var prefix ($($slug.ToUpper() -replace '-','_')_), and /opt/$slug-* paths."

    'domain'           = $domain
    'site_name'        = $siteName
    'site_description' = $siteDescription
    'owner_name'       = $boot.owner_name

    'business' = [ordered]@{
        'type'          = '__HERMES_FILL__'
        'niche'         = '__HERMES_FILL__'
        'audience'      = '__HERMES_FILL__'
        'brand_voice'   = '__HERMES_FILL__'
    }

    'paths' = [ordered]@{
        'agent_root'    = "/opt/$slug-agent"
        'site_root'     = "/opt/$slug-site"
        'obsidian_root' = "/opt/$slug-obsidian"
        'db_path'       = "/opt/$slug-sqlite/seo-agent.db"
        'logs'          = "/opt/$slug-agent/tools/out/logs"
    }

    'git' = [ordered]@{
        'main_branch'           = 'main'
        'preview_branch_prefix' = 'preview/'
        'remote'                = 'origin'
        'user_name'             = 'SEO Agent'
        'user_email'            = "agent@$domain"
    }

    'email' = [ordered]@{
        'admin'     = $adminEmail
        'from'      = $emailFrom
        'from_name' = $emailFromName
    }

    'apis' = [ordered]@{
        'gsc_property'  = "sc-domain:$domain"
        'serp_provider' = $serpProvider
        'location'      = $serpLocation
    }

    'cloudflare' = [ordered]@{
        'project_name'      = $cfProject
        'production_branch' = $cfBranch
    }

    'timezone'      = $boot.timezone
    'timezone_abbr' = $boot.timezone_abbr
}

# --- Include server block if IP was provided ---
if (-not [string]::IsNullOrWhiteSpace($serverIp)) {
    $config['server'] = [ordered]@{
        'ip'           = $serverIp
        'ssh_user'     = $sshUser
        'ssh_key_path' = $sshKey
    }
    Write-Host ""
    Write-Host "  --- Server ---" -ForegroundColor White
    Write-Field 'server.ip'         $serverIp  'bootstrap'
    Write-Field 'server.ssh_user'   $sshUser   $(if ($boot.server -and $boot.server.ssh_user) { 'bootstrap' } else { 'default' })
    Write-Field 'server.ssh_key_path' $sshKey  $(if ($boot.server -and $boot.server.ssh_key_path) { 'bootstrap' } else { 'default' })
}

# --- Token mapping for customize.ps1 ---
$config['_tokens'] = [ordered]@{
    '_comment'             = "Map of template placeholders -> the config field customize.ps1 fills them from. Do not edit; this documents what gets replaced."
    '{{DOMAIN}}'           = 'domain'
    '{{SITE_NAME}}'        = 'site_name'
    '{{SITE_DESCRIPTION}}' = 'site_description'
    '{{OWNER_NAME}}'       = 'owner_name'
    '{{NICHE}}'            = 'business.niche'
    '{{AUDIENCE}}'         = 'business.audience'
    '{{BRAND_VOICE}}'      = 'business.brand_voice'
    '{{ADMIN_EMAIL}}'      = 'email.admin'
    '{{TIMEZONE}}'         = 'timezone'
    '{{TIMEZONE_ABBR}}'    = 'timezone_abbr'
}

# ============================================================
# OUTPUT
# ============================================================
$json = $config | ConvertTo-Json -Depth 10
$utf8 = [System.Text.UTF8Encoding]::new($false)

# Count how many fields need Hermes
$hermesCount = 0
$hermesCount += ($hermesFields).Count
if ($siteNameSource -eq 'hermes') { $hermesCount++ }
if ($siteDescSource -eq 'hermes') { $hermesCount++ }

Write-Host ""
Write-Host "  ========================================" -ForegroundColor White

if ($Apply) {
    [System.IO.File]::WriteAllText($OutputPath, $json, $utf8)
    Write-Host "  CONFIG WRITTEN: $OutputPath" -ForegroundColor Green
} else {
    Write-Host "  DRY RUN -- no file written" -ForegroundColor Green
}

Write-Host "  ========================================" -ForegroundColor White
Write-Host ""
Write-Host "  $hermesCount field(s) marked __HERMES_FILL__ for AI judgment." -ForegroundColor Yellow
Write-Host ""

if ($Apply) {
    Write-Host "  Next steps:" -ForegroundColor Cyan
    Write-Host "    1. Hermes reads the website and fills all __HERMES_FILL__ fields" -ForegroundColor Gray
    Write-Host "    2. Run: pwsh ./provision/validate-config.ps1 -ConfigFile $OutputPath" -ForegroundColor Gray
    Write-Host "    3. Run: pwsh ./setup/customize.ps1 -Apply" -ForegroundColor Gray
} else {
    Write-Host "  DRY RUN. Re-run with -Apply to write the config file." -ForegroundColor Green
}
Write-Host ""

# ============================================================
# RETURN STRUCTURED RESULT
# ============================================================
$result = @{
    BootstrapFile  = $BootstrapFile
    ProfileFile    = $ProfileFile
    OutputPath     = $OutputPath
    Applied        = [bool]$Apply
    Slug           = $slug
    Domain         = $domain
    HermesFields   = $hermesCount
    SiteNameSource = $siteNameSource
    SiteDescSource = $siteDescSource
}

return $result
