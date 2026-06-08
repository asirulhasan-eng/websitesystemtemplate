# setup/ — Customization automation

This folder holds the tooling that retargets the template to a new client.

## `customize.ps1`

Reads the master profile (`../site.config.json`) and performs every **deterministic**
rewrite, then reports the **judgment** work that's left for the AI.

### What it changes (deterministic)

- `/opt/<legacy>` paths → your `paths.*`
- legacy `base_url` / `domain` → yours
- env-var prefix `PLUMBINGSEO_*` → `<SLUG>_*` (17 vars)
- legacy brand / site name → `site_name`
- legacy slug stems (`plumbingseo`, `plumbingseoagent`, `plumbingseosite`,
  `plumbingsiteobsidian`, `plumbingsitesqlite`) → your `slug`-based names
- skill folder `skills/plumbingseo/` → `skills/<slug>/`, and `plumbingseo-*` subfolders → `<slug>-*`

### What it does NOT change (judgment — left to Hermes/you)

Niche prose: "plumbing", "plumber(s)", keyword strategy, brand voice, examples. After a
run it prints a **residual list** of every file still containing those words, so you know
exactly what to hand to the AI (see [TEMPLATE.md](../TEMPLATE.md) Tiers 2–3 and
[SETUP.md](../SETUP.md) Step 4).

### Usage

```powershell
pwsh ./setup/customize.ps1                 # DRY RUN (default) — reports, writes nothing
pwsh ./setup/customize.ps1 -Apply          # apply changes + rename folders
pwsh ./setup/customize.ps1 -ConfigPath X   # use a different profile file
```

The only parameters are `-ConfigPath` and `-Apply`.

### Scope & safety

- **Scope:** all three content roots are scanned — `Agentic SEO/` (the engine),
  `Website/` (the owner's imported site), and `Obsidian Agent Brain/`. Root-level
  meta-docs (`site.config.json`, `TEMPLATE.md`, `SETUP.md`, `README.md`,
  `SKILL-SETUP-GUIDE.md`, `SETUP-CHECKLIST.md`) and the `setup/` scripts themselves
  are outside these roots and are never touched.
- **Always excluded:** `node_modules/` and `.git/`.
- **Pre-flight guard:** if any value in `site.config.json` is still `__HERMES_FILL__`
  or an unfilled `{{TOKEN}}`, customize aborts before writing — so the sentinel is
  never baked across the engine. Fill those fields first (Onboarding Phase 2).
- **Dry run is the default.** Nothing is written until you pass `-Apply`.
- **Ordering is deliberate:** the most-specific replacements (full `/opt` paths, full URLs)
  run before broader ones (bare slug) so a wide rule never clobbers a narrow one.
- **Run on a fresh copy** of the template, not on an already-customized one.

### Notes

- Files are written back as **UTF-8 without BOM** to stay compatible with Node/git.
- Keep all strings in this script **ASCII** — Windows PowerShell 5.1 reads the file as ANSI,
  and a stray smart-quote/em-dash will break parsing.
