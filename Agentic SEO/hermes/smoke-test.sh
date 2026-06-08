#!/bin/bash
# =====================================================
# {{SITE_NAME}} + Hermes Agent - Smoke Test Script
# =====================================================
# Run this after deployment to verify everything works.
# Usage: bash smoke-test.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)) || true; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)) || true; }
warn_msg() { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARN++)) || true; }
info() { echo -e "${BLUE}[TEST]${NC} $1"; }

echo ""
echo "=============================================="
echo "  {{SITE_NAME}} + Hermes Smoke Test"
echo "=============================================="
echo ""

# ---- 1. System Dependencies ----
info "Checking system dependencies..."

if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/')
  NODE_MINOR=$(echo "$NODE_VER" | sed -E 's/^v[0-9]+\.([0-9]+).*/\1/')
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 5 ]; }; then
    pass "Node.js $NODE_VER (>= 22.5)"
  else
    fail "Node.js $NODE_VER (need >= 22.5)"
  fi
else
  fail "Node.js not installed"
fi

command -v git &>/dev/null && pass "Git installed" || fail "Git not installed"
command -v sqlite3 &>/dev/null && pass "SQLite3 installed" || fail "SQLite3 not installed"
command -v hermes &>/dev/null && pass "Hermes Agent installed" || fail "Hermes Agent not installed"

# ---- 2. Repos Present ----
echo ""
info "Checking repos..."

for repo in client-site client-sqlite client-obsidian client-agent; do
  if [ -d "/opt/$repo/.git" ]; then
    pass "Repo /opt/$repo exists"
  else
    fail "Repo /opt/$repo missing"
  fi
done

# ---- 3. SEO Agent Config ----
echo ""
info "Checking SEO Agent configuration..."

if [ -f /opt/client-agent/.env ]; then
  pass ".env file exists"
  # Check if it has real values (not just placeholders)
  if grep -q "PASTE_REAL\|your_" /opt/client-agent/.env 2>/dev/null; then
    warn_msg ".env contains placeholder values â€” edit with real secrets"
  fi
else
  fail ".env file missing"
fi

if [ -f /opt/client-agent/package.json ]; then
  pass "package.json exists"
else
  fail "package.json missing"
fi

if [ -d /opt/client-agent/node_modules ]; then
  pass "node_modules installed"
else
  fail "node_modules missing â€” run: cd /opt/client-agent && npm install"
fi

# ---- 4. Database ----
echo ""
info "Checking database..."

DB_PATH="/opt/client-sqlite/seo-agent.db"
if [ -f "$DB_PATH" ]; then
  pass "Database file exists"
  TABLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo 0)
  if [ "$TABLE_COUNT" -gt 0 ]; then
    pass "Database has $TABLE_COUNT tables"
  else
    warn_msg "Database has no tables â€” run: cd /opt/client-agent && npm run init-db"
  fi
else
  fail "Database not found at $DB_PATH"
fi

# ---- 5. CLI Wrapper ----
echo ""
info "Checking CLI wrapper..."

if command -v seo-agent &>/dev/null; then
  pass "seo-agent command available in PATH"
elif [ -x /opt/client-agent/seo-agent ]; then
  warn_msg "seo-agent exists but not in PATH â€” run: ln -sf /opt/client-agent/seo-agent /usr/local/bin/seo-agent"
else
  fail "seo-agent wrapper not found"
fi

# ---- 6. Cron Scripts ----
echo ""
info "Checking cron scripts..."

CRON_DIR="/opt/client-agent/cron"
if [ -d "$CRON_DIR" ]; then
  SH_COUNT=$(find "$CRON_DIR" -name "*.sh" | wc -l)
  EXEC_COUNT=$(find "$CRON_DIR" -name "*.sh" -executable | wc -l)
  if [ "$SH_COUNT" -eq "$EXEC_COUNT" ] && [ "$SH_COUNT" -gt 0 ]; then
    pass "All $SH_COUNT cron scripts are executable"
  else
    warn_msg "$EXEC_COUNT/$SH_COUNT cron scripts are executable"
  fi
else
  fail "Cron directory not found"
