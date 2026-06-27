#!/bin/bash
# =====================================================
# {{SITE_NAME}} + Hermes Agent - Server Deployment Script
# =====================================================
# Run this on your Ubuntu server after basic Hermes setup is complete.
# Usage: bash deploy-hermes.sh
#
# Prerequisites:
#   - Ubuntu server with root access
#   - Hermes Agent already installed (hermes --version works)
#   - Git configured
#   - This script is in the hermes/ directory of your project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[âœ“]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[âœ—]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

echo ""
echo "=============================================="
echo "  {{SITE_NAME}} + Hermes Agent Deployment"
echo "=============================================="
echo ""

# ---- Step 1: Check Prerequisites ----
info "Checking prerequisites..."

if ! command -v hermes &>/dev/null; then
  err "Hermes Agent not found. Install it first:"
  echo "  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
  echo "  source ~/.bashrc"
  exit 1
fi
log "Hermes Agent found: $(hermes --version 2>/dev/null || echo 'unknown version')"

if ! command -v node &>/dev/null; then
  warn "Node.js not found. Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
log "Node.js found: $(node --version)"

if ! command -v git &>/dev/null; then
  apt install -y git
fi
log "Git found: $(git --version)"

if ! command -v sqlite3 &>/dev/null; then
  apt install -y sqlite3
fi
log "SQLite3 found: $(sqlite3 --version | head -c 20)"

# Install utility packages
apt install -y jq curl wget htop tmux 2>/dev/null || true
log "Utility packages installed"

# ---- Step 2: Create Directory Structure ----
info "Creating directory structure..."

mkdir -p /opt/client-site
mkdir -p /opt/client-sqlite/{backups,exports,raw-data,logs,sqlite-dumps,gsc-snapshots,serp-history,crawler-results}
mkdir -p /opt/client-obsidian
mkdir -p /opt/client-agent/logs
log "Directory structure created under /opt/"

# ---- Step 3: Clone Repos (if not already present) ----
info "Checking repos..."

clone_if_missing() {
  local dir=$1
  local url=$2
  if [ -d "$dir/.git" ]; then
    log "Repo already exists: $dir"
  else
    info "Cloning $url â†’ $dir"
    git clone "$url" "$dir" 2>/dev/null || warn "Clone failed for $url (may need token)"
  fi
}

clone_if_missing /opt/client-site https://github.com/YOUR_GITHUB_ORG/client-site.git
clone_if_missing /opt/client-sqlite https://github.com/YOUR_GITHUB_ORG/client-state.git
clone_if_missing /opt/client-obsidian https://github.com/YOUR_GITHUB_ORG/client-obsidian.git
clone_if_missing /opt/client-agent https://github.com/YOUR_GITHUB_ORG/client-agent.git

# ---- Step 4: Install Node Dependencies & Preflight ----
info "Checking Node.js prerequisites..."
cd /opt/client-agent
if [ -f package.json ]; then
  # Only run npm install if dependencies exist
  if grep -q '"dependencies"' package.json; then
    npm install 2>&1 | tail -3
    log "Node dependencies installed"
  else
    log "Zero dependencies architecture - skipping npm install"
  fi
else
  warn "No package.json found in /opt/client-agent"
fi

if [ -f cli/bin/preflight-check.js ]; then
  node cli/bin/preflight-check.js || {
    err "Preflight check failed! Your Node.js version might not support node:sqlite."
    exit 1
  }
  log "Node.js preflight checks passed"
fi

# ---- Step 5: Create .env if missing ----
if [ ! -f /opt/client-agent/.env ]; then
  if [ -f /opt/client-agent/.env.example ]; then
    cp /opt/client-agent/.env.example /opt/client-agent/.env
    chmod 600 /opt/client-agent/.env
    warn ".env created from .env.example â€” YOU MUST EDIT IT with real secrets!"
    warn "  nano /opt/client-agent/.env"
  else
    warn "No .env or .env.example found. Create /opt/client-agent/.env manually."
  fi
else
  log ".env file exists"
fi

# ---- Step 6: Initialize Database ----
info "Initializing database..."
cd /opt/client-agent
# v2.js db snapshot triggers openStateDb which creates tables
node cli/bin/v2.js db snapshot --quiet 2>&1 || warn "Database init had issues (may already exist)"
log "Database initialized"

