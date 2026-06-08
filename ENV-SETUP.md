# ENV-SETUP.md — Variable & Credential Setup Guide

Everything you need to fill in `Agentic SEO/.env` and `connection/server.cfg`
before the system can run. Work through each section in order.

> **Companion docs:** [SETUP.md](SETUP.md) (full runbook) · [SETUP-CHECKLIST.md](SETUP-CHECKLIST.md) (tick-box summary)

---

## How to Start

```powershell
# 1. Create your .env from the template
copy "Agentic SEO\.env.example" "Agentic SEO\.env"

# 2. Create your server config from the template
copy connection\server.cfg.example connection\server.cfg
```

Then open both files and work through the sections below.

---

## Section 1 — Site Identity

**File:** `site.config.json` (root of repo)  
**How it works:** These are not secrets — they're filled once by running `customize.ps1`,
which stamps every `{{TOKEN}}` placeholder across the whole system.

| Field | What to put |
|---|---|
| `slug` | Short namespace stem. Leave as `client` unless you want a different folder prefix. |
| `domain` | Bare domain, no `https://`. e.g. `acmeplumbing.com` |
| `site_name` | Display name. e.g. `Acme Plumbing SEO` |
| `site_description` | One sentence describing the business. |
| `owner_name` | Business owner's full name. |
| `business.niche` | Industry noun. e.g. `plumbing` |
| `business.audience` | Who you serve. e.g. `plumbers` |
| `business.brand_voice` | 1–2 sentences on tone. e.g. `Expert, direct, ROI-focused.` |
| `email.admin` | Owner's email address. Alerts and approvals go here. |
| `timezone` | IANA timezone. e.g. `America/New_York` |
| `timezone_abbr` | Short label. e.g. `ET` |
| `cloudflare.project_name` | Your Cloudflare Pages project slug. e.g. `acme-plumbing` |

**After filling:** run `pwsh ./setup/customize.ps1` (preview) then `-Apply` to stamp everything.

---

## Section 2 — Server SSH Access

**File:** `connection/server.cfg` (and `Agentic SEO/connection/server.cfg`)

| Variable | What to put |
|---|---|
| `SERVER_HOST` | Your VPS IP address or hostname. e.g. `123.45.67.89` |
| `SERVER_USER` | SSH login user. Usually `root`. |

**Used by:** `connect-ssh.bat`, `connect-putty.bat`  
**Not used by:** the agent — the agent clones/pushes over Git, not SSH directly.

> **SSH keys:** The `id_rsa` / `key.ppk` files in `connection/` are placeholders.
> Generate a fresh keypair for each client:
> ```bash
> ssh-keygen -t rsa -b 4096 -f connection/id_rsa -N ""
> ```
> Then add the public key (`id_rsa.pub`) to GitHub as a Deploy Key and to your server's
> `~/.ssh/authorized_keys`.

---

## Section 3 — GitHub

**File:** `Agentic SEO/.env`

