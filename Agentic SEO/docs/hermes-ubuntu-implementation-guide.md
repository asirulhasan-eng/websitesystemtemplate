# 09. Hermes Ubuntu Implementation Guide

This guide is written from the current local codebase, not from the abstract system plan alone. The current implementation is a Node.js 22 tool suite in `client-agent`, with SQLite state, Obsidian/email outbox workers, Linux cron wrappers, Cloudflare/GitHub helpers, and safety lanes.

Hermes Agent should sit above this system as the natural-language operator. It should call the local Node tools. It should not edit SQLite directly, invent new task state, bypass approval tokens, or write production files without the existing lane logic.

---

## 1. What Exists Locally

The local repo is the agent runner:

```text
client-agent
  package.json
  hermes/
    deploy-hermes.sh
    smoke-test.sh
    seo-agent
    config/config.yaml
    memories/MEMORY.md
    memories/USER.md
    skills/client/*/SKILL.md
    systemd/hermes-gateway.service
  tools/
    run_daily_observer.js
    run_task_executor.js
    run_semi_safe_pipeline.js
    run_high_risk_pipeline.js
    init_state_db.js
    manage_locks.js
    manage_approvals.js
    sync_obsidian_outbox.js
    send_email_outbox.js
    backup_state.js
    install_linux_scheduler.js
    cron/*.sh
  documentation/
```

Important implementation facts:

- Runtime is Node.js, not Python. `package.json` requires Node `>=22.0.0` because the DB layer uses `node:sqlite`.
- The command surface is `node tools/*.js` plus npm aliases such as `npm run daily`, `npm run executor`, `npm run outbox`, and `npm run backup`.
- `tools/lib/state_db.js` creates the full 21-table SQLite schema from the v4 plan.
- `tools/run_daily_observer.js` now includes a `cron_run_lock`, disk pre-check, SQLite integrity check, stale lock cleanup, dirty website repo gate, mid-run heartbeat beats, GSC/SERP/crawl, Cloudflare check, email approval fetch, candidate generation, dead-man monitor, Obsidian sync, and daily summary generation.
- `tools/manage_locks.js` supports ordered `acquire-multi`, `waiting`, `stale`, `force_released`, and expired lock handling.
- `tools/generate_daily_summary.js` now covers the full 22-section daily report shape.
- The Linux scheduler installer renders the managed split-lane cron block: monitor, email, outbox, general executor, blog publisher, blog editor, blog review, Brain-aware daily observer, backup, consistency, opportunity, weekly, and monthly jobs.
- The default DB path inside most tools/wrappers is `tools/out/state/seo-agent.db`. If you want the separate `client-sqlite` repo to be the operational state repo, pass `--db /opt/client-sqlite/seo-agent.db` explicitly in production commands.
- The `hermes/` directory already contains a starter Hermes config, memory files, {{SITE_NAME}} skills, a `seo-agent` wrapper, deployment/smoke-test scripts, and a systemd service template. Treat those as install assets, not as authoritative production code until the script and wrapper caveats in this guide are handled.

---

## 2. Recommended Ubuntu Layout

Use sibling `/opt` directories because the current `.env.example` and shell wrappers already assume this style.

```text
/opt/client-agent       # this repo, the Node tool runner
/opt/client-site        # live website repo connected to Cloudflare Pages
/opt/client-sqlite     # SQLite state repo and backups
/opt/client-obsidian   # Obsidian mirror repo
```

Create a dedicated unprivileged user if this will run on a VPS:

```bash
sudo adduser --disabled-password --gecos "" hermes
sudo install -d -o hermes -g hermes /opt/client-agent
sudo install -d -o hermes -g hermes /opt/client-site
sudo install -d -o hermes -g hermes /opt/client-sqlite
sudo install -d -o hermes -g hermes /opt/client-obsidian
sudo loginctl enable-linger hermes
```

Install runtime dependencies:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential sqlite3 jq cron
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

The Node version must be 22 or newer.

---

## 3. Clone The Four Repos

Run as the `hermes` user:

```bash
sudo -iu hermes

git clone git@github.com:asirulhasan-eng/client-agent.git /opt/client-agent
git clone git@github.com:asirulhasan-eng/client-site.git /opt/client-site
git clone git@github.com:asirulhasan-eng/client-sqlite.git /opt/client-sqlite
git clone git@github.com:asirulhasan-eng/client-obsidian.git /opt/client-obsidian
```

