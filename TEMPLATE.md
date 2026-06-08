> ✅ **STATUS: conversion complete.** This folder is already a neutral template — the
> plumbing build has been genericized (business identity → `{{TOKENS}}`, namespace →
> `client`, website → placeholder, brain → seed, secrets → placeholders) by
> `setup/make-template.ps1`. To stand up a client, follow **[SETUP.md](SETUP.md)** and run
> `setup/customize.ps1`. The manifest below is kept as **reference** — it documents what
> each area contains and the reusable-vs-per-client split. Some path/name examples still
> show the original plumbing identifiers to explain what was migrated.

# TEMPLATE.md — Website Autopilot System: Setup & Customization Manifest

> **Purpose.** This repo is a reusable template for an agentic SEO/content autopilot
> built around the **Hermes** agent. It was first built for a plumbing SEO agency
> (`plumbingseo.agency`). This manifest tells an operator — or Hermes itself — exactly
> what must be customized to retarget the system to a **new client/site/niche**.
>
> **This is a brief for an AI brain, not a rigid token map.** Where a change is
> deterministic (paths, URLs, the namespace slug), exact rules are given. Where a change
> requires understanding the new business (strategy, prose, keywords), the *intent and
> context* are given and Hermes is expected to reason and rewrite — not blindly substitute.
>
> **Golden rule:** after setup, `grep -ri "plumb" .` (outside `.git/`) must return **zero**
> hits. Any remaining "plumb*" is an un-migrated file.

---

## 0. The customization profile (single source of truth)

Before touching files, fill in this profile. Everything downstream derives from it.
Store the answers in `Agentic SEO/config/site.json` (the existing master config) — that
file is the canonical home. This block is the human-readable version of the same data.

```
SLUG                # generic namespace, replaces "plumbingseo". Use: client
DOMAIN              # e.g. acme-roofing.com
BASE_URL            # https://{DOMAIN}
SITE_NAME           # e.g. "Acme Roofing SEO"
BUSINESS_TYPE       # e.g. "SEO Agency" | "Local Service Business" | "SaaS"
NICHE               # e.g. "Roofing companies"  (replaces "Plumbing companies")
AUDIENCE            # who the content speaks to (replaces "plumbing business owners")
BRAND_VOICE         # tone rules for content (replaces the plumbing brand-voice block)
ADMIN_EMAIL         # owner inbox for approvals/alerts
FROM_EMAIL          # agent's sending address, e.g. seo-agent@{DOMAIN}
TIMEZONE            # IANA tz, e.g. America/New_York  (replaces Asia/Dhaka)
GSC_PROPERTY        # sc-domain:{DOMAIN}
LOCATION            # SERP/geo target, e.g. "United States"
```

> **Hermes note:** if any field is unknown, interview the operator before proceeding.
> Do not invent business facts (services offered, pricing, locations) — ask.

---

## 1. Namespace rename map (DETERMINISTIC — do exactly this)

The legacy slug is **inconsistent** across the repo. Map *all* of these legacy stems to the
new generic scheme. Do not assume a single find/replace catches them — there are three stems.

| Legacy (any of these) | New generic target |
|---|---|
| `plumbingseo` (skill folder, prose, prefixes) | `client` |
| `/opt/plumbingseoagent` | `/opt/client-agent` |
| `/opt/plumbingseosite` | `/opt/client-site` |
| `/opt/plumbingsiteobsidian` | `/opt/client-obsidian` |
| `/opt/plumbingsitesqlite` | `/opt/client-sqlite` |
| env prefix `PLUMBINGSEO_*` | `CLIENT_*` |
| skill subfolders `plumbingseo-*` | `client-*` |

**Keep as-is (niche-agnostic, do NOT rename):**
- `SEO_AGENT_*` env vars (generic "SEO agent" namespace)
- `hermes-gateway.service` and other `hermes-*` unit names
- The `hermes/` directory and the Hermes agent itself

### Env vars to rename (17), in `.env`, `.env.example`, and code:
```
PLUMBINGSEO_AGENT_ROOT      → CLIENT_AGENT_ROOT
PLUMBINGSEO_SITE_ROOT       → CLIENT_SITE_ROOT
PLUMBINGSEO_OBSIDIAN_ROOT   → CLIENT_OBSIDIAN_ROOT
PLUMBINGSEO_BRAIN_VAULT     → CLIENT_BRAIN_VAULT
PLUMBINGSEO_DB_PATH         → CLIENT_DB_PATH
PLUMBINGSEO_BASE_URL        → CLIENT_BASE_URL
PLUMBINGSEO_BACKUP_REPOS    → CLIENT_BACKUP_REPOS
PLUMBINGSEO_GUARDRAILS_PATH → CLIENT_GUARDRAILS_PATH
PLUMBINGSEO_BLOG_PUBLISHER_*   (8 vars) → CLIENT_BLOG_PUBLISHER_*
PLUMBINGSEO_TASK_EXECUTOR_*    (2 vars) → CLIENT_TASK_EXECUTOR_*
```

