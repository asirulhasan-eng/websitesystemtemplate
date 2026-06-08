# Website Autopilot System — Template

A reusable template for an **agentic SEO + content autopilot**: an AI agent (**Hermes**)
that runs a website end-to-end — technical SEO, content/blogging, strategy — with an
Obsidian "brain" of persistent memory, all from **one private GitHub repo**, auto-deployed
to **Cloudflare Pages**.

This repo is **already neutral**: all business identity is stored as `{{TOKENS}}` and the
namespace slug is `client`. To stand up a new site you fill in one profile and run one
script. (It was originally built for a plumbing SEO agency and has been fully genericized —
there is no plumbing-specific content left in the engine, website, or brain.)

> **New here? Start with [SETUP.md](SETUP.md)** — the step-by-step runbook.

---

## What's in the box

```
Website Autopilot System/
├─ Agentic SEO/            ← the ENGINE (reusable; tokenized, not rewritten)
│  ├─ cli/                 v2 CLI: GSC, SERP, tasks, deploy, brain, reports (~60 commands)
│  ├─ hermes/              Hermes agent runtime, skills (skills/client/), memories, config
│  ├─ processes/           strategy playbooks + brain-seed/
│  ├─ config/              site.json, guardrails, keyword maps (tokenized)
│  ├─ cron/                schedule that drives the autopilot
│  ├─ tools/               blog scaffolder, footer tools, SERP scripts
│  └─ connection/          SSH keys — shipped as PLACEHOLDERS, generate fresh per client
│
├─ Website/                ← the SITE — a clean placeholder skeleton
│  └─ index.html, blog/, llms.txt, robots.txt, sitemap.xml, _headers, _redirects (all {{TOKENS}})
│
├─ Obsidian Agent Brain/   ← the BRAIN — reset to seed (taxonomy + canonical seed notes only)
│
├─ site.config.json        ← THE per-client profile you fill in
├─ setup/                  ← the fill PRIMITIVES (customize / analyze / inject / scaffold)
│  ├─ customize.ps1        fills the {{TOKENS}} from the profile (dry-run by default)
│  └─ make-template.ps1    the one-time script that birthed this template (kept for reference)
├─ provision/              ← OPTIONAL orchestrator: stand up many clients in one command
│  └─ provision-site.ps1   wraps the setup/ primitives + repo/Cloudflare/registry (see its README)
├─ validation/             ← post-setup acceptance checks (tokens, links, SEO, brain, config)
├─ SETUP.md                ← step-by-step runbook  ⭐ start here
├─ TEMPLATE.md             ← reference: what each area contains, reusable vs per-client
└─ README.md               ← you are here
```

---

## How deployment works (the "one repo" trick)

One private repo holds **all three** parts. Cloudflare Pages points at `Website/` with
**build watch paths** so:

- a commit touching **`Website/`** → triggers a deploy ✅
- a commit touching only the **brain** or **engine** → **no deploy** ✅

That lets the agent's memory and code share the repo with the site without spamming deploys
or leaking private notes (the repo is **private**; Cloudflare deploys from it fine).

---

## Customizing for a client

Two layers:

1. **Deterministic** — `setup/customize.ps1` fills every `{{TOKEN}}` ({{DOMAIN}},
   {{SITE_NAME}}, {{NICHE}}, {{AUDIENCE}}, ...) and, if you change the slug, renames the
   namespace. It reports any token you forgot to give a value.
2. **Judgment** — the niche tokens give Hermes clean anchors to polish prose, plus you
   import the client's actual website and seed the brain with client facts. Guided by
   **[TEMPLATE.md](TEMPLATE.md)**.

Acceptance rule: after setup, `grep -r "{{" .` (outside `.git/`, `node_modules/`, and the
meta-docs) returns **zero** hits — every placeholder is filled.

---

## Quick start

```powershell
# 1. Fill the profile
notepad site.config.json

# 2. Preview the fill (writes nothing)
pwsh ./setup/customize.ps1

# 3. Apply it
pwsh ./setup/customize.ps1 -Apply

# 4..N — import the client website, generate fresh SSH keys + .env,
#         connect GitHub + Cloudflare, deploy Hermes.  See SETUP.md
```

Full instructions: **[SETUP.md](SETUP.md)**.

> ⚠️ `customize.ps1` fills **in place** — always work on a per-client **copy** of this
> folder, never your master template. SETUP.md Step 0 covers this.

---

## Standing up many clients (optional)

The Quick start above is the **manual, single-client** path: copy the folder, fill the
profile, run `customize.ps1`. It's the canonical flow and the one SETUP.md documents.

When you're onboarding clients regularly, there's an **optional orchestrator** —
`provision/provision-site.ps1` — that does the copy → token-fill → website analysis →
skill injection → GitHub repo → Cloudflare project → registry entry in **one command**,
isolating each client under `sites/{slug}/` so your master is never touched. It calls the
exact same `setup/` scripts under the hood, so it's a convenience layer, not a second system.
See **[provision/README.md](provision/README.md)**.