Inside the agent repo:

```bash
cd /opt/client-agent
npm install --omit=dev
```

There are no required third-party npm dependencies in the current `package.json`, but this validates the package and leaves room for future dependencies.

---

## 4. Configure Secrets

Use a real `.env` file in `/opt/client-agent`. Do not use Obsidian, GitHub docs, task notes, or Hermes memory for secrets.

```bash
cd /opt/client-agent
cp .env.example .env
chmod 600 .env
```

Set these non-secret path values:

```bash
CLIENT_SITE_ROOT=/opt/client-site
CLIENT_OBSIDIAN_ROOT=/opt/client-obsidian
CLIENT_BACKUP_REPOS=/opt/client-sqlite,/opt/client-obsidian,/opt/client-agent
CLOUDFLARE_PROJECT_NAME=clientagency
CLOUDFLARE_PRODUCTION_BRANCH=main
GSC_SITE_URL=sc-domain:{{DOMAIN}}
SEO_AGENT_TIMEZONE={{TIMEZONE}}
```

Then fill the actual secret values:

```text
GITHUB_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
GSC_CLIENT_ID
GSC_CLIENT_SECRET
GSC_REFRESH_TOKEN
SERPER_API_KEY
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
EMAIL_FROM
EMAIL_TO
APPROVAL_EMAIL_TO
ALERT_EMAIL_TO
APPROVAL_ALLOWED_SENDERS
IMAP_HOST
IMAP_PORT
IMAP_USER
IMAP_PASS
```

Production commands should export:

```bash
export SEO_AGENT_ENV_FILE=/opt/client-agent/.env
export SEO_AGENT_DB=/opt/client-sqlite/seo-agent.db
export CLIENT_SITE_ROOT=/opt/client-site
export CLIENT_OBSIDIAN_ROOT=/opt/client-obsidian
export CLIENT_BACKUP_REPOS=/opt/client-sqlite,/opt/client-obsidian,/opt/client-agent
```

Note: `SEO_AGENT_DB` is not automatically consumed by every local tool. Use it in shell commands as `--db "$SEO_AGENT_DB"`.

---

## 5. Initialize And Smoke Test

Initialize SQLite in the state repo:

```bash
cd /opt/client-agent
node tools/init_state_db.js --db "$SEO_AGENT_DB"
```

Check config:

```bash
node tools/check_config.js --env "$SEO_AGENT_ENV_FILE" --fail-on-error
```

Run a no-risk sample observer loop:

```bash
node tools/run_daily_observer.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --obsidian-root "$CLIENT_OBSIDIAN_ROOT" \
  --project clientagency \
  --repos "$CLIENT_BACKUP_REPOS" \
  --sample \
  --skip-email
```

Inspect the queue:

```bash
node tools/export_task_queue.js --db "$SEO_AGENT_DB" --status candidate --markdown
```

Dry-run the executor:

```bash
node tools/run_task_executor.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --limit 1
```

Dry-run outbox workers:

```bash
node tools/sync_obsidian_outbox.js \
  --db "$SEO_AGENT_DB" \
  --obsidian-root "$CLIENT_OBSIDIAN_ROOT" \
  --dry-run

node tools/send_email_outbox.js \
  --db "$SEO_AGENT_DB" \
  --dry-run
```

---

## 6. Production Daily Loop

Use the daily observer first. It creates tasks and state; it does not need Hermes to invent the process.

```bash
cd /opt/client-agent

node tools/run_daily_observer.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --obsidian-root "$CLIENT_OBSIDIAN_ROOT" \
  --project clientagency \
  --repos "$CLIENT_BACKUP_REPOS"
```

Then execute only safe tasks, dry-run first:

```bash
node tools/run_task_executor.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --limit 3
```

When the dry-run looks good, allow safe production execution:

```bash
node tools/run_task_executor.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --limit 3 \
  --apply \
  --validate-live \
  --rollback-on-failure
```

For approved semi-safe and high-risk tasks:

```bash
node tools/run_task_executor.js \
  --db "$SEO_AGENT_DB" \
  --site-root "$CLIENT_SITE_ROOT" \
  --all-lanes \
  --apply \
  --push
```