fi

# Check crontab
if crontab -l 2>/dev/null | grep -q "client-agent"; then
  pass "Crontab has {{SITE_NAME}} entries"
else
  warn_msg "Crontab is empty â€” install with: npm run install-cron"
fi

# ---- 7. Hermes Skills ----
echo ""
info "Checking Hermes skills..."

SKILLS_DIR="$HOME/.hermes/skills/client"
if [ -d "$SKILLS_DIR" ]; then
  SKILL_COUNT=$(find "$SKILLS_DIR" -name "SKILL.md" | wc -l)
  pass "$SKILL_COUNT Hermes skills installed"
  
  EXPECTED_SKILLS="system-rules daily-workplan cli-reference"
  for skill in $EXPECTED_SKILLS; do
    if [ -f "$SKILLS_DIR/$skill/SKILL.md" ] || [ -f "$SKILLS_DIR/$skill/skill.md" ]; then
      pass "  Skill: $skill"
    else
      fail "  Skill missing: $skill"
    fi
  done
else
  fail "Skills directory not found at $SKILLS_DIR"
fi

# ---- 8. Hermes Memory ----
echo ""
info "Checking Hermes memory..."

if [ -f "$HOME/.hermes/memories/MEMORY.md" ]; then
  pass "MEMORY.md exists"
else
  fail "MEMORY.md missing"
fi

if [ -f "$HOME/.hermes/memories/USER.md" ]; then
  pass "USER.md exists"
else
  fail "USER.md missing"
fi

# ---- 9. Hermes Config ----
echo ""
info "Checking Hermes config..."

if [ -f "$HOME/.hermes/config.yaml" ]; then
  pass "config.yaml exists"
else
  fail "config.yaml missing"
fi

if [ -f "$HOME/.hermes/.env" ]; then
  pass "Hermes .env exists"
else
  warn_msg "Hermes .env missing â€” add your LLM API key"
fi

# ---- 10. Hermes Doctor ----
echo ""
info "Running hermes doctor..."
if hermes doctor 2>&1 | grep -qi "error\|fail"; then
  warn_msg "hermes doctor reported issues"
else
  pass "hermes doctor passed"
fi

# ---- 11. Permissions ----
echo ""
info "Checking permissions..."

check_perms() {
  local file=$1
  local expected=$2
  if [ -f "$file" ] || [ -d "$file" ]; then
    PERMS=$(stat -c "%a" "$file" 2>/dev/null || echo "unknown")
    if [ "$PERMS" = "$expected" ]; then
      pass "Permissions $PERMS on $(basename $file)"
    else
      warn_msg "Permissions $PERMS on $(basename $file) (expected $expected)"
    fi
  fi
}

check_perms /opt/client-agent/.env 600
check_perms "$HOME/.hermes/.env" 600
check_perms "$HOME/.hermes/config.yaml" 600
check_perms "$HOME/.hermes/memories" 700

# ---- 12. Gateway Service ----
echo ""
info "Checking Hermes Gateway service..."
if systemctl list-unit-files | grep -q hermes-gateway || systemctl --user list-unit-files | grep -q hermes-gateway 2>/dev/null; then
  if systemctl is-active hermes-gateway &>/dev/null || systemctl --user is-active hermes-gateway &>/dev/null; then
    pass "hermes-gateway service is running"
  else
    warn_msg "hermes-gateway service is installed but not running"
  fi
else
  warn_msg "hermes-gateway service not installed (optional â€” for Telegram/Discord)"
fi

# ---- Summary ----
echo ""
echo "=============================================="
echo "  Smoke Test Results"
echo "=============================================="
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}WARN: $WARN${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some tests failed. Fix the issues above before proceeding.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}All critical tests passed, but some warnings need attention.${NC}"
  exit 0
else
  echo -e "${GREEN}All tests passed! Your system is ready.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Start Hermes: hermes"
  echo "  2. Say: 'Load client-system-rules and check repo health'"
  echo "  3. Try: 'Run the dead-man monitor'"
  echo "  4. Try: 'Run the daily SEO loop'"
  exit 0
fi
