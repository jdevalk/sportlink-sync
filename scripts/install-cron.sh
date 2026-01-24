#!/bin/bash
set -e

# Resolve project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Check if mail command exists
if ! command -v mail &> /dev/null; then
    echo "Error: 'mail' command not found" >&2
    echo "" >&2
    echo "Please install mail utilities:" >&2
    echo "  Ubuntu/Debian: sudo apt-get install mailutils" >&2
    echo "  RHEL/CentOS: sudo yum install mailx" >&2
    echo "  macOS: brew install mailutils (or use built-in mail)" >&2
    exit 1
fi

# Prompt for operator email
read -p "Enter operator email address: " OPERATOR_EMAIL

# Validate email is not empty
if [ -z "$OPERATOR_EMAIL" ]; then
    echo "Error: Email address cannot be empty" >&2
    exit 1
fi

# Build cron entries
CRON_ENTRIES="
# Sportlink Sync automation (installed $(date +%Y-%m-%d))
CRON_TZ=Europe/Amsterdam
TZ=Europe/Amsterdam
MAILTO=$OPERATOR_EMAIL

# Main sync job: runs daily at 6:00 AM Amsterdam time
0 6 * * * flock -w 0 $PROJECT_DIR/.cron.lock $PROJECT_DIR/scripts/cron-wrapper.sh

# Retry job: runs at 8:00 AM if previous sync failed
0 8 * * * [ -f /tmp/sportlink-sync-retry ] && rm /tmp/sportlink-sync-retry && flock -w 0 $PROJECT_DIR/.cron.lock $PROJECT_DIR/scripts/cron-wrapper.sh
"

# Install crontab
(crontab -l 2>/dev/null || true; echo "$CRON_ENTRIES") | crontab -

echo ""
echo "✓ Cron jobs installed successfully!"
echo ""
echo "Email reports will be sent to: $OPERATOR_EMAIL"
echo ""
echo "Scheduled jobs:"
echo "  - Daily sync at 6:00 AM (Amsterdam time)"
echo "  - Retry at 8:00 AM if previous sync failed"
echo ""
echo "Helpful commands:"
echo "  View installed cron jobs:   crontab -l"
echo "  Remove all cron jobs:       crontab -r"
echo ""