Do not add `--validate` to the semi-safe/high-risk pipeline yet unless you have patched the pipeline to pass a real preview URL to `validate_live_deployment.js`. The validator currently requires `--url`, while those pipelines call it with `--preview` only.

After pushing a preview branch, wait for Cloudflare and validate the real URL:

```bash
node tools/wait_cloudflare_deployment.js \
  --project clientagency \
  --branch "agent/YOUR-BRANCH" \
  --db "$SEO_AGENT_DB" \
  --state-deployment-id "DEP-ID-FROM-PIPELINE" \
  --fail-on-error
```

Use the matched Cloudflare URL or alias from the waiter output:

```bash
node tools/validate_live_deployment.js \
  --url "https://REAL-PREVIEW-URL.pages.dev" \
  --deployment-id "DEP-ID-FROM-PIPELINE" \
  --db "$SEO_AGENT_DB" \
  --task "CAND-..." \
  --domain {{DOMAIN}}
```

---

## 7. Linux Cron

`tools/install_linux_scheduler.js` is the Linux cron source of truth. It installs the upgraded split-lane schedule against the production defaults in the shell wrappers (`/opt/client-sqlite/seo-agent.db`, `/opt/client-site`, `/opt/client-obsidian`) and removes old unmarked {{SITE_NAME}} cron lines without touching unrelated external jobs.

Current split-lane cadence:

- Monitor: `4,19,34,49 * * * *` â†’ `run-monitor.sh`
- Email approval check: `6,26,46 * * * *` â†’ `run-email-check.sh`
- Outbox worker: `1,11,21,31,41,51 * * * *` â†’ `run-outbox-worker.sh`
- General operational executor: `*/4 * * * *` â†’ `run-task-executor.sh`
- Blog draft publisher: `*/19 * * * *` â†’ `run-blog-publisher.sh`
- Blog editor/refresh worker: `43 */4 * * *` â†’ `run-blog-editor.sh`
- Blog preview review worker: `27 */2 * * *` â†’ `run-blog-review-worker.sh`
- Brain-aware daily observer: `17 */2 * * *` â†’ `run-daily.sh`
- Backup/consistency/opportunity/weekly/monthly jobs are also included in the generated managed block.

Install or refresh cron:

```bash
cd /opt/client-agent
node tools/install_linux_scheduler.js --json
node tools/install_linux_scheduler.js --apply --json
```

Check installed cron:

```bash
crontab -l | grep -E 'run-(monitor|email-check|outbox-worker|task-executor|blog-publisher|blog-editor|blog-review-worker|daily|backup|consistency|opportunity-scan|weekly-review|monthly-roadmap)\.sh'
```

---

## 8. Install The Provided Hermes Assets

The repo already includes Hermes-specific assets under `/opt/client-agent/hermes`. Install those first, then edit them for the VPS paths and your actual Hermes installation.

```text
hermes/
  deploy-hermes.sh                   # convenience installer; review before running
  smoke-test.sh                      # basic post-install checks
  seo-agent                         # convenience command wrapper
  config/config.yaml                # Hermes config template
  memories/MEMORY.md                # compact project memory
  memories/USER.md                  # user preference memory
  skills/client/system-rules/
  skills/client/daily-loop/
  skills/client/safe-fix/
  skills/client/preview-branch/
  skills/client/high-risk-approval/
  skills/client/blog-publisher/
  skills/client/gsc-opportunity/
  skills/client/serp-tracker/
  skills/client/content-refresh/
  skills/client/delegation-rules/
  skills/client/sync-repair/
  systemd/hermes-gateway.service    # root-oriented service template
```

Install as the `hermes` user:

```bash
sudo -iu hermes

mkdir -p ~/.hermes/memories ~/.hermes/skills ~/.local/bin

cp /opt/client-agent/hermes/config/config.yaml ~/.hermes/config.yaml
cp /opt/client-agent/hermes/memories/MEMORY.md ~/.hermes/memories/MEMORY.md
cp /opt/client-agent/hermes/memories/USER.md ~/.hermes/memories/USER.md

rm -rf ~/.hermes/skills/client
cp -R /opt/client-agent/hermes/skills/client ~/.hermes/skills/client

install -m 755 /opt/client-agent/hermes/seo-agent ~/.local/bin/seo-agent
```