# ---- Step 7: Make cron scripts executable ----
info "Setting cron script permissions..."
if [ -d cron ]; then
  chmod +x cron/*.sh 2>/dev/null || true
  log "Cron scripts made executable"
fi

# ---- Step 8: Install CLI Wrapper ----
info "Installing seo-agent CLI wrapper..."
if [ -f "$SCRIPT_DIR/seo-agent" ]; then
  cp "$SCRIPT_DIR/seo-agent" /opt/client-agent/seo-agent
  chmod +x /opt/client-agent/seo-agent
  ln -sf /opt/client-agent/seo-agent /usr/local/bin/seo-agent
  log "CLI wrapper installed: seo-agent"
else
  warn "seo-agent wrapper not found in $SCRIPT_DIR"
fi

# ---- Step 9: Deploy Hermes Skills ----
info "Installing Hermes skills..."
mkdir -p ~/.hermes/skills/client
mkdir -p ~/.hermes/skills/obsidian

SKILLS_DIR="$SCRIPT_DIR/skills/client"
if [ -d "$SKILLS_DIR" ]; then
  cp -r "$SKILLS_DIR"/* ~/.hermes/skills/client/
  log "{{SITE_NAME}} skills installed to ~/.hermes/skills/client/"
  echo "    Skills: $(ls ~/.hermes/skills/client/ | tr '\n' ', ')"
else
  warn "{{SITE_NAME}} skills directory not found at $SKILLS_DIR"
fi

OBSIDIAN_SKILLS_DIR="$SCRIPT_DIR/skills/obsidian"
if [ -d "$OBSIDIAN_SKILLS_DIR" ]; then
  cp -r "$OBSIDIAN_SKILLS_DIR"/* ~/.hermes/skills/obsidian/
  log "Obsidian skills installed to ~/.hermes/skills/obsidian/"
  echo "    Skills: $(ls ~/.hermes/skills/obsidian/ | tr '\n' ', ')"
else
  warn "Obsidian skills directory not found at $OBSIDIAN_SKILLS_DIR"
fi

# ---- Step 10: Deploy Hermes Memory ----
info "Installing Hermes memory files..."
mkdir -p ~/.hermes/memories

if [ -f "$SCRIPT_DIR/memories/MEMORY.md" ]; then
  cp "$SCRIPT_DIR/memories/MEMORY.md" ~/.hermes/memories/MEMORY.md
  log "MEMORY.md installed"
else
  warn "MEMORY.md not found"
fi

if [ -f "$SCRIPT_DIR/memories/USER.md" ]; then
  cp "$SCRIPT_DIR/memories/USER.md" ~/.hermes/memories/USER.md
  log "USER.md installed"
else
  warn "USER.md not found"
fi

# ---- Step 11: Deploy Hermes Config (if not already present) ----
info "Checking Hermes config..."
if [ -f ~/.hermes/config.yaml ]; then
  log "config.yaml already exists (not overwriting)"
  info "Review the template at: $SCRIPT_DIR/config/config.yaml"
else
  if [ -f "$SCRIPT_DIR/config/config.yaml" ]; then
    cp "$SCRIPT_DIR/config/config.yaml" ~/.hermes/config.yaml
    log "config.yaml installed (EDIT IT with your model provider settings)"
    warn "  nano ~/.hermes/config.yaml"
  fi
fi

# ---- Step 12: Install systemd service ----
info "Installing Hermes Gateway systemd service..."
if [ -f "$SCRIPT_DIR/systemd/hermes-gateway.service" ]; then
  cp "$SCRIPT_DIR/systemd/hermes-gateway.service" /etc/systemd/system/
  systemctl daemon-reload
  log "hermes-gateway.service installed"
  info "Enable with: systemctl enable hermes-gateway"
  info "Start with:  systemctl start hermes-gateway"
else
  warn "systemd service file not found"
fi

# ---- Step 13: Install Crontab ----
info "Checking crontab..."
if crontab -l 2>/dev/null | grep -q "client-agent"; then
  log "Crontab already has {{SITE_NAME}} entries"
else
  warn "Crontab does not have {{SITE_NAME}} entries."
  info "Run the installer: cd /opt/client-agent && npm run install-cron"
  info "Or manually add entries from the implementation guide."
fi

# ---- Step 14: Set Permissions ----
info "Setting file permissions..."
chmod 600 /opt/client-agent/.env 2>/dev/null || true
chmod 600 ~/.hermes/.env 2>/dev/null || true
chmod 600 ~/.hermes/config.yaml 2>/dev/null || true
chmod 700 ~/.hermes/memories/ 2>/dev/null || true
chmod 700 /opt/client-site 2>/dev/null || true
chmod 700 /opt/client-sqlite 2>/dev/null || true
chmod 700 /opt/client-obsidian 2>/dev/null || true
chmod 700 /opt/client-agent 2>/dev/null || true
log "Permissions secured"

# ---- Summary ----
echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="
echo ""
log "{{SITE_NAME}} skills installed: $(ls ~/.hermes/skills/client/ 2>/dev/null | wc -l) skills"
log "Obsidian skills installed: $(ls ~/.hermes/skills/obsidian/ 2>/dev/null | wc -l) skills"
log "CLI wrapper: seo-agent help"
log "Memory files: ~/.hermes/memories/"
echo ""
echo "  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”"
echo "  â”‚     REMAINING MANUAL STEPS:          â”‚"
echo "  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤"
echo "  â”‚ 1. Edit /opt/client-agent/.env   â”‚"
echo "  â”‚    with real API keys and secrets    â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 2. Edit ~/.hermes/config.yaml        â”‚"
echo "  â”‚    with your model provider settings â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 3. Edit ~/.hermes/.env               â”‚"
echo "  â”‚    with LLM API key + Telegram token â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 4. Run: hermes doctor                â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 5. Run: seo-agent config             â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 6. Install crontab:                  â”‚"
echo "  â”‚    npm run install-cron              â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 7. Start gateway (if using Telegram):â”‚"
echo "  â”‚    systemctl enable hermes-gateway   â”‚"
echo "  â”‚    systemctl start hermes-gateway    â”‚"
echo "  â”‚                                      â”‚"
echo "  â”‚ 8. Test: hermes                      â”‚"
echo "  â”‚    Say: 'Load client-system-    â”‚"
echo "  â”‚    rules and check repo health'      â”‚"
echo "  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜"
echo ""
