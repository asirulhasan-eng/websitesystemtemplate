<#
.SYNOPSIS
  Master provisioning orchestrator for the Website Autopilot System.

.DESCRIPTION
  Takes a client configuration JSON and provisions a complete site instance:

  Step 1: Validate config (calls validate-config.ps1)
  Step 2: Create output directory structure (copies the owner's imported Website/)
  Step 3: Copy site.config.json into the output
  Step 4: Run customize.ps1 to fill all engine tokens
  Step 5: Run analyze-website.ps1 to generate website-profile.json
  Step 6: Run inject-skills.ps1 with the generated profile
  Step 7: Run generate-scaffold-config.ps1
  Step 8: Create GitHub repo (if -SetupGit)
  Step 9: Configure Cloudflare Pages (if -SetupCloudflare)
  Step 10: Register site in registry.json
  Step 11: Run validation pipeline (calls validate-site.ps1)
  Step 12: Output summary report

  Flow A (canonical): the owner provides their own website (Simply Static export);
  this orchestrator does NOT generate a site from templates. See Architecture
  Decision #2 and Agentic SEO/processes/new-site-onboarding.md.

  Dry-run by default. Pass -Apply to execute.

.PARAMETER ConfigFile
  Path to the client configuration JSON file. Required.

.PARAMETER OutputDir
  Directory to create the provisioned site in. Default: ./sites/{slug}/

.PARAMETER Apply
  Actually execute all steps. Without this, only previews.

.PARAMETER SetupGit
  Create a GitHub repo via 'gh repo create'. Requires GitHub CLI.

.PARAMETER SetupCloudflare
  Create Cloudflare Pages project via wrangler. Requires wrangler CLI.

.PARAMETER Force
  Skip confirmation prompts.

.EXAMPLE
  pwsh ./provision/provision-site.ps1 -ConfigFile ./examples/acme-plumbing.json
  pwsh ./provision/provision-site.ps1 -ConfigFile ./examples/acme-plumbing.json -Apply
  pwsh ./provision/provision-site.ps1 -ConfigFile ./examples/acme-plumbing.json -Apply -SetupGit -SetupCloudflare
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile,

    [string]$OutputDir,

    [switch]$Apply,
    [switch]$SetupGit,
    [switch]$SetupCloudflare,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$scriptDir = $PSScriptRoot
$repoRoot  = Split-Path -Parent $scriptDir

$startTime = Get-Date

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "         Website Autopilot -- Site Provisioner              " -ForegroundColor Cyan
$modeLabel = if ($Apply) { '          *** APPLY MODE ***' } else { '            (DRY RUN)' }
Write-Host ("         " + $modeLabel) -ForegroundColor $(if ($Apply) { 'Yellow' } else { 'Green' })
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# HELPERS
# ============================================================
$stepNum    = 0
$stepErrors = @()

function Start-Step {
    param([string]$Name)
    $script:stepNum++
    Write-Host ""
    Write-Host ("  Step {0:D2}: {1}" -f $script:stepNum, $Name) -ForegroundColor White
}

function Complete-Step {
    param([string]$Message, [bool]$Success = $true)
    $tag   = if ($Success) { '[OK]' } else { '[FAIL]' }
    $color = if ($Success) { 'Green' } else { 'Red' }
    Write-Host ("    {0} {1}" -f $tag, $Message) -ForegroundColor $color
}

function Fail-Step {
    param([string]$Message)
    $script:stepErrors += @{ Step = $script:stepNum; Message = $Message }
    Complete-Step $Message $false
}

function Stop-IfFailed {
    param([string]$Message)
    if ($stepErrors.Count -gt 0) {
        Write-Host ""
        Write-Host ("  [FAIL] PROVISIONING HALTED: " + $Message) -ForegroundColor Red
        $lastErr = $stepErrors[-1]
        Write-Host ("    Failed at step " + $lastErr.Step + ": " + $lastErr.Message) -ForegroundColor Red
        Write-Host ""
        throw ("Provisioning failed at step " + $lastErr.Step)
    }
}

function Copy-Tree {
    # Recursively copy a directory, excluding node_modules and .git at ANY depth.
    # PowerShell's Copy-Item -Exclude only matches top-level leaf names, so nested
    # node_modules would otherwise be copied wholesale (M2).
    param([string]$Src, [string]$Dst)
    $excludeDirNames = @('node_modules', '.git')
    $srcFull = (Resolve-Path $Src).Path
    New-Item -Path $Dst -ItemType Directory -Force | Out-Null
    Get-ChildItem -Path $srcFull -Recurse -Force | ForEach-Object {
        $rel = $_.FullName.Substring($srcFull.Length).TrimStart('\', '/')
        # Skip anything inside an excluded directory
        $skip = $false
        foreach ($ex in $excludeDirNames) {
            if ($rel -match "(^|[\\/])$([regex]::Escape($ex))([\\/]|$)") { $skip = $true; break }
        }
        if ($skip) { return }
        $target = Join-Path $Dst $rel
        if ($_.PSIsContainer) {
            if (-not (Test-Path $target)) { New-Item -Path $target -ItemType Directory -Force | Out-Null }
        } else {
            $targetDir = Split-Path -Parent $target
            if (-not (Test-Path $targetDir)) { New-Item -Path $targetDir -ItemType Directory -Force | Out-Null }
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }
}

# ============================================================
# PRE-FLIGHT: Load config for slug/domain
# ============================================================
if (-not (Test-Path $ConfigFile)) {
    throw "Config file not found: $ConfigFile"
}

$cfg = Get-Content -Raw -Path $ConfigFile -Encoding UTF8 | ConvertFrom-Json
$slug   = $cfg.slug
$domain = $cfg.domain

Write-Host "  Client:  $($cfg.site_name) ($domain)" -ForegroundColor White
Write-Host "  Slug:    $slug" -ForegroundColor White
Write-Host "  Config:  $ConfigFile" -ForegroundColor White

if (-not $OutputDir) {
    $OutputDir = Join-Path $scriptDir "sites/$slug"
}
Write-Host "  Output:  $OutputDir" -ForegroundColor White
Write-Host ""

# ============================================================
# STEP 1: Validate config
# ============================================================
Start-Step 'Validate client configuration'

$validateScript = Join-Path $scriptDir 'validate-config.ps1'
if (-not (Test-Path $validateScript)) {
    Fail-Step 'validate-config.ps1 not found'
    Stop-IfFailed 'Validation script missing'
}

$validationResult = & $validateScript -ConfigFile $ConfigFile -Quiet
if ($validationResult.Status -eq 'FAIL') {
    $errCount = $validationResult.Failed
    Fail-Step ('Config validation failed (' + $errCount + ' errors)')
    Write-Host "       Run validate-config.ps1 directly for details." -ForegroundColor Yellow
    Stop-IfFailed 'Config validation failed'
} else {
    $passInfo = '' + $validationResult.Passed + '/' + $validationResult.TotalChecks + ' checks passed'
    Complete-Step ('Config valid (' + $passInfo + ')')
}

# ============================================================
# STEP 2: Create output directory structure
# ============================================================
Start-Step 'Create output directory structure'

$websiteDir  = Join-Path $OutputDir 'Website'
$agenticDir  = Join-Path $OutputDir 'Agentic SEO'
$obsidianDir = Join-Path $OutputDir 'Obsidian Agent Brain'
$setupDir    = Join-Path $OutputDir 'setup'

if ($Apply) {
    if (Test-Path $OutputDir) {
        if (-not $Force) {
            Fail-Step ("Output directory already exists: $OutputDir (use -Force to overwrite)")
            Stop-IfFailed 'Output directory exists'
        } else {
            Write-Host "    [WARN] -Force: overwriting existing $OutputDir" -ForegroundColor Yellow
        }
    }

    # Copy the template repo structure (node_modules/.git excluded at any depth)
    $sourceDirs = @(
        @{ Src = (Join-Path $repoRoot 'Website');              Dst = $websiteDir },
        @{ Src = (Join-Path $repoRoot 'Agentic SEO');          Dst = $agenticDir },
        @{ Src = (Join-Path $repoRoot 'Obsidian Agent Brain'); Dst = $obsidianDir },
        @{ Src = (Join-Path $repoRoot 'setup');                Dst = $setupDir }
    )

    foreach ($pair in $sourceDirs) {
        if (Test-Path $pair.Src) {
            if ((Test-Path $pair.Dst) -and $Force) {
                Remove-Item -LiteralPath $pair.Dst -Recurse -Force
            }
            if (-not (Test-Path $pair.Dst)) {
                Copy-Tree -Src $pair.Src -Dst $pair.Dst
                Write-Host ("    Copied " + (Split-Path -Leaf $pair.Src) + "/") -ForegroundColor Gray
            } else {
                Write-Host ("    " + (Split-Path -Leaf $pair.Dst) + "/ already exists") -ForegroundColor DarkGray
            }
        } else {
            Write-Host ("    [WARN] Source not found: " + $pair.Src) -ForegroundColor Yellow
        }
    }
    Complete-Step ('Directory structure created at ' + $OutputDir)
} else {
    Write-Host "    Would create: $OutputDir" -ForegroundColor DarkGray
    Write-Host "    Would copy: Website/, Agentic SEO/, Obsidian Agent Brain/, setup/" -ForegroundColor DarkGray
    Complete-Step '(dry run -- no directories created)'
}

# ============================================================
# STEP 3: Copy site.config.json
# ============================================================
Start-Step 'Copy site.config.json into output'

$destConfig = Join-Path $OutputDir 'site.config.json'
if ($Apply) {
    Copy-Item -Path $ConfigFile -Destination $destConfig -Force
    Complete-Step ('Copied to ' + $destConfig)
} else {
    Write-Host "    Would copy $ConfigFile -> $destConfig" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 4: Run customize.ps1
# ============================================================
Start-Step 'Run customize.ps1 (token replacement)'

$customizeScript = Join-Path $setupDir 'customize.ps1'
if ($Apply) {
    # Run the COPY inside the output (never the template source -- customize.ps1
    # derives its scan root from its own location, so running the source would
    # mutate the master template in place; M3).
    if (Test-Path $customizeScript) {
        & $customizeScript -ConfigPath $destConfig -Apply
        Complete-Step 'Token replacement complete'
    } else {
        Fail-Step 'customize.ps1 not found in output (Step 2 copy may have failed)'
        Stop-IfFailed 'customize.ps1 missing'
    }
} else {
    Write-Host "    Would run: customize.ps1 -ConfigPath $destConfig -Apply" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# (Website generation is NOT part of the canonical flow.)
# Flow A: the owner imports their own website into Website/ (exported via Simply
# Static). It was copied in Step 2; customize.ps1 (Step 4) fills its engine tokens.
# The old apply-template.ps1 generator is retained as an optional standalone tool
# (see its header) but is intentionally not invoked here. See Architecture Decision #2.
# ============================================================

# ============================================================
# STEP 6: Run analyze-website.ps1
# ============================================================
Start-Step 'Analyze website (generate website-profile.json)'

$analyzeScript = if ($Apply -and (Test-Path (Join-Path $setupDir 'analyze-website.ps1'))) {
    Join-Path $setupDir 'analyze-website.ps1'
} else {
    Join-Path $repoRoot 'setup/analyze-website.ps1'
}
$profileOutput = Join-Path $OutputDir 'website-profile.json'

if ($Apply) {
    if (Test-Path $analyzeScript) {
        & $analyzeScript -WebsitePath $websiteDir -OutputPath $profileOutput
        Complete-Step ('Profile generated: ' + $profileOutput)
    } else {
        Write-Host "    [WARN] analyze-website.ps1 not found" -ForegroundColor Yellow
        Complete-Step '(skipped)' $false
    }
} else {
    Write-Host "    Would run: analyze-website.ps1 -WebsitePath $websiteDir" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 7: Run inject-skills.ps1
# ============================================================
Start-Step 'Inject skills with profile data'

$injectScript = if ($Apply -and (Test-Path (Join-Path $setupDir 'inject-skills.ps1'))) {
    Join-Path $setupDir 'inject-skills.ps1'
} else {
    Join-Path $repoRoot 'setup/inject-skills.ps1'
}

if ($Apply) {
    if (Test-Path $injectScript) {
        $injectArgs = @{
            ConfigPath  = $destConfig
            ProfilePath = $profileOutput
            SkillsDir   = Join-Path $agenticDir 'tools'
            Apply       = $true
        }
        & $injectScript @injectArgs
        Complete-Step 'Skills injected'
    } else {
        Write-Host "    [WARN] inject-skills.ps1 not found" -ForegroundColor Yellow
        Complete-Step '(skipped)' $false
    }
} else {
    Write-Host "    Would run: inject-skills.ps1" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 8: Run generate-scaffold-config.ps1
# ============================================================
Start-Step 'Generate scaffold configuration'

$scaffoldScript = if ($Apply -and (Test-Path (Join-Path $setupDir 'generate-scaffold-config.ps1'))) {
    Join-Path $setupDir 'generate-scaffold-config.ps1'
} else {
    Join-Path $repoRoot 'setup/generate-scaffold-config.ps1'
}

if ($Apply) {
    if (Test-Path $scaffoldScript) {
        & $scaffoldScript -ProfilePath $profileOutput -ConfigPath $destConfig -OutputPath (Join-Path $agenticDir 'tools/scaffold-config.json')
        Complete-Step 'Scaffold config generated'
    } else {
        Write-Host "    [WARN] generate-scaffold-config.ps1 not found" -ForegroundColor Yellow
        Complete-Step '(skipped)' $false
    }
} else {
    Write-Host "    Would run: generate-scaffold-config.ps1" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 9: Create GitHub repo
# ============================================================
Start-Step 'Create GitHub repository'

if ($SetupGit) {
    $repoName = $cfg.cloudflare.project_name
    if (-not $repoName) { $repoName = $slug }

    if ($Apply) {
        try {
            $ghCheck = & gh --version 2>&1
            if ($LASTEXITCODE -ne 0) { throw 'gh CLI not installed' }

            Write-Host "    Creating repo: $repoName" -ForegroundColor Gray
            & gh repo create $repoName --private --source $OutputDir --push 2>&1
            if ($LASTEXITCODE -eq 0) {
                Complete-Step ("GitHub repo '" + $repoName + "' created and pushed")
            } else {
                Fail-Step ('gh repo create failed (exit code ' + $LASTEXITCODE + ')')
            }
        }
        catch {
            Fail-Step ('GitHub setup failed: ' + $_.Exception.Message)
        }
    } else {
        Write-Host "    Would run: gh repo create $repoName --private --source $OutputDir --push" -ForegroundColor DarkGray
        Complete-Step '(dry run)'
    }
} else {
    Write-Host "    Skipped (use -SetupGit to enable)" -ForegroundColor DarkGray
    Complete-Step '(skipped)'
}

# ============================================================
# STEP 10: Configure Cloudflare Pages
# ============================================================
Start-Step 'Configure Cloudflare Pages'

if ($SetupCloudflare) {
    $cfProject = $cfg.cloudflare.project_name
    $cfBranch  = $cfg.cloudflare.production_branch

    if ($Apply) {
        try {
            Write-Host "    Creating Cloudflare Pages project: $cfProject" -ForegroundColor Gray
            & npx wrangler pages project create $cfProject --production-branch $cfBranch 2>&1
            if ($LASTEXITCODE -eq 0) {
                Complete-Step ("Cloudflare Pages project '" + $cfProject + "' created")
            } else {
                Fail-Step ('wrangler pages project create failed (exit code ' + $LASTEXITCODE + ')')
            }
        }
        catch {
            Fail-Step ('Cloudflare setup failed: ' + $_.Exception.Message)
        }
    } else {
        Write-Host "    Would run: npx wrangler pages project create $cfProject --production-branch $cfBranch" -ForegroundColor DarkGray
        Complete-Step '(dry run)'
    }
} else {
    Write-Host "    Skipped (use -SetupCloudflare to enable)" -ForegroundColor DarkGray
    Complete-Step '(skipped)'
}

# ============================================================
# STEP 11: Register site in registry.json
# ============================================================
Start-Step 'Register site in registry'

$registryPath = Join-Path $scriptDir 'registry.json'

if ($Apply) {
    $registry = @{ sites = @(); _schema_version = '1.0.0' }
    if (Test-Path $registryPath) {
        try {
            $registry = Get-Content -Raw -Path $registryPath -Encoding UTF8 | ConvertFrom-Json
            if ($null -eq $registry.sites) {
                $registry | Add-Member -NotePropertyName 'sites' -NotePropertyValue @() -Force
            }
        }
        catch {
            Write-Host "    [WARN] Could not parse existing registry -- creating new" -ForegroundColor Yellow
            $registry = @{ sites = @(); _schema_version = '1.0.0' }
        }
    }

    # Check for existing entry
    $existingIdx = -1
    for ($i = 0; $i -lt $registry.sites.Count; $i++) {
        if ($registry.sites[$i].slug -eq $slug) { $existingIdx = $i; break }
    }

    $entry = @{
        slug            = $slug
        domain          = $domain
        site_name       = $cfg.site_name
        config_file     = (Resolve-Path $ConfigFile -ErrorAction SilentlyContinue).Path
        output_dir      = $OutputDir
        provisioned_at  = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        template        = if ($cfg.template) { $cfg.template } else { 'local-business' }
        status          = 'provisioned'
    }

    if ($existingIdx -ge 0) {
        $sitesList = [System.Collections.ArrayList]@($registry.sites)
        $sitesList[$existingIdx] = $entry
        $registry.sites = $sitesList.ToArray()
        Write-Host "    Updated existing entry for '$slug'" -ForegroundColor Gray
    } else {
        $sitesList = [System.Collections.ArrayList]@($registry.sites)
        $sitesList.Add($entry) | Out-Null
        $registry.sites = $sitesList.ToArray()
        Write-Host "    Added new entry for '$slug'" -ForegroundColor Gray
    }

    $registryJson = $registry | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($registryPath, $registryJson, $utf8)
    $totalSites = $registry.sites.Count
    Complete-Step ("Registered '" + $slug + "' in registry.json (" + $totalSites + " total sites)")
} else {
    Write-Host "    Would register '$slug' in $registryPath" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 12: Run validation pipeline
# ============================================================
Start-Step 'Run validation pipeline'

$validateSiteScript = Join-Path $repoRoot 'validation/validate-site.ps1'

if ($Apply) {
    if (Test-Path $validateSiteScript) {
        try {
            $valResult = & $validateSiteScript -SitePath $OutputDir
            if ($valResult.Status -eq 'PASS') {
                $chkInfo = '' + $valResult.Passed + '/' + $valResult.TotalChecks + ' checks'
                Complete-Step ('Validation passed (' + $chkInfo + ')')
            } else {
                $failCount = $valResult.Failed
                Write-Host ("    [WARN] Validation reported issues (" + $failCount + " failures)") -ForegroundColor Yellow
                Complete-Step 'Validation completed with warnings' $false
            }
        }
        catch {
            Write-Host ("    [WARN] Validation error: " + $_.Exception.Message) -ForegroundColor Yellow
            Complete-Step '(validation error -- review manually)' $false
        }
    } else {
        Write-Host "    [INFO] validate-site.ps1 not found -- skipping" -ForegroundColor DarkGray
        Complete-Step '(skipped -- validate-site.ps1 not found)'
    }
} else {
    Write-Host "    Would run: validate-site.ps1 -SitePath $OutputDir" -ForegroundColor DarkGray
    Complete-Step '(dry run)'
}

# ============================================================
# STEP 13: Summary report
# ============================================================
$endTime  = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "                  PROVISIONING REPORT                       " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Client:       $($cfg.site_name)" -ForegroundColor White
Write-Host "  Domain:       $domain" -ForegroundColor White
Write-Host "  Slug:         $slug" -ForegroundColor White
Write-Host "  Output:       $OutputDir" -ForegroundColor White
Write-Host ("  Duration:     " + $duration.TotalSeconds.ToString('F1') + "s") -ForegroundColor White
$modeStr = if ($Apply) { 'APPLIED' } else { 'DRY RUN' }
Write-Host "  Mode:         $modeStr" -ForegroundColor $(if ($Apply) { 'Yellow' } else { 'Green' })
Write-Host ("  Steps:        " + $stepNum + " total, " + $stepErrors.Count + " errors") -ForegroundColor $(if ($stepErrors.Count -gt 0) { 'Red' } else { 'Green' })

if ($stepErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "  --- Errors ---" -ForegroundColor Red
    foreach ($err in $stepErrors) {
        Write-Host ("    Step " + $err.Step + ": " + $err.Message) -ForegroundColor Red
    }
}

if (-not $Apply) {
    Write-Host ""
    Write-Host "  This was a DRY RUN. Re-run with -Apply to provision." -ForegroundColor Green
    Write-Host "  Full command:" -ForegroundColor Gray
    $fullCmd = "  pwsh ./provision/provision-site.ps1 -ConfigFile `"$ConfigFile`" -Apply"
    if ($SetupGit) { $fullCmd += ' -SetupGit' }
    if ($SetupCloudflare) { $fullCmd += ' -SetupCloudflare' }
    Write-Host "  $fullCmd" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Yellow
    Write-Host "    1. Review the output in $OutputDir" -ForegroundColor Gray
    Write-Host "    2. Set up .env with API keys on the Linux server" -ForegroundColor Gray
    Write-Host "    3. Deploy to Cloudflare Pages: git push" -ForegroundColor Gray
    Write-Host "    4. Configure DNS for $domain -> Cloudflare" -ForegroundColor Gray
    Write-Host "    5. Start the Hermes agent" -ForegroundColor Gray
}
Write-Host ""

return @{
    Slug        = $slug
    Domain      = $domain
    SiteName    = $cfg.site_name
    OutputDir   = $OutputDir
    Applied     = $Apply.IsPresent
    StepCount   = $stepNum
    Errors      = $stepErrors
    Duration    = $duration
}