Make sure `~/.local/bin` is on the PATH used by Hermes:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
. ~/.profile
command -v seo-agent
```

Before relying on the wrapper in production, patch or verify these items:

- Make `hermes/seo-agent` pass `--db "$SEO_AGENT_DB"` to stateful commands, or always call it with an explicit `--db /opt/client-sqlite/seo-agent.db`.
- Standardize task arguments on the current Node tools' option name, `--task`, not `--task-id`.
- Do not use the wrapper's `daily` command until it is aligned with the current heartbeat CLI and the production DB path. The explicit Node commands in this guide are the safer first production path.
- Review `~/.hermes/config.yaml`. The included template assumes OpenRouter/Nous-style models and conservative manual approval behavior. Keep the manual approval posture for terminal actions.
- Review `~/.hermes/memories/USER.md` before copying it to a shared server. It contains personal preference context and should not be committed to public repos.

The included `hermes/systemd/hermes-gateway.service` is a root-oriented template. Prefer the official Hermes gateway installer if your basic setup provides one. If you use this file, edit `User`, `HOME`, `WorkingDirectory`, `ExecStart`, and log paths so the service runs as the dedicated `hermes` user, not root.

The included `hermes/deploy-hermes.sh` and `hermes/smoke-test.sh` are useful references, but do not run them blindly on production. The deploy script currently initializes the DB without `--db /opt/client-sqlite/seo-agent.db`, installs the wrapper into `/usr/local/bin`, installs the root-oriented gateway service, and points you back to `npm run install-cron`. Verify the generated managed split-lane crontab and production DB path before using it on a new host.

---

## 9. Hermes Project Context

Create `/opt/client-agent/AGENTS.md` or the equivalent project-instructions file your Hermes build reads. If your Hermes setup does not load `AGENTS.md`, keep this same content in `client-system-rules` and `~/.hermes/memories/MEMORY.md`.

```md
# {{SITE_NAME}} Agent Rules

Hermes is the operator. The Node tools are the executor. SQLite is source of truth.

Use node tools in this repo for state changes. Do not edit SQLite directly. Do not treat Obsidian as authority.

Production DB:
/opt/client-sqlite/seo-agent.db

Repos:
- Agent: /opt/client-agent
- Website: /opt/client-site
- SQLite/state: /opt/client-sqlite
- Obsidian mirror: /opt/client-obsidian

Risk lanes:
- Safe: may auto-push only after local validation, live validation, and rollback-on-failure.
- Semi-safe: branch + Cloudflare preview + email/Obsidian review.
- High-risk: approval request first; no file writes before approval.
- Blocked: stop and report.

Never store secrets in repos, Obsidian, reports, logs, blog drafts, or Hermes memory.
```

The copied Hermes memory should stay compact. If you are not using the provided memory file, create one:

```bash
mkdir -p ~/.hermes/memories
nano ~/.hermes/memories/MEMORY.md
```

Suggested content:

```md
{{SITE_NAME}} agent repo is /opt/client-agent.
Website repo is /opt/client-site.
SQLite truth DB is /opt/client-sqlite/seo-agent.db.
Obsidian mirror is /opt/client-obsidian.
Hermes should call Node tools, not edit SQLite directly.
Safe tasks can auto-run only after validation. Semi-safe tasks need previews. High-risk tasks need approval tokens.
```

---

## 10. Hermes Skills

The repo-provided skills are the best starting point. Install them from `hermes/skills/client` as shown above, then adjust the command examples so they match the current Node CLIs.

```bash
ls ~/.hermes/skills/client
```

Recommended skills to keep enabled:

- `system-rules`: always load before {{SITE_NAME}} work.
- `daily-loop`: runs observer, executor, outbox, and summary flows.
- `safe-fix`: constrains low-risk technical fixes.
- `preview-branch`: handles branch and Cloudflare preview work.
- `high-risk-approval`: prepares approval requests before risky changes.
- `blog-publisher`: uses the website/content workflow for drafts and previews.
- `gsc-opportunity`: pulls and interprets Search Console opportunity data.
- `serp-tracker`: runs ranking checks and stores SERP observations.
- `content-refresh`: prepares existing-page refresh work through the safety lanes.
- `delegation-rules`: constrains coding delegation to Codex/Claude/OpenCode-style workers.
- `sync-repair`: repairs Obsidian from SQLite, never the reverse.

Production edits to make in those skills:

- Replace any example using `--task-id` with `--task`.
- Prefer direct Node commands with explicit `--db /opt/client-sqlite/seo-agent.db` until the `seo-agent` wrapper is patched.
- Keep the rule that semi-safe and high-risk changes must use Cloudflare previews and approval records.
- Keep the rule that Obsidian is a mirror and SQLite wins during repair.

Optional bundle, if your Hermes build supports bundles:

```bash
hermes bundles create client-ops \
  --skill client/system-rules \
  --skill client/daily-loop \
  --skill client/safe-fix \
  --skill client/preview-branch \
  --skill client/high-risk-approval \
  --skill client/blog-publisher \
  --skill client/gsc-opportunity \
  --skill client/serp-tracker \
  --skill client/content-refresh \
  --skill client/delegation-rules \
  --skill client/sync-repair \
  -d "{{SITE_NAME}} operations workflow"
