# SETUP.md — Stand up a new client from this template

> A numbered runbook for a **human or an AI agent** to turn this template into a live,
> running autopilot for one client/site. Each step says **who** does it, **what** to run,
> and **how to verify** it.
>
> This repo is already a neutral template: business identity is stored as `{{TOKENS}}`,
> the namespace slug is `client`, the website is a placeholder, the brain is reset to seed,
> and secrets are placeholders. You are *filling it in*, not stripping it down.
>
> Companion docs: **[README.md](README.md)** (overview) · **[TEMPLATE.md](TEMPLATE.md)**
> (what each area contains) · **[setup/README.md](setup/README.md)** (script details) ·
> **[ENV-SETUP.md](ENV-SETUP.md)** (every credential explained, where to get it).

---

## Prerequisites

| Need | Why |
|---|---|
| Node.js ≥ 22.5 | runs the `cli/` engine (`v2` commands) |
| PowerShell 5.1+ / `pwsh` | runs `customize.ps1` and `scaffold-blog.ps1` |
| A Linux server | hosts the **Hermes** agent + cron schedule |
| GitHub account | private repo; Hermes pushes/PRs via SSH |
| Cloudflare account | Pages hosting + auto-deploy |
| API keys | GitHub token, Cloudflare token, GSC OAuth, Serper (SERP), SMTP/IMAP |
| The client's static site | e.g. WordPress exported via **Simply Static** |

---

## Step 0 — Copy the template for this client  *(human)* ⚠️

`customize.ps1` fills tokens **in place**. So **never run setup on your master template** —
make a per-client copy first and work in that copy:

```powershell
Copy-Item -Recurse "D:\Projects\Website Autopilot System" "D:\Projects\clients\acme-roofing"
Set-Location "D:\Projects\clients\acme-roofing"
```

Everything below runs inside that copy. Your master stays pristine for the next client.

> **Standing up many clients?** Step 0 + the rest of this runbook is the manual,
> single-client path. There's also an **optional orchestrator** that does the copy,
> token-fill, repo + Cloudflare creation, and a registry entry in one command — see
> **[provision/README.md](provision/README.md)**. It wraps the very same scripts this
> runbook uses, so you can switch to it any time without relearning the pieces.

---

## Step 1 — Fill the profile  *(human)*

Open **[site.config.json](site.config.json)** and set every value: `slug` (leave `client`
unless you want a different stem), `domain`, `site_name`, `site_description`, `owner_name`,
`business.*` (type, niche, audience, brand_voice), `paths.*`, `git.*`, `email.*`, `apis.*`,
`cloudflare.*`, `timezone`, `timezone_abbr`.

**Verify:** the file parses as JSON and contains no `example.com` / `roofing` leftovers.

---

## Step 2 — Preview the fill  *(human or AI)*

```powershell
pwsh ./setup/customize.ps1
```

Writes nothing. Shows the token→value mapping, the file/replacement counts, and — crucially —
**any placeholder you forgot to give a value** (the "Unfilled placeholders" list).

**Verify:** the mapping at the top is correct and the unfilled list is empty.

---

## Step 3 — Apply the fill  *(human or AI)*

```powershell
pwsh ./setup/customize.ps1 -Apply
```

Replaces every `{{TOKEN}}` with the client's values across the engine, website, and brain
(and renames the namespace if you changed the slug).

**Verify:**
```powershell
# No placeholders should remain:
Select-String -Path . -Pattern "\{\{" -Recurse `
  | Where-Object { $_.Path -notmatch "node_modules|\.git|TEMPLATE\.md|SETUP\.md|README\.md|site\.config\.json|customize\.ps1|make-template\.ps1" }