### Skill folder rename:
- `Agentic SEO/hermes/skills/plumbingseo/`  → `Agentic SEO/hermes/skills/client/`
- inside it: `plumbingseo-blog-publisher/`, `plumbingseo-operations/`,
  `plumbingseo-pr-closeout-and-reconciliation/`  → drop the `plumbingseo-` prefix (`client-*`)

---

## 2. Customization tiers (what to change, by file)

### TIER 0 — Replace wholesale (per-client artifacts, not edited in place)

| Path | Action |
|---|---|
| `Website/` | **Replace entirely** with the new client's static site (e.g. WordPress → Simply Static export). Preserve the *blog-post template structure* (head/schema/header/footer) that `scaffold-blog.ps1` clones, or update the script to match the new site's markup. |
| `Obsidian Agent Brain/` | **Reset to seed.** Keep the folder taxonomy (`00-Dashboard`, `01-Agent-Brain`, `02-Tasks`, …); delete plumbing content. Re-seed from `Agentic SEO/processes/brain-seed/`. |
| SQLite DB (`/opt/*-sqlite/seo-agent.db`) | Fresh DB for the new client; never carry over plumbing tasks/rankings. |

### TIER 1 — Core config (EDIT these — intended knobs)

| File | What to set |
|---|---|
| `Agentic SEO/config/site.json` | The master config. Set every field from the profile (§0). |
| `Agentic SEO/.env.example` → copy to `.env` | All secrets + the renamed `CLIENT_*` path vars, `CLOUDFLARE_PROJECT_NAME`, `GSC_*`, SMTP/IMAP, `EMAIL_FROM_NAME`, `SEO_AGENT_TIMEZONE`. |
| `Agentic SEO/hermes/config/config.yaml` | Update `/opt/*` paths, `delegation.default_context` prose, model provider. Replace "PlumbingSEO" in comments/context. |
| `Agentic SEO/config/guardrails.json` | Mostly niche-agnostic. Review approval channel/emails and the require-explicit-approval list for this client's risk appetite. |
| `Agentic SEO/config/no_go_keywords.json` | Remove plumbing-specific blocked terms (e.g. `switch.monster`); add the new client's. |

### TIER 2 — SEO strategy data (AI REWRITE from the new niche — do not keep plumbing data)

These define *what to rank for*. Hermes must regenerate from the new niche, not translate.

