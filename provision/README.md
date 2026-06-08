# provision/ — Optional multi-client orchestrator

> **This is optional automation, not a second system.** The canonical way to stand up one
> client is the manual runbook in **[../SETUP.md](../SETUP.md)** (copy the folder, fill
> `site.config.json`, run `setup/customize.ps1`). The orchestrator here simply **sequences
> those same scripts** for you and adds per-client isolation, repo/Cloudflare creation, and a
> registry — useful once you're onboarding clients regularly. Nothing in `setup/` depends on
> this folder; you can ignore it entirely and follow SETUP.md.

## How the layers fit together

`provision-site.ps1` is the **orchestrator**. `setup/customize.ps1`, `analyze-website.ps1`,
and `inject-skills.ps1` are the **primitives** it calls — the same ones SETUP.md runs by hand.

```
(optional) bootstrap.json ──► bootstrap-to-config.ps1 ──► site.config.json   ← canonical profile
                                                               │
                                                    validate-config.ps1       ← gate (CRITICAL fails)
                                                               │
        provision-site.ps1  (ORCHESTRATOR) ───────────────────┤  copies template → sites/{slug}/, then runs:
                                                               ├─ setup/customize.ps1            (fill {{TOKENS}})
                                                               ├─ setup/analyze-website.ps1      → website-profile.json
                                                               ├─ setup/inject-skills.ps1        (deep skill fill)
                                                               ├─ setup/generate-scaffold-config.ps1
                                                               ├─ create GitHub repo  (-SetupGit)
                                                               ├─ create Cloudflare project (-SetupCloudflare)
                                                               ├─ register in registry.json
                                                               └─ validation/validate-site.ps1
```

Because it copies the template into `sites/{slug}/` **before** filling tokens, your master
template is never mutated — this is the orchestrated equivalent of SETUP.md's Step 0.

## Scripts

| Script | Purpose |
|---|---|
| `provision-site.ps1` | Master orchestrator. Copies the template per client and runs every step above. **Dry-run by default; pass `-Apply` to execute.** |
| `bootstrap-to-config.ps1` | *(optional)* Turn a minimal `bootstrap.json` (slug, domain, owner, timezone, admin email) into a full `site.config.json`, deriving paths/git/apis and marking AI-judged business fields as `__HERMES_FILL__`. |
| `validate-config.ps1` | Validate a `site.config.json` against the schema (required fields, formats, no `{{TOKEN}}` / `__HERMES_FILL__` residue). Run before provisioning. |
| `deprovision-site.ps1` | Tear down a provisioned site / remove its registry entry. |
| `apply-template.ps1` | Standalone, **un-wired** website generator. Not part of the canonical flow (the owner brings their own website — Flow A). Kept for reference only. |

## Usage

```powershell
# 0. (optional) generate site.config.json from a minimal bootstrap
pwsh ./provision/bootstrap-to-config.ps1 -BootstrapFile ./provision/examples/bootstrap-acme.json -Apply

# 1. validate the profile
pwsh ./provision/validate-config.ps1 -ConfigFile ./site.config.json

# 2. preview the full provision (writes nothing)
pwsh ./provision/provision-site.ps1 -ConfigFile ./site.config.json

# 3. provision for real (optionally create the repo + Cloudflare project)
pwsh ./provision/provision-site.ps1 -ConfigFile ./site.config.json -Apply -SetupGit -SetupCloudflare
```

| Flag | Effect |
|---|---|
| `-Apply` | Actually copy, fill, and register. Without it, everything is a dry run. |
| `-OutputDir` | Where to create the client copy. Default: `provision/sites/{slug}/`. |
| `-SetupGit` | `gh repo create` a private repo and push (requires GitHub CLI). |
| `-SetupCloudflare` | `wrangler pages project create` (requires wrangler). |
| `-Force` | Overwrite an existing output directory. |

## Relationship to the manual flow

Anything the orchestrator does, you can do by hand with SETUP.md — and vice versa. Pick the
manual flow for a one-off; reach for the orchestrator when the per-command repetition (copy,
fill, repo, Cloudflare, register) starts to cost you. They never disagree because they run the
same primitives.
