<#
.SYNOPSIS
  Validate a client configuration JSON file against the schema.

.DESCRIPTION
  Reads a client config JSON and validates every required field:
    - All required fields present and non-empty
    - Domain format valid (no protocol prefix, valid TLD)
    - Slug format valid (lowercase alphanumeric + hyphens)
    - Email format valid (admin, from, git.user_email)
    - Hex color format valid (business.primary_color) -- only if present (optional)
    - Paths use forward slashes and start with /
    - No remaining {{TOKEN}} patterns in any string value
    - No remaining __HERMES_FILL__ placeholders (CRITICAL)
    - Optional: services/service_areas validated only when present (Flow A)

  Outputs a clear pass/fail report with colored messages per check.
  Returns a result object with overall status and individual checks.

.PARAMETER ConfigFile
  Path to the client configuration JSON file to validate.

.PARAMETER SchemaFile
  Path to the JSON schema file. Default: client-config.schema.json in the same directory.

.PARAMETER Quiet
  Suppress detailed output; only emit the final pass/fail line.

.EXAMPLE
  pwsh ./provision/validate-config.ps1 -ConfigFile ./provision/examples/acme-plumbing.json
  pwsh ./provision/validate-config.ps1 -ConfigFile ./clients/my-client.json -Quiet
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile,

    [string]$SchemaFile,

    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
if (-not $SchemaFile) { $SchemaFile = Join-Path $scriptDir 'client-config.schema.json' }

# ============================================================
# HELPERS
# ============================================================
function Write-Check {
    param([string]$Name, [bool]$Pass, [string]$Message, [string]$Severity = 'CRITICAL')
    if ($Quiet) { return }
    $icon = if ($Pass) { '+' } else { 'X' }
    $color = if ($Pass) { 'Green' } elseif ($Severity -eq 'WARN') { 'Yellow' } else { 'Red' }
    $tag = if ($Pass) { 'PASS' } elseif ($Severity -eq 'WARN') { 'WARN' } else { 'FAIL' }
    Write-Host ("  {0} [{1}] {2,-35} {3}" -f $icon, $tag, $Name, $Message) -ForegroundColor $color
}

function Resolve-JsonPath {
    # Navigate a nested property like "business.type" on a PSCustomObject
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

function Test-EmailFormat {
    param([string]$Value)
    return $Value -match '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
}

function Test-DomainFormat {
    param([string]$Value)
    # No protocol prefix, valid domain chars, at least one dot
    if ($Value -match '^https?://') { return $false }
    return $Value -match '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
}

function Test-SlugFormat {
    param([string]$Value)
    return $Value -match '^[a-z0-9]+(-[a-z0-9]+)*$'
}

function Test-HexColor {
    param([string]$Value)
    return $Value -match '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
}

function Test-ForwardSlashPath {
    param([string]$Value)
    return $Value -match '^/' -and $Value -notmatch '\\'
}

function Find-Tokens {
    # Recursively find any {{TOKEN}} patterns in all string values
    param($Obj, [string]$Prefix = '')
    $results = @()
    if ($null -eq $Obj) { return $results }
    if ($Obj -is [string]) {
        $matches_ = [regex]::Matches($Obj, '\{\{[A-Z_]+\}\}')
        foreach ($m in $matches_) {
            $results += @{ Path = $Prefix; Token = $m.Value }
        }
    } elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        $i = 0
        foreach ($item in $Obj) {
            $results += Find-Tokens $item "$Prefix[$i]"
            $i++
        }
    } elseif ($Obj.PSObject -and $Obj.PSObject.Properties) {
        foreach ($prop in $Obj.PSObject.Properties) {
            $childPath = if ($Prefix) { "$Prefix.$($prop.Name)" } else { $prop.Name }
            $results += Find-Tokens $prop.Value $childPath
        }
    }
    return $results
}

function Find-Placeholders {
    # Recursively find any '__HERMES_FILL__' sentinel left unfilled by the agent.
    param($Obj, [string]$Prefix = '')
    $results = @()
    if ($null -eq $Obj) { return $results }
    if ($Obj -is [string]) {
        if ($Obj -match '__HERMES_FILL__') { $results += $Prefix }
    } elseif ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        $i = 0
        foreach ($item in $Obj) {
            $results += Find-Placeholders $item "$Prefix[$i]"
            $i++
        }
    } elseif ($Obj.PSObject -and $Obj.PSObject.Properties) {
        foreach ($prop in $Obj.PSObject.Properties) {
            $childPath = if ($Prefix) { "$Prefix.$($prop.Name)" } else { $prop.Name }
            $results += Find-Placeholders $prop.Value $childPath
        }
    }
    return $results
}