| Variable | What to put | Where to get it |
|---|---|---|
| `GITHUB_TOKEN` | Personal Access Token | [github.com/settings/tokens](https://github.com/settings/tokens) → **Tokens (classic)** → Scopes: `repo` (full) |
| `GITHUB_PR_BASE` | Branch PRs target | Leave as `main` unless you use a different default branch |

**Token format:** starts with `github_pat_` (fine-grained) or `ghp_` (classic).

---

## Section 4 — Cloudflare Pages

**File:** `Agentic SEO/.env`

| Variable | What to put | Where to get it |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 32-char hex ID | Cloudflare Dashboard → right sidebar under **Account ID** |
| `CLOUDFLARE_API_TOKEN` | API token | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → Template: *Edit Cloudflare Workers* or custom with Pages Write |
| `CLOUDFLARE_PROJECT_NAME` | Pages project slug | Must match what you created in Cloudflare Pages. e.g. `acme-plumbing` |
| `CLOUDFLARE_PRODUCTION_BRANCH` | Deploy branch | Leave as `main` |

**Token format:** starts with `cfut_`.

---

## Section 5 — Google Search Console (OAuth2)

**File:** `Agentic SEO/.env`

The agent reads your GSC data via OAuth. You need a Google Cloud project with the
Search Console API enabled, plus an OAuth consent screen.

### One-time setup steps:
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable **Google Search Console API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`
5. Copy the **Client ID** and **Client Secret**
6. Go to [OAuth Playground](https://developers.google.com/oauthplayground) (⚙️ → use your own credentials)
   - Authorize: `https://www.googleapis.com/auth/webmasters.readonly`
   - Exchange auth code for tokens → copy the **Refresh Token**

| Variable | What to put |
|---|---|
| `GSC_SITE_URL` | `sc-domain:yourdomain.com` (for domain properties) or `https://yourdomain.com/` (for URL prefix) |
| `GSC_CLIENT_ID` | Ends in `.apps.googleusercontent.com` |
| `GSC_CLIENT_SECRET` | Starts with `GOCSPX-` |
| `GSC_REFRESH_TOKEN` | Starts with `1//` |

> `GSC_ACCESS_TOKEN` is optional — the agent auto-refreshes from the refresh token.

---

## Section 6 — SERP & SEO Data APIs

**File:** `Agentic SEO/.env`

### Serper (primary SERP tool)

| Variable | What to put | Where to get it |
|---|---|---|
| `SERPER_API_KEY` | API key (hex string) | [serper.dev/dashboard](https://serper.dev/dashboard) → API Key tab |

**Also used by:** `tools/serper-search.ps1`, `tools/serper-scrape.ps1`, `tools/serper-batch.ps1`

### DataForSEO (optional — deeper keyword/rank data)

| Variable | What to put | Where to get it |
|---|---|---|
| `DATAFORSEO_LOGIN` | Account email | [app.dataforseo.com](https://app.dataforseo.com) → API credentials |
| `DATAFORSEO_PASSWORD` | Account password | Same page |

### RapidAPI (YouTube transcripts)

| Variable | What to put | Where to get it |
|---|---|---|
| `RAPIDAPI_KEY` | API key | [rapidapi.com/developer/dashboard](https://rapidapi.com/developer/dashboard) → **default-application** → Authorization |

**Used by:** `tools/youtube-transcript.ps1`

---

## Section 7 — Email: SMTP (Outbound)

**File:** `Agentic SEO/.env`

The agent sends plan emails, approval requests, and alerts via SMTP.
Gmail with an App Password is the easiest setup.

### Gmail setup:
1. Enable 2-Step Verification on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Create an App Password for "Mail"
4. Copy the 16-character code (spaces are stripped automatically by the agent)

| Variable | What to put |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` (or your mail server) |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (TLS) |
| `SMTP_USE_TLS` | `true` for port 587 · `ssl` for port 465 |
| `SMTP_USER` | Your full Gmail address |
| `SMTP_PASS` | 16-char Gmail App Password (no spaces) |
| `EMAIL_FROM` | From address — leave blank to use `SMTP_USER` |
| `EMAIL_FROM_NAME` | Display name, e.g. `Acme Plumbing Agent` |
| `EMAIL_TO` | Default recipient for general notifications |

---

## Section 8 — Email: IMAP + Approval Routing

**File:** `Agentic SEO/.env`

The agent reads your inbox to detect approval replies and alert acknowledgements.

| Variable | What to put |
|---|---|
| `IMAP_HOST` | `imap.gmail.com` (or your mail server) |
| `IMAP_PORT` | `993` |
| `IMAP_USER` | Leave blank to default to `SMTP_USER` |
| `IMAP_PASS` | Leave blank to default to `SMTP_PASS` |
| `APPROVAL_EMAIL_TO` | Address the agent sends opt-out approval emails **to** (usually the owner) |
| `ALERT_EMAIL_TO` | Address for system health alerts |
| `APPROVAL_ALLOWED_SENDERS` | Comma-separated email addresses trusted to reply with approvals. e.g. `owner@acme.com,manager@acme.com` |
| `APPROVAL_THREAD_IDS` | Optional. Pre-seeded email thread IDs — leave blank initially |

---

## Section 9 — Agent Runtime

**File:** `Agentic SEO/.env`

| Variable | What to put |
|---|---|
| `SEO_AGENT_GIT_NAME` | Name used for git commits. e.g. `Acme Plumbing Agent` |
| `SEO_AGENT_GIT_EMAIL` | Email used for git commits. e.g. `agent@acmeplumbing.com` |
| `SEO_AGENT_TIMEZONE` | IANA timezone, same as `site.config.json`. e.g. `America/New_York` |

These are pre-filled by `customize.ps1` from `site.config.json` — double-check they look right.

---

## Section 10 — Server Paths

**File:** `Agentic SEO/.env`

These control where repos and data live on the Linux server. The defaults match the
`/opt/client-*` layout set up by `hermes/deploy-hermes.sh`.

| Variable | Default | Change if… |
|---|---|---|
| `CLIENT_SITE_ROOT` | `/opt/client-site` | You used a different slug or path |
| `CLIENT_OBSIDIAN_ROOT` | `/opt/client-obsidian` | Same |
| `CLIENT_BACKUP_REPOS` | `/opt/client-sqlite,/opt/client-obsidian,/opt/client-agent` | Add/remove repos from backup |

---

## Section 11 — Hermes Agent (on the server)

**File:** `~/.hermes/.env` on the Linux server (separate from the agent `.env`)

These live on the server, not in this repo. Edit them after running `deploy-hermes.sh`:

| Variable | What to put | Where to get it |
|---|---|---|
| LLM API key (e.g. `OPENROUTER_API_KEY`) | Your model provider key | [openrouter.ai/keys](https://openrouter.ai/keys) or your provider's dashboard |
| `TELEGRAM_BOT_TOKEN` | Bot token for Hermes Gateway (optional) | [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` |
| `TELEGRAM_CHAT_ID` | Owner chat id for bot→owner notifications (e.g. the Self-Evaluation Auditor's 6-hour report). Optional. | Message your bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `result[].message.chat.id` |

**Also configure:** `~/.hermes/config.yaml`
- `model.provider` — e.g. `openrouter`
- `model.default_model` — e.g. `anthropic/claude-sonnet-4-5`

---

## Section 12 — Analytics & Social (Optional)

**File:** `Agentic SEO/.env`

Only needed if `setup/inject-skills.ps1` doesn't auto-detect them from `website-profile.json`.

| Variable | What to put |
|---|---|
| `GA4_MEASUREMENT_ID` | Google Analytics 4 ID. e.g. `G-XXXXXXXXXX` |
| `CLARITY_ID` | Microsoft Clarity project ID |
| `TWITTER_HANDLE` | e.g. `@acmeplumbing` |
| `FACEBOOK_PAGE` | Page slug only. e.g. `acmeplumbing` |
| `YOUTUBE_HANDLE` | Channel handle. e.g. `AcmePlumbing` |

---

## Quick Reference — Files vs. Variables

| File | Contains |
|---|---|
| `site.config.json` | Site identity tokens (filled once by `customize.ps1`) |
| `Agentic SEO/.env` | All runtime secrets and credentials (never committed) |
| `connection/server.cfg` | Server IP and SSH user (never committed) |
| `~/.hermes/.env` *(server)* | LLM API key + Telegram token (on server only) |
| `~/.hermes/config.yaml` *(server)* | Hermes model and tool settings |

---

## Verification

After filling everything in, run these checks:

```powershell
# 1. No unfilled tokens remain
Select-String -Path . -Pattern "\{\{" -Recurse |
  Where-Object { $_.Path -notmatch "node_modules|\.git|TEMPLATE|SETUP|ENV-SETUP|site\.config|customize|make-template" }
# → expect 0 results

# 2. Agent can load its env without errors
cd "Agentic SEO"
node cli/bin/v2.js config
# → shows your domain, site name, and API key status (✓ / ✗)

# 3. Server connection works
connection\connect-ssh.bat
# → drops you into an SSH session
```