| File | Guidance |
|---|---|
| `Agentic SEO/config/money_keyword_map.json` | Rebuild intents → service-page mapping for the new niche. `informational_negative_patterns` are reusable; everything niche-specific is not. |
| `Agentic SEO/config/money-keywords-seed.tsv` | New money-keyword seed list. |
| `Agentic SEO/config/rank_tracking_keywords.txt` | New tracking keyword set. |
| `Agentic SEO/tools/link-registry.json` | New internal-linking targets (the new site's real URLs). |

### TIER 3 — Agent content & identity (AI REWRITE — business prose)

These tell Hermes *who the business is* and *how to write*. Use the profile's
`BRAND_VOICE`, `NICHE`, `AUDIENCE`. Rewrite examples; don't leave plumbing analogies.

| File / area | Guidance |
|---|---|
| `Website/llms.txt` | Fully rewrite: brand summary, target audience, every service/blog URL, brand-voice block. This is the AI-facing site identity. |
| `Agentic SEO/tools/blog-production-skill.md` | Rewrite niche framing + examples; keep the production *workflow*. |
| `Agentic SEO/tools/stats-blog-production-skill.md` | Same — stats/data-post workflow with new-niche examples. |
| `Agentic SEO/tools/SERVICE-PAGE-PRODUCTION-SKILL.md` | Same — service-page playbook retargeted. |
| `Agentic SEO/hermes/skills/client/**` (18 skills) | Audit each for plumbing prose/examples; rewrite. Workflows are reusable; niche framing is not. |
| `Agentic SEO/processes/**` (24 playbooks) | Audit for plumbing examples; rewrite framing. Logic is reusable. |
| `Agentic SEO/hermes/memories/USER.md`, `MEMORY.md` | Reset to the new client's facts. |

### TIER 4 — Code with hardcoded fallbacks (REFACTOR — kill drift)

The `cli/` layer has ~143 hardcoded business strings, mostly fallback defaults like
`process.env.PLUMBINGSEO_SITE_ROOT || '/opt/plumbingseosite'` and default
`https://plumbingseo.agency` base URLs, plus example data in `--help` text.

**Preferred fix:** make code read `config/site.json` / `CLIENT_*` env with **no** plumbing
fallback (fail loud if unset), so identity can never silently drift. At minimum, replace every
literal with the new client's value.

| Area | Notes |
|---|---|
| `Agentic SEO/cli/lib/env.js` | Rename `PLUMBINGSEO_AGENT_ROOT` resolution → `CLIENT_AGENT_ROOT`. |
| `Agentic SEO/cli/commands/*.js` (~60 files) | Replace hardcoded `/opt/plumbing*` and `plumbingseo.agency` fallbacks + help-text examples. |
| `Agentic SEO/tools/scaffold-blog.ps1` | Update path/brand assumptions; re-point `SourcePost` template to new site. |
| `Agentic SEO/tools/replace_footer.{js,py}`, `replace_footer2.js` | Footer markup is site-specific — update to new site's footer. |

### TIER 5 — Infrastructure & deploy wiring

| Item | Action |
|---|---|
| `Agentic SEO/cron/*.sh`, `cron/run-daily-workplan.ps1` | Update `/opt/*` paths to `/opt/client-*`. |
| Linux server dirs | Create `/opt/client-agent`, `/opt/client-site`, `/opt/client-obsidian`, `/opt/client-sqlite`. |
| `Agentic SEO/connection/` | Replace SSH keys (`id_rsa`, `key.ppk`) + host details for the new server/repo. **Never reuse another client's keys.** |
| Cloudflare Pages | New project: Framework preset **None**, build output dir = `Website` (or `website/`), **build watch paths** include site dir / exclude brain. Set `CLOUDFLARE_PROJECT_NAME` to match. |
| GitHub repo | New **private** repo; configure Hermes' deploy key / SSH; confirm push + PR access. |

---

## 3. Execution order (the setup procedure)

1. **Profile** — fill §0 into `config/site.json`; interview operator for unknowns.
2. **Namespace rename** — apply §1 map across the whole repo (paths, env prefix, skill folders). Verify with `grep -ri plumb`.
3. **Tier 1 config** — set `site.json`, `.env`, `config.yaml`, guardrails, no-go.
4. **Tier 0 swap** — drop in the new `Website/`; reset brain to seed; fresh DB.
5. **Tier 4 code** — refactor/replace hardcoded fallbacks; rename env reads.
6. **Tier 2 strategy** — rebuild keyword maps / link registry from the new niche.
7. **Tier 3 prose** — rewrite llms.txt, skills, processes, memories.
8. **Tier 5 infra** — server dirs, SSH keys, Cloudflare project, GitHub repo, cron paths.
9. **Verify** (§4) → first dry-run of the daily workplan.

---

## 4. Acceptance checks (must all pass before go-live)

- [ ] `grep -ri "plumb" .` (excluding `.git/`) → **0 hits**
- [ ] `grep -rio "PLUMBINGSEO_" .` → **0 hits**
- [ ] No `/opt/plumbing*` path anywhere; all `/opt/client-*` exist on server.
- [ ] `config/site.json` reflects the new client; `.env` has all `CLIENT_*` vars + secrets.
- [ ] `Website/llms.txt` has zero plumbing URLs/prose.
- [ ] CLI commands run without plumbing fallbacks (test with env unset → fail loud, not plumbing default).
- [ ] Cloudflare Pages deploys on a `Website/` change; a brain-only commit does **not** trigger deploy.
- [ ] Hermes can clone, commit, push, and open a PR with the new SSH key.
- [ ] Daily workplan dry-run produces new-niche tasks (no plumbing topics).

---

## 5. Reusable vs. per-client (quick reference)

**Reusable engine (do NOT rewrite — only repath/rename):** `cli/` command logic,
`hermes/` agent runtime, process *workflows*, guardrail *model*, cron *structure*,
`scaffold-blog.ps1` *logic*, the brain folder *taxonomy*.

**Per-client (rewrite/replace every setup):** `Website/`, `Obsidian Agent Brain/` content,
`llms.txt`, all keyword/strategy config, all niche prose in skills/processes, SSH keys,
DB, and every value in the §0 profile.