# ============================================================
# VALIDATE
# ============================================================
if (-not $Quiet) {
    Write-Host ""
    Write-Host "=== validate-config ===" -ForegroundColor Cyan
    Write-Host "  Config: $ConfigFile"
    Write-Host ""
}

# --- 1. File exists and parses ---
$checks = @()
$criticalFail = $false

if (-not (Test-Path $ConfigFile)) {
    Write-Check 'File exists' $false "File not found: $ConfigFile"
    $checks += @{ Name = 'File exists'; Pass = $false; Severity = 'CRITICAL' }
    $criticalFail = $true
    # Return early -- nothing else to check
    $result = @{
        ConfigFile   = $ConfigFile
        Status       = 'FAIL'
        CriticalFail = $true
        Checks       = $checks
        TotalChecks  = $checks.Count
        Passed       = 0
        Failed       = $checks.Count
    }
    if (-not $Quiet) {
        Write-Host ""
        Write-Host '  VALIDATION FAILED -- config file not found.' -ForegroundColor Red
        Write-Host ""
    }
    return $result
}

try {
    $cfg = Get-Content -Raw -Path $ConfigFile -Encoding UTF8 | ConvertFrom-Json
    Write-Check 'JSON Parse' $true 'Valid JSON'
    $checks += @{ Name = 'JSON Parse'; Pass = $true; Severity = 'CRITICAL' }
} catch {
    Write-Check 'JSON Parse' $false "Invalid JSON: $($_.Exception.Message)"
    $checks += @{ Name = 'JSON Parse'; Pass = $false; Severity = 'CRITICAL' }
    $result = @{
        ConfigFile   = $ConfigFile
        Status       = 'FAIL'
        CriticalFail = $true
        Checks       = $checks
        TotalChecks  = $checks.Count
        Passed       = ($checks | Where-Object { $_.Pass }).Count
        Failed       = ($checks | Where-Object { -not $_.Pass }).Count
    }
    if (-not $Quiet) {
        Write-Host ""
        Write-Host '  VALIDATION FAILED -- could not parse JSON.' -ForegroundColor Red
        Write-Host ""
    }
    return $result
}

# --- 2. Required top-level string fields ---
$requiredStrings = @(
    @('slug',             'slug'),
    @('domain',           'domain'),
    @('site_name',        'site_name'),
    @('site_description', 'site_description'),
    @('owner_name',       'owner_name'),
    @('timezone',         'timezone'),
    @('timezone_abbr',    'timezone_abbr')
)

foreach ($field in $requiredStrings) {
    $label = $field[0]
    $path  = $field[1]
    $val   = Resolve-JsonPath $cfg $path
    $pass  = (-not [string]::IsNullOrWhiteSpace($val))
    Write-Check $label $pass $(if ($pass) { "= '$val'" } else { 'MISSING or empty' })
    $checks += @{ Name = $label; Pass = $pass; Severity = 'CRITICAL' }
    if (-not $pass) { $criticalFail = $true }
}

# --- 3. Required nested object fields ---
# Flow A (canonical): the engine only needs business.type/niche/audience/brand_voice.
# Contact/location/service fields (phone, address, city, state, primary_color,
# services, service_areas) are OPTIONAL -- this template does not generate a website.
# They are validated for FORMAT only when present (see Optional Fields below).
$requiredNested = @(
    @('business.type',        'business.type'),
    @('business.niche',       'business.niche'),
    @('business.audience',    'business.audience'),
    @('business.brand_voice', 'business.brand_voice'),
    @('paths.agent_root',     'paths.agent_root'),
    @('paths.site_root',      'paths.site_root'),
    @('paths.obsidian_root',  'paths.obsidian_root'),
    @('paths.db_path',        'paths.db_path'),
    @('paths.logs',           'paths.logs'),
    @('git.main_branch',      'git.main_branch'),
    @('git.remote',           'git.remote'),
    @('git.user_name',        'git.user_name'),
    @('git.user_email',       'git.user_email'),
    @('email.admin',          'email.admin'),
    @('email.from',           'email.from'),
    @('email.from_name',      'email.from_name'),
    @('apis.gsc_property',    'apis.gsc_property'),
    @('apis.serp_provider',   'apis.serp_provider'),
    @('apis.location',        'apis.location'),
    @('cloudflare.project_name',       'cloudflare.project_name'),
    @('cloudflare.production_branch',  'cloudflare.production_branch')
)

