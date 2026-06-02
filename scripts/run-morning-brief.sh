#!/usr/bin/env bash
# Morning brief runner — macOS and Linux/Raspberry Pi compatible
#
# Option A: OS-level cron, standalone (no gateway required).
# Output saved to .dexter/logs/morning-brief-YYYY-MM-DD.log
# Keeps last 30 days of logs.
#
# Setup (one-time):
#   chmod +x /path/to/dexter/scripts/run-morning-brief.sh
#   crontab -e
#   # Add ONE of the following lines:
#   # Weekdays only (Mon-Fri):
#   0 1 * * 1-5 /path/to/dexter/scripts/run-morning-brief.sh
#   # Every day:
#   0 1 * * * /path/to/dexter/scripts/run-morning-brief.sh
#   # (01:00 UTC = 08:00 WIB)
#
# macOS note: cron may need Full Disk Access in System Preferences > Privacy.
# Raspberry Pi: crontab -e works as-is.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$REPO_DIR/.dexter/logs"
DATE="$(date +%Y-%m-%d)"
LOG_FILE="$LOG_DIR/morning-brief-$DATE.log"

# Load .env from repo root
if [ -f "$REPO_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$REPO_DIR/.env"
  set +a
fi

mkdir -p "$LOG_DIR"

echo "=== Morning Brief $DATE $(date +"%H:%M:%S %Z") ===" | tee -a "$LOG_FILE"

cd "$REPO_DIR"
bun scripts/morning-check.ts 2>&1 | tee -a "$LOG_FILE"

echo "=== Done $(date +"%H:%M:%S %Z") ===" | tee -a "$LOG_FILE"

# Rotate: keep last 30 days
find "$LOG_DIR" -name "morning-brief-*.log" -mtime +30 -delete 2>/dev/null || true