# → expect zero matches
```

---

## Step 4 — AI prose polish  *(Hermes / AI — optional but recommended)*

Token replacement is literal (e.g. `{{NICHE}}` → "roofing"), so some sentences read a bit
mechanically. Hand the engine to Hermes:

> "Read `site.config.json` (business.niche, audience, brand_voice). Polish the prose in
> `Agentic SEO/hermes/skills/client/**`, `Agentic SEO/processes/**`, and
> `Agentic SEO/tools/*-skill.md` so it reads naturally for this niche. Rebuild the keyword
> strategy in `config/money_keyword_map.json`, `config/money-keywords-seed.tsv`,
> `config/rank_tracking_keywords.txt`, and `tools/link-registry.json` from real keyword
> research. Do not invent business facts — ask the operator."

**Verify:** skim a couple of skill files; keyword config reflects the real niche.

---

## Step 5 — Import the client website  *(human)*

1. Replace the placeholder contents of `Website/` with the client's static export
   (Simply Static output or custom HTML/CSS/JS). Keep/refresh `robots.txt`, `sitemap.xml`,
   `llms.txt`, `_headers`, `_redirects`.
2. Point the blog scaffolder at a real post: open
   [Agentic SEO/tools/scaffold-blog.ps1](Agentic%20SEO/tools/scaffold-blog.ps1) and confirm
   `SourcePost`/markup assumptions match the imported site's blog structure.

**Verify:** open `Website/index.html`; the real site renders; no `{{TOKENS}}` remain.

---

## Step 6 — Seed the brain  *(human or AI)*

The brain already holds only the seed taxonomy + canonical notes. Add this client's facts
(services, locations, pricing, preferences) into `Obsidian Agent Brain/01-Agent-Brain/`.
Start a **fresh SQLite DB** at `paths.db_path` on the server (created by the CLI; the
template ships no DB).

**Verify:** brain has client facts; `Credentials.md` holds no secrets in the repo.

---

## Step 7 — Secrets & SSH  *(human)*

1. `cp "Agentic SEO/.env.example" "Agentic SEO/.env"` and fill all keys (GitHub, Cloudflare,
   GSC OAuth, Serper, SMTP/IMAP).
2. **Generate fresh SSH keys** — the template ships `Agentic SEO/connection/id_rsa` and
   `key.ppk` as **placeholders**. Create a new keypair for this client and add the public
   key to GitHub.

**Verify:** `.env` is git-ignored; `connection/id_rsa` is a real key you just generated;
a basic `node "Agentic SEO/cli/bin/v2.js"` command runs without "Missing X" errors.

---

## Step 8 — GitHub repo  *(human)*

Create a **private** repo, add Hermes' public SSH key as a write-enabled deploy key (or a
PAT), and push the filled template.

**Verify:** Hermes can `git push` / open a PR from the server (tested in Step 10).

---

## Step 9 — Cloudflare Pages  *(human)*

1. New Pages project → connect the private repo.
2. Framework preset **None**; build command **(empty)**; build output dir **`Website`**.
3. **Build watch paths:** include the website path; **exclude** `Obsidian Agent Brain/*`
   and `Agentic SEO/*`.
4. Set `cloudflare.project_name` / `CLOUDFLARE_PROJECT_NAME` to match.

**Verify:** a `Website/` commit deploys; a brain-only commit does **not**.

---

## Step 10 — Server & Hermes  *(human or AI)*

1. Create `/opt/<slug>-agent`, `/opt/<slug>-site`, `/opt/<slug>-obsidian`,
   `/opt/<slug>-sqlite`; clone the repos in.
2. Deploy Hermes: [hermes/deploy-hermes.sh](Agentic%20SEO/hermes/deploy-hermes.sh) +
   [hermes/config/config.yaml](Agentic%20SEO/hermes/config/config.yaml).
3. Install the schedule: [cron/install-crons.sh](Agentic%20SEO/cron/install-crons.sh).

**Verify:** [hermes/smoke-test.sh](Agentic%20SEO/hermes/smoke-test.sh) passes; Hermes can
clone/commit/push/PR with the new key.

---

## Step 11 — Final acceptance  *(run all)*

- [ ] `grep -r "{{" .` (excl. `.git`, `node_modules`, meta-docs) → 0 hits
- [ ] No `example.com` / template default values remain
- [ ] `cd "Agentic SEO" && npm test` → passes (update test fixtures for the niche if needed)
- [ ] Cloudflare deploys on `Website/` change; brain commit does not
- [ ] Fresh SSH keys generated; `.env` filled; fresh DB created
- [ ] Hermes daily-workplan **dry-run** produces sensible niche tasks

When all boxes are checked, switch Hermes to live and the autopilot is running.

---

## Notes

- **`setup/make-template.ps1`** is the one-time script that created this template from the
  original plumbing build. You don't normally run it again — it's kept for reference and in
  case you need to re-genericize from a fresh copy of the original.
- For client #2, copy the **master** template folder again (Step 0) and start fresh with a
  new `site.config.json`. Or use the optional orchestrator
  ([provision/README.md](provision/README.md)) to automate Steps 0–3 + repo/Cloudflare setup
  for each new client.