foreach ($field in $requiredNested) {
    $label = $field[0]
    $path  = $field[1]
    $val   = Resolve-JsonPath $cfg $path
    $pass  = ($null -ne $val -and -not [string]::IsNullOrWhiteSpace("$val"))
    $display = if ($pass) {
        $s = "$val"
        if ($s.Length -gt 60) { $s.Substring(0, 57) + '...' } else { $s }
    } else { 'MISSING or empty' }
    Write-Check $label $pass "= '$display'"
    $checks += @{ Name = $label; Pass = $pass; Severity = 'CRITICAL' }
    if (-not $pass) { $criticalFail = $true }
}

# --- 4. Optional array fields (services, service_areas) ---
# OPTIONAL in Flow A. Only reported (WARN) when present; absence is not a failure.
$services = Resolve-JsonPath $cfg 'business.services'
if ($null -ne $services) {
    $servPass = ($services.Count -gt 0 -and -not ($services -contains '__HERMES_FILL__'))
    Write-Check 'business.services' $servPass $(if ($servPass) { "$($services.Count) services defined" } else { 'present but empty or unfilled' }) 'WARN'
    $checks += @{ Name = 'business.services'; Pass = $servPass; Severity = 'WARN' }
}

$areas = Resolve-JsonPath $cfg 'business.service_areas'
if ($null -ne $areas) {
    $areasPass = ($areas.Count -gt 0 -and -not ($areas -contains '__HERMES_FILL__'))
    Write-Check 'business.service_areas' $areasPass $(if ($areasPass) { "$($areas.Count) areas defined" } else { 'present but empty or unfilled' }) 'WARN'
    $checks += @{ Name = 'business.service_areas'; Pass = $areasPass; Severity = 'WARN' }
}

# --- 5. Format validations ---
if (-not $Quiet) {
    Write-Host ""
    Write-Host "  --- Format Checks ---" -ForegroundColor Magenta
}

# Slug format
$slugVal = Resolve-JsonPath $cfg 'slug'
if ($slugVal) {
    $slugPass = Test-SlugFormat $slugVal
    Write-Check 'slug format' $slugPass $(if ($slugPass) { 'lowercase alphanumeric + hyphens' } else { 'Invalid: must be lowercase, no spaces, hyphens only' })
    $checks += @{ Name = 'slug format'; Pass = $slugPass; Severity = 'CRITICAL' }
    if (-not $slugPass) { $criticalFail = $true }
}

# Domain format
$domainVal = Resolve-JsonPath $cfg 'domain'
if ($domainVal) {
    $domainPass = Test-DomainFormat $domainVal
    Write-Check 'domain format' $domainPass $(if ($domainPass) { 'valid domain, no protocol' } else { 'Invalid: no http(s):// prefix, must be bare domain' })
    $checks += @{ Name = 'domain format'; Pass = $domainPass; Severity = 'CRITICAL' }
    if (-not $domainPass) { $criticalFail = $true }
}

# Email format
$emailFields = @(
    @('email.admin',    'email.admin'),
    @('email.from',     'email.from'),
    @('git.user_email', 'git.user_email')
)
foreach ($ef in $emailFields) {
    $val = Resolve-JsonPath $cfg $ef[1]
    if ($val) {
        $emailPass = Test-EmailFormat $val
        Write-Check "$($ef[0]) format" $emailPass $(if ($emailPass) { 'valid email' } else { "Invalid email: '$val'" })
        $checks += @{ Name = "$($ef[0]) format"; Pass = $emailPass; Severity = 'CRITICAL' }
        if (-not $emailPass) { $criticalFail = $true }
    }
}

# Hex color format
$colorVal = Resolve-JsonPath $cfg 'business.primary_color'
if ($colorVal) {
    $colorPass = Test-HexColor $colorVal
    Write-Check 'primary_color format' $colorPass $(if ($colorPass) { 'valid hex color' } else { 'Invalid hex color -- must be #RGB or #RRGGBB' })
    $checks += @{ Name = 'primary_color format'; Pass = $colorPass; Severity = 'CRITICAL' }
    if (-not $colorPass) { $criticalFail = $true }
}

# Path format (forward slashes, starts with /)
$pathFields = @('paths.agent_root', 'paths.site_root', 'paths.obsidian_root', 'paths.db_path', 'paths.logs')
foreach ($pf in $pathFields) {
    $val = Resolve-JsonPath $cfg $pf
    if ($val) {
        $pathPass = Test-ForwardSlashPath $val
        Write-Check "$pf format" $pathPass $(if ($pathPass) { 'forward slashes, absolute' } else { 'Invalid: must start with / and use forward slashes' })
        $checks += @{ Name = "$pf format"; Pass = $pathPass; Severity = 'CRITICAL' }
        if (-not $pathPass) { $criticalFail = $true }
    }
}

