#!/bin/bash
set -e

# Resolve project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Prompt for operator email
read -p "Enter operator email address: " OPERATOR_EMAIL

# Validate email is not empty
if [ -z "$OPERATOR_EMAIL" ]; then
    echo "Error: Email address cannot be empty" >&2
    exit 1
fi

# Prompt for Postmark API key
echo ""
echo "Postmark configuration (for email delivery):"
echo "  Get your Server API Token from: Postmark Dashboard -> Servers -> API Tokens"
echo ""
read -p "Enter Postmark API Key: " POSTMARK_API_KEY

# Validate API key is not empty
if [ -z "$POSTMARK_API_KEY" ]; then
    echo "Error: Postmark API Key cannot be empty" >&2
    exit 1
fi

# Prompt for sender email
echo ""
echo "  Sender email must be verified in Postmark Dashboard -> Sender Signatures"
echo ""
read -p "Enter verified sender email address: " POSTMARK_FROM_EMAIL

# Validate sender email is not empty
if [ -z "$POSTMARK_FROM_EMAIL" ]; then
    echo "Error: Sender email cannot be empty" >&2
    exit 1
fi

# Store credentials in .env file
ENV_FILE="$PROJECT_DIR/.env"

# Create .env if it doesn't exist
touch "$ENV_FILE"

# Ensure .env ends with a newline before appending
if [ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ]; then
    echo "" >> "$ENV_FILE"
fi

# Update or add OPERATOR_EMAIL
if grep -q "^OPERATOR_EMAIL=" "$ENV_FILE"; then
    sed -i.bak "s/^OPERATOR_EMAIL=.*/OPERATOR_EMAIL=$OPERATOR_EMAIL/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
    echo "OPERATOR_EMAIL=$OPERATOR_EMAIL" >> "$ENV_FILE"
fi

# Update or add POSTMARK_API_KEY
if grep -q "^POSTMARK_API_KEY=" "$ENV_FILE"; then
    sed -i.bak "s/^POSTMARK_API_KEY=.*/POSTMARK_API_KEY=$POSTMARK_API_KEY/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
    echo "POSTMARK_API_KEY=$POSTMARK_API_KEY" >> "$ENV_FILE"
fi

# Update or add POSTMARK_FROM_EMAIL
if grep -q "^POSTMARK_FROM_EMAIL=" "$ENV_FILE"; then
    sed -i.bak "s/^POSTMARK_FROM_EMAIL=.*/POSTMARK_FROM_EMAIL=$POSTMARK_FROM_EMAIL/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
    echo "POSTMARK_FROM_EMAIL=$POSTMARK_FROM_EMAIL" >> "$ENV_FILE"
fi

# Build cron entries
CRON_ENTRIES="
# Sportlink Sync automation (updated $(date +%Y-%m-%d))
CRON_TZ=Europe/Amsterdam
TZ=Europe/Amsterdam

# Main sync job: runs daily at 6:00 AM Amsterdam time
0 6 * * * flock -w 0 $PROJECT_DIR/.cron.lock $PROJECT_DIR/scripts/cron-wrapper.sh

# Retry job: runs at 8:00 AM if previous sync failed
0 8 * * * [ -f /tmp/sportlink-sync-retry ] && rm /tmp/sportlink-sync-retry && flock -w 0 $PROJECT_DIR/.cron.lock $PROJECT_DIR/scripts/cron-wrapper.sh
"

# Install crontab
(crontab -l 2>/dev/null | grep -v 'sportlink-sync\|cron-wrapper.sh' || true; echo "$CRON_ENTRIES") | crontab -

echo ""
echo "Cron jobs installed successfully!"
echo ""
echo "Configuration stored in .env:"
echo "  - OPERATOR_EMAIL=$OPERATOR_EMAIL"
echo "  - POSTMARK_API_KEY=***"
echo "  - POSTMARK_FROM_EMAIL=$POSTMARK_FROM_EMAIL"
echo ""
echo "Email reports will be sent via Postmark to: $OPERATOR_EMAIL"
echo ""
echo "Scheduled jobs:"
echo "  - Daily sync at 6:00 AM (Amsterdam time)"
echo "  - Retry at 8:00 AM if previous sync failed"
echo ""
echo "Helpful commands:"
echo "  View installed cron jobs:   crontab -l"
echo "  Remove all cron jobs:       crontab -r"
echo ""
