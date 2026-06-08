# Hermes Agent Integration for {{SITE_NAME}}

> Production note: use `docs/hermes-ubuntu-implementation-guide.md` as the canonical install guide. The scripts in this folder are install assets, but `deploy-hermes.sh`, `seo-agent`, and the systemd service need the production DB-path and service-user caveats from that guide before unattended use.

This directory contains all files needed to integrate Hermes Agent as the orchestrator for the {{SITE_NAME}} closed-loop SEO system.

## Directory Structure

```
hermes/
â”œâ”€â”€ README.md                      â† You are here
â”œâ”€â”€ deploy-hermes.sh               â† Master deployment script (run on server)
â”œâ”€â”€ smoke-test.sh                  â† Post-deployment verification
â”œâ”€â”€ seo-agent                      â† CLI wrapper script
â”‚
â”œâ”€â”€ config/
â”‚   â””â”€â”€ config.yaml                â† Hermes config template
â”‚
â”œâ”€â”€ memories/
â”‚   â”œâ”€â”€ MEMORY.md                  â† Project rules (loaded at session start)
â”‚   â””â”€â”€ USER.md                    â† User preferences (loaded at session start)
â”‚
â”œâ”€â”€ skills/
â”‚   â”œâ”€â”€ obsidian/
â”‚   â”‚   â””â”€â”€ skill.md                  â† Obsidian vault conventions
â”‚   â””â”€â”€ client/
â”‚       â”œâ”€â”€ system-rules/SKILL.md     â† Master ruleset (load first!)
â”‚       â”œâ”€â”€ daily-workplan/skill.md   â† Daily planning workflow
â”‚       â””â”€â”€ cli-reference/skill.md    â† v2 CLI command reference
â”‚
â””â”€â”€ systemd/
    â””â”€â”€ hermes-gateway.service     â† Systemd unit for Telegram/Discord
```

## Quick Start

### 1. Copy to server

```bash
# From your local machine
scp -r -i connection/id_rsa hermes/ root@89.167.16.167:/tmp/hermes-deploy/
```

### 2. Run deployment

```bash
# On the server
ssh -i connection/id_rsa root@89.167.16.167
cd /tmp/hermes-deploy
bash deploy-hermes.sh
```

### 3. Edit secrets

```bash
# SEO Agent secrets
nano /opt/client-agent/.env

# Hermes secrets (LLM API key, Telegram token)
nano ~/.hermes/.env

# Hermes config (model provider)
nano ~/.hermes/config.yaml
```

### 4. Verify

```bash
bash /tmp/hermes-deploy/smoke-test.sh
```

### 5. Test Hermes

```bash
hermes
# Say: "Load client-system-rules and check repo health"
```

## What Gets Installed Where

| Source File | Server Destination |
|-------------|-------------------|
| `seo-agent` | `/opt/client-agent/seo-agent` + `/usr/local/bin/seo-agent` |
| `skills/client/*` | `~/.hermes/skills/client/` |
| `memories/MEMORY.md` | `~/.hermes/memories/MEMORY.md` |
| `memories/USER.md` | `~/.hermes/memories/USER.md` |
| `config/config.yaml` | `~/.hermes/config.yaml` (only if not exists) |
| `systemd/hermes-gateway.service` | `/etc/systemd/system/hermes-gateway.service` |

## Architecture

```
You â†’ Hermes (orchestrator) â†’ seo-agent CLI â†’ Node.js tools â†’ SQLite
                                                                â†“
                                        GitHub â† Obsidian â† Outbox
                                          â†“
                                    Cloudflare Pages
```

**Key rule**: Hermes orchestrates. CLI executes. SQLite is truth. Obsidian is mirror.