# Cloudflare project name format
$cfName = Resolve-JsonPath $cfg 'cloudflare.project_name'
if ($cfName) {
    $cfPass = Test-SlugFormat $cfName
    Write-Check 'cloudflare.project_name format' $cfPass $(if ($cfPass) { 'valid slug' } else { 'Invalid: must be lowercase with hyphens' })
    $checks += @{ Name = 'cloudflare.project_name format'; Pass = $cfPass; Severity = 'CRITICAL' }
    if (-not $cfPass) { $criticalFail = $true }
}

# Timezone format
$tzVal = Resolve-JsonPath $cfg 'timezone'
if ($tzVal) {
    $tzPass = $tzVal -match '^[A-Za-z]+/[A-Za-z_]+$'
    Write-Check 'timezone format' $tzPass $(if ($tzPass) { 'valid IANA format' } else { 'Invalid: must be Area/Location (e.g., America/Chicago)' })
    $checks += @{ Name = 'timezone format'; Pass = $tzPass; Severity = 'WARN' }
}

$tzAbbrVal = Resolve-JsonPath $cfg 'timezone_abbr'
if ($tzAbbrVal) {
    $tzaPass = $tzAbbrVal -match '^[A-Z]{2,5}$'
    Write-Check 'timezone_abbr format' $tzaPass $(if ($tzaPass) { 'valid abbreviation' } else { 'Invalid: must be 2-5 uppercase letters' })
    $checks += @{ Name = 'timezone_abbr format'; Pass = $tzaPass; Severity = 'WARN' }
}

# --- 6. Token residue check ---
if (-not $Quiet) {
    Write-Host ""
    Write-Host "  --- Token Residue Check ---" -ForegroundColor Magenta
}

$tokenHits = Find-Tokens $cfg
$tokenPass = ($tokenHits.Count -eq 0)
if ($tokenPass) {
    Write-Check 'No {{TOKEN}} residue' $true 'All values are filled'
} else {
    Write-Check 'No {{TOKEN}} residue' $false "$($tokenHits.Count) unfilled token(s) found" 'CRITICAL'
    foreach ($hit in $tokenHits) {
        if (-not $Quiet) {
            Write-Host ("      {0}: {1}" -f $hit.Path, $hit.Token) -ForegroundColor Yellow
        }
    }
    $criticalFail = $true
}
$checks += @{ Name = 'No {{TOKEN}} residue'; Pass = $tokenPass; Severity = 'CRITICAL' }

# --- 7. Hermes placeholder residue check ---
# bootstrap-to-config.ps1 writes '__HERMES_FILL__' for AI-judged fields. If any
# survive, customize.ps1 would bake the literal sentinel across the engine. CRITICAL.
if (-not $Quiet) {
    Write-Host ""
    Write-Host "  --- Hermes Placeholder Check ---" -ForegroundColor Magenta
}

$fillHits = Find-Placeholders $cfg
$fillPass = ($fillHits.Count -eq 0)
if ($fillPass) {
    Write-Check 'No __HERMES_FILL__ residue' $true 'All AI-judged fields are filled'
} else {
    Write-Check 'No __HERMES_FILL__ residue' $false "$($fillHits.Count) unfilled field(s) -- Hermes must complete these" 'CRITICAL'
    foreach ($hit in $fillHits) {
        if (-not $Quiet) {
            Write-Host ("      $hit") -ForegroundColor Yellow
        }
    }
    $criticalFail = $true
}
$checks += @{ Name = 'No __HERMES_FILL__ residue'; Pass = $fillPass; Severity = 'CRITICAL' }

# ============================================================
# SUMMARY
# ============================================================
$passed = ($checks | Where-Object { $_.Pass }).Count
$failed = ($checks | Where-Object { -not $_.Pass }).Count
$total  = $checks.Count

if (-not $Quiet) {
    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor White
    if ($criticalFail) {
        Write-Host "  VALIDATION FAILED  ($passed/$total passed, $failed failed)" -ForegroundColor Red
    } else {
        Write-Host "  VALIDATION PASSED  ($passed/$total checks passed)" -ForegroundColor Green
    }
    Write-Host "  ========================================" -ForegroundColor White
    Write-Host ""
}

$result = @{
    ConfigFile   = $ConfigFile
    Status       = if ($criticalFail) { 'FAIL' } else { 'PASS' }
    CriticalFail = $criticalFail
    Checks       = $checks
    TotalChecks  = $total
    Passed       = $passed
    Failed       = $failed
}

return $result