```

---

## 11. How To Talk To Hermes

Good instruction:

```text
/client-daily-loop Run today's {{SITE_NAME}} loop. Auto-fix safe tasks only. Create previews or approval requests for everything else. Summarize failures and next actions.
```

Good instruction for review-only:

```text
/client-daily-loop Run the observer and daily summary only. Do not execute tasks.
```

Good instruction for high-risk prep:

```text
Prepare approval requests for high-risk {{SITE_NAME}} tasks. Do not edit website files.
```

Bad instruction:

```text
Improve the SEO system.
```

That is too broad. Hermes should run named local tools and report the result.

---

## 12. Cloudflare Pages Setup

In Cloudflare Pages:

- Connect the `client-site` GitHub repo.
- Set production branch to `main`.
- Use project name `clientagency`.
- Enable preview deployments for agent branches.
- Verify preview builds are noindexed.

Check from the VPS:

```bash
cd /opt/client-agent
node tools/check_cloudflare_pages.js --list-projects
node tools/check_cloudflare_pages.js --project clientagency
```

Important: Cloudflare preview URLs should be read from the Cloudflare API result (`deployment.url` or `aliases`). Do not assume `https://agent/branch.domain` is a valid URL.

---

## 13. Known Current Code Realities

These are not reasons to block setup, but they affect the Ubuntu guide:

1. `tools/install_linux_scheduler.js` currently installs five jobs, not all nine wrappers. Use the full crontab block in this guide for production.
2. The shell wrappers hardcode `tools/out/state/seo-agent.db`. If production truth should live in `/opt/client-sqlite/seo-agent.db`, call tools directly with `--db "$SEO_AGENT_DB"` or patch wrappers to honor `SEO_AGENT_DB`.
3. `run_semi_safe_pipeline.js` and `run_high_risk_pipeline.js` call `validate_live_deployment.js` without a required `--url` when `--validate` is used. For now, push the preview, wait for Cloudflare, then validate the real URL manually.
4. `check_repo_health.js --db` appears to use an older `repo_status_checks` insert shape. Run it without `--db` until patched, or rely on `run_daily_observer.js` dirty-state gate.
5. `hermes/seo-agent` is a useful wrapper, but it needs production hardening around explicit DB paths and current CLI option names before Hermes should depend on it for unattended runs.
6. `hermes/systemd/hermes-gateway.service` is root-oriented. Edit it for the `hermes` user or use the official Hermes service installer.
7. `hermes/deploy-hermes.sh` is a convenience installer, not the recommended production path yet. It uses the default DB init, `/usr/local/bin`, the root gateway service template, and the five-job cron installer unless patched.
8. `hermes/smoke-test.sh` verifies basic presence checks, but it does not prove every stateful command uses `/opt/client-sqlite/seo-agent.db`. After it passes, run the explicit `--db "$SEO_AGENT_DB"` smoke tests in this guide.
9. Private SSH keys should stay outside Git. The local `.gitignore` already excludes `connection/`, `connection/id_rsa`, and `connection/key.ppk`.

---

## 14. Final Operating Model

Use Linux cron for deterministic recurring jobs. Use Hermes for natural-language control, summaries, approvals, triage, and on-demand runs.

```text
Hermes understands and orchestrates.
Node tools execute.
SQLite records truth.
Outbox updates Obsidian and email.
GitHub stores changes.
Cloudflare deploys previews and production.
Validators decide pass/fail.
Humans approve high-risk work.
```
