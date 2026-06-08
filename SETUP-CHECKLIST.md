# SETUP-CHECKLIST.md — everything to set up for one client

Tick these top-to-bottom. Detail for each is in [SETUP.md](SETUP.md).

## A. Gather / provision (before touching the repo)
- [ ] **Linux server** (hosts Hermes + cron)
- [ ] **GitHub account** + ability to create a **private** repo
- [ ] **Cloudflare account** (Pages)
- [ ] **The client's static site** (WordPress → Simply Static export, or custom HTML/CSS/JS)
- [ ] Node.js ≥ 22.5 and PowerShell available locally

## B. API keys & credentials to obtain
- [ ] `GITHUB_TOKEN` (or deploy key) — repo push/PR
- [ ] `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`
- [ ] Google Search Console OAuth: `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`
- [ ] `SERPER_API_KEY` (SERP data) — and/or `DATAFORSEO_LOGIN`/`PASSWORD`
- [ ] SMTP creds: `SMTP_USER`, `SMTP_PASS` (sending mail)
- [ ] IMAP creds: `IMAP_USER`, `IMAP_PASS` (approval/alert inbox)
- [ ] Model provider key for Hermes (e.g. OpenRouter) — see `hermes/config/config.yaml`

## C. Fill the profile — `site.config.json`
- [ ] `slug` (leave `client` unless you want a different stem)
- [ ] `domain`, `site_name`, `site_description`, `owner_name`
- [ ] `business.type`, `business.niche`, `business.audience`, `business.brand_voice`
- [ ] `paths.*` (agent/site/obsidian/db) — match the `/opt/<slug>-*` dirs you'll create
- [ ] `git.*` (branch, remote, user name/email)
- [ ] `email.admin`, `email.from`, `email.from_name`
- [ ] `apis.gsc_property`, `apis.serp_provider`, `apis.location`
- [ ] `cloudflare.project_name`, `cloudflare.production_branch`
- [ ] `timezone`, `timezone_abbr`

## D. Run the fill
- [ ] `pwsh ./setup/customize.ps1` (preview — check token map + no "Unfilled placeholders")
- [ ] `pwsh ./setup/customize.ps1 -Apply`
- [ ] Verify: `grep -r "{{" .` (excl. `.git`/`node_modules`/meta-docs) → **0 hits**

## E. Content
- [ ] Replace `Website/` placeholder with the client's static site
- [ ] Keep/refresh `robots.txt`, `sitemap.xml`, `llms.txt`, `_headers`, `_redirects`
- [ ] Point `tools/scaffold-blog.ps1` `SourcePost` at a real imported blog post
- [ ] Seed `Obsidian Agent Brain/01-Agent-Brain/` with client facts (services, locations, pricing, prefs)
- [ ] (Optional) Hermes prose polish + rebuild keyword strategy files (`config/money_keyword_map.json`, `money-keywords-seed.tsv`, `rank_tracking_keywords.txt`, `tools/link-registry.json`)

## F. Secrets & SSH (per client — never reuse)
- [ ] `cp "Agentic SEO/.env.example" "Agentic SEO/.env"` and fill **all** keys
- [ ] **Generate a fresh SSH keypair** → replace placeholder `connection/id_rsa` + `key.ppk`
- [ ] Add the public key to GitHub as a write-enabled deploy key
- [ ] Confirm `.env`, real keys, and DB are **git-ignored**

## G. GitHub
- [ ] Create the **private** repo
- [ ] Push the filled template
- [ ] Confirm Hermes can `git push` / open a PR

## H. Cloudflare Pages
- [ ] New Pages project → connect the private repo
- [ ] Framework preset **None**, build command **empty**, output dir **`Website`**
- [ ] **Build watch paths**: include `Website/*`; exclude `Obsidian Agent Brain/*` and `Agentic SEO/*`
- [ ] Verify: a `Website/` commit deploys; a brain-only commit does **not**

## I. Server & Hermes
- [ ] Create `/opt/<slug>-agent`, `/opt/<slug>-site`, `/opt/<slug>-obsidian`, `/opt/<slug>-sqlite`
- [ ] Clone the repos into them
- [ ] Create a **fresh SQLite DB** at `paths.db_path` (via the CLI; none ships in the template)
- [ ] Deploy Hermes: `hermes/deploy-hermes.sh` + configure `hermes/config/config.yaml`
- [ ] Install the schedule: `cron/install-crons.sh`
- [ ] Run `hermes/smoke-test.sh` → passes

## J. Final acceptance
- [ ] `grep -r "{{" .` → 0 hits; no `example.com`/`roofing` defaults left
- [ ] `cd "Agentic SEO" && npm test` passes (update niche test fixtures if needed)
- [ ] Cloudflare deploy/no-deploy behaviour confirmed
- [ ] Hermes daily-workplan **dry-run** produces sensible niche tasks
- [ ] Switch Hermes to live ✅
