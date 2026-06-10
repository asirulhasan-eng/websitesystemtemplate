#!/usr/bin/env bash
# check-health-status.sh — parse health JSON safely
# Source this file, then call: is_health_critical "$HEALTH_JSON_STRING"
# Returns 0 (critical) or 1 (not critical)

is_health_critical() {
  local health_json="${1:?health JSON string required}"
  local status
  status=$(node -e "
    try {
      const h = JSON.parse(process.argv[1]);
      process.stdout.write(h.overall_status || h.status || 'unknown');
    } catch { process.stdout.write('unknown'); }
  " "$health_json" 2>/dev/null)
  [ "$status" = "critical" ]
}
