#!/bin/bash
#
# Unified sync wrapper for cron
#
# Usage:
#   sync.sh people   # 4x daily: download + laposta + stadion + birthdays
#   sync.sh photos   # Alias for people (photos integrated)
#   sync.sh teams    # Weekly: team download + sync + work history
#   sync.sh functions  # Daily: functions download + commissies + work history
#   sync.sh invoice  # Monthly: functions + invoice data from /financial tab
#   sync.sh nikki    # Daily: nikki contributions download + stadion sync
#   sync.sh freescout # Daily: FreeScout customer sync
#   sync.sh reverse  # Every 15 min: reverse sync (Stadion -> Sportlink)
#   sync.sh all      # Full sync (all steps)
#
# Configuration via environment variables in .env:
#   - All Sportlink/Laposta/Stadion credentials
#   - POSTMARK_* for email reports
#   - OPERATOR_EMAIL for report recipient
#
# Crontab example (single-line entries):
#   0 8,11,14,17 * * * /path/to/sync.sh people  # 4x daily
#   0 7 * * * /path/to/sync.sh nikki            # daily
#   15 7 * * * /path/to/sync.sh functions       # daily
#   0 8 * * * /path/to/sync.sh freescout        # daily
#   0 6 * * 0 /path/to/sync.sh teams            # weekly Sunday
#   0 3 1 * * /path/to/sync.sh invoice          # monthly 1st at 3am
#   */15 * * * * /path/to/sync.sh reverse       # every 15 minutes
#

set -e

# Resolve project directory from script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Parse sync type argument
SYNC_TYPE="${1:-all}"

# Validate sync type
case "$SYNC_TYPE" in
    people|photos|teams|functions|invoice|nikki|freescout|reverse|discipline|all)
        ;;
    *)
        echo "Usage: $0 {people|photos|teams|functions|invoice|nikki|freescout|reverse|discipline|all}" >&2
        exit 1
        ;;
esac

# Create logs directory
LOG_DIR="$PROJECT_DIR/logs/cron"
mkdir -p "$LOG_DIR"

# Flock-based locking (per sync type to allow parallel different syncs)
LOCKFILE="$PROJECT_DIR/.sync-${SYNC_TYPE}.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "Another $SYNC_TYPE sync is running. Exiting." >&2
    exit 1
fi

# Set PATH for Node.js
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Change to project directory
cd "$PROJECT_DIR"

# Source .env file
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
else
    echo "Warning: .env file not found at $PROJECT_DIR/.env" >&2
fi

# Generate log file path
DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$LOG_DIR/sync-${SYNC_TYPE}-${DATE}.log"

# Determine which script to run
case "$SYNC_TYPE" in
    people)
        SYNC_SCRIPT="sync-people.js"
        ;;
    photos)
        # Photos now integrated into people sync (Phase 19)
        echo "Note: Photo sync is now integrated into people sync" >&2
        SYNC_SCRIPT="sync-people.js"
        ;;
    teams)
        SYNC_SCRIPT="sync-teams.js"
        ;;
    functions)
        SYNC_SCRIPT="sync-functions.js"
        ;;
    invoice)
        SYNC_SCRIPT="sync-functions.js"
        SYNC_FLAGS="--with-invoice"
        ;;
    nikki)
        SYNC_SCRIPT="sync-nikki.js"
        ;;
    freescout)
        SYNC_SCRIPT="sync-freescout.js"
        ;;
    reverse)
        SYNC_SCRIPT="reverse-sync.js"
        ;;
    discipline)
        SYNC_SCRIPT="sync-discipline.js"
        ;;
    all)
        SYNC_SCRIPT="sync-all.js"
        ;;
esac

# Run sync with logging
echo "Starting $SYNC_TYPE sync at $(date)" | tee -a "$LOG_FILE"
node "$PROJECT_DIR/$SYNC_SCRIPT" $SYNC_FLAGS 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

# Send email report if configured
if [ -n "$POSTMARK_API_KEY" ] && [ -n "$POSTMARK_FROM_EMAIL" ] && [ -n "$OPERATOR_EMAIL" ]; then
    node "$PROJECT_DIR/scripts/send-email.js" "$LOG_FILE" "$SYNC_TYPE" || \
        echo "Warning: Failed to send email notification" >&2
fi

exit $EXIT_CODE
