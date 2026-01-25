#!/bin/bash
set -e

# Resolve project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Create logs directory if needed
LOG_DIR="$PROJECT_DIR/logs/cron"
mkdir -p "$LOG_DIR"

# Flock-based locking
LOCKFILE="$PROJECT_DIR/.cron.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "Another instance is running. Exiting." >&2
    exit 1
fi

# Set PATH
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Change to project directory
cd "$PROJECT_DIR"

# Source .env if exists
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# Generate log file path
DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$LOG_DIR/sync-$DATE.log"

# Run sync with logging
node "$PROJECT_DIR/sync-all.js" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

# On failure, touch retry flag
if [ $EXIT_CODE -ne 0 ]; then
    touch /tmp/sportlink-sync-retry
fi

# Send email via Postmark if credentials are configured
if [ -n "$POSTMARK_API_KEY" ] && [ -n "$POSTMARK_FROM_EMAIL" ] && [ -n "$OPERATOR_EMAIL" ]; then
    node "$PROJECT_DIR/scripts/send-email.js" "$LOG_FILE" || \
        echo "Warning: Failed to send email notification" >&2
    # Note: || prevents email failure from propagating via set -e
else
    echo "Skipping email: Postmark credentials not configured" >&2
fi

exit $EXIT_CODE
