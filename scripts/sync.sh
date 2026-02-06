#!/bin/bash
#
# Unified sync wrapper for cron
#
# Usage:
#   sync.sh people   # 4x daily: download + laposta + Rondo Club + photos
#   sync.sh photos   # Alias for people (photos integrated)
#   sync.sh teams    # Weekly: team download + sync + work history
#   sync.sh functions  # Daily: functions download + commissies + work history
#   sync.sh invoice  # Monthly: functions + invoice data from /financial tab
#   sync.sh nikki    # Daily: nikki contributions download + Rondo Club sync
#   sync.sh freescout # Daily: FreeScout customer sync
#   sync.sh reverse  # Every 15 min: reverse sync (Rondo Club -> Sportlink)
#   sync.sh all      # Full sync (all steps)
#
# Configuration via environment variables in .env:
#   - All Sportlink/Laposta/Rondo Club credentials
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

# Interactive menu when no argument given
if [ -z "$1" ]; then
    # Only show menu if running in a terminal
    if [ ! -t 0 ]; then
        echo "Error: no pipeline specified (non-interactive mode)" >&2
        echo "Usage: sync.sh <pipeline>" >&2
        exit 1
    fi

    echo ""
    echo "Rondo Sync — pick a pipeline:"
    echo ""
    echo "  1) people           Members, parents, photos"
    echo "  2) functions        Commissies + free fields (recent updates)"
    echo "  3) functions --all  Full commissie sync (all members)"
    echo "  4) nikki            Nikki contributions"
    echo "  5) freescout        FreeScout customers"
    echo "  6) teams            Team rosters + work history"
    echo "  7) discipline       Discipline cases"
    echo "  8) invoice          Functions + invoice data"
    echo "  9) all              Run all pipelines sequentially"
    echo ""
    printf "Choice [1-9]: "
    read -r CHOICE

    case "$CHOICE" in
        1) set -- "people" ;;
        2) set -- "functions" ;;
        3) set -- "functions" "--all" ;;
        4) set -- "nikki" ;;
        5) set -- "freescout" ;;
        6) set -- "teams" ;;
        7) set -- "discipline" ;;
        8) set -- "invoice" ;;
        9) set -- "all" ;;
        *)
            echo "Invalid choice." >&2
            exit 1
            ;;
    esac

    printf "Verbose output? [y/N]: "
    read -r VERBOSE_CHOICE
    case "$VERBOSE_CHOICE" in
        [yY]*) set -- "$@" "--verbose" ;;
    esac

    echo ""
fi

SYNC_TYPE="$1"
shift
EXTRA_FLAGS="$*"

# Validate sync type
case "$SYNC_TYPE" in
    people|photos|teams|functions|invoice|nikki|freescout|reverse|discipline|all)
        ;;
    *)
        echo "Unknown sync type: $SYNC_TYPE" >&2
        echo "Run without arguments for interactive menu." >&2
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

# Merge flags from interactive menu and script mapping
SYNC_FLAGS="${SYNC_FLAGS:+$SYNC_FLAGS }$EXTRA_FLAGS"

# Run sync with logging
echo "Starting $SYNC_TYPE sync at $(date)" | tee -a "$LOG_FILE"
node "$PROJECT_DIR/pipelines/$SYNC_SCRIPT" $SYNC_FLAGS 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

# Send email report if configured
if [ -n "$POSTMARK_API_KEY" ] && [ -n "$POSTMARK_FROM_EMAIL" ] && [ -n "$OPERATOR_EMAIL" ]; then
    node "$PROJECT_DIR/scripts/send-email.js" "$LOG_FILE" "$SYNC_TYPE" || \
        echo "Warning: Failed to send email notification" >&2
fi

exit $EXIT_CODE
