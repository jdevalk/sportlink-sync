#!/bin/bash
set -e

# Resolve project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Sportlink Sync - Cron Installation"
echo "==================================="
echo ""
echo "This will set up six sync schedules:"
echo "  - People sync:    4x daily (members, parents, birthdays, photos)"
echo "  - Nikki sync:     daily at 7:00 AM"
echo "  - FreeScout sync: daily at 8:00 AM"
echo "  - Team sync:      weekly on Sunday at 6:00 AM"
echo "  - Functions sync: weekly on Sunday at 7:00 AM"
echo "  - Reverse sync:   every 15 minutes (Stadion -> Sportlink)"
echo ""

# Check if .env exists and has Postmark config
ENV_FILE="$PROJECT_DIR/.env"
NEED_POSTMARK=false

if [ ! -f "$ENV_FILE" ]; then
    NEED_POSTMARK=true
elif ! grep -q "^POSTMARK_API_KEY=" "$ENV_FILE" || ! grep -q "^OPERATOR_EMAIL=" "$ENV_FILE"; then
    NEED_POSTMARK=true
fi

if [ "$NEED_POSTMARK" = true ]; then
    echo "Email notification setup"
    echo "------------------------"

    # Prompt for operator email
    read -p "Enter operator email address: " OPERATOR_EMAIL

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

    if [ -z "$POSTMARK_API_KEY" ]; then
        echo "Error: Postmark API Key cannot be empty" >&2
        exit 1
    fi

    # Prompt for sender email
    echo ""
    echo "  Sender email must be verified in Postmark Dashboard -> Sender Signatures"
    echo ""
    read -p "Enter verified sender email address: " POSTMARK_FROM_EMAIL

    if [ -z "$POSTMARK_FROM_EMAIL" ]; then
        echo "Error: Sender email cannot be empty" >&2
        exit 1
    fi

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

    echo ""
    echo "Postmark configuration saved to .env"
else
    echo "Using existing Postmark configuration from .env"
    OPERATOR_EMAIL=$(grep "^OPERATOR_EMAIL=" "$ENV_FILE" | cut -d= -f2)
fi

echo ""

# Build cron entries - sync.sh handles locking internally
CRON_ENTRIES="
# Sportlink Sync automation (installed $(date +%Y-%m-%d))
CRON_TZ=Europe/Amsterdam

# People sync: 4x daily during work hours (members, parents, birthdays, photos)
0 8,11,14,17 * * * $PROJECT_DIR/scripts/sync.sh people

# Nikki sync: daily at 7:00 AM
0 7 * * * $PROJECT_DIR/scripts/sync.sh nikki

# FreeScout sync: daily at 8:00 AM
0 8 * * * $PROJECT_DIR/scripts/sync.sh freescout

# Team sync: weekly on Sunday at 6:00 AM
0 6 * * 0 $PROJECT_DIR/scripts/sync.sh teams

# Functions sync: weekly on Sunday at 7:00 AM (after teams)
0 7 * * 0 $PROJECT_DIR/scripts/sync.sh functions

# Reverse sync: every 15 minutes (Stadion -> Sportlink)
*/15 * * * * $PROJECT_DIR/scripts/sync.sh reverse
"

# Install crontab (remove old entries first)
(crontab -l 2>/dev/null | grep -v 'sportlink\|sync\.sh\|cron-wrapper' || true; echo "$CRON_ENTRIES") | crontab -

echo "Cron jobs installed successfully!"
echo ""
echo "Scheduled jobs:"
echo "  - People sync:    4x daily at 8am, 11am, 2pm, 5pm (members, parents, birthdays, photos)"
echo "  - Nikki sync:     daily at 7:00 AM (nikki contributions)"
echo "  - FreeScout sync: daily at 8:00 AM (customer sync)"
echo "  - Team sync:      weekly on Sunday at 6:00 AM"
echo "  - Functions sync: weekly on Sunday at 7:00 AM"
echo "  - Reverse sync:   every 15 minutes (Stadion -> Sportlink)"
echo ""
echo "All times are Amsterdam timezone (Europe/Amsterdam)"
echo ""
if [ -n "$OPERATOR_EMAIL" ]; then
    echo "Email reports will be sent to: $OPERATOR_EMAIL"
    echo ""
fi
echo "Helpful commands:"
echo "  View installed cron jobs:   crontab -l"
echo "  View logs:                  ls -la $PROJECT_DIR/logs/cron/"
echo "  Manual sync:                $PROJECT_DIR/scripts/sync.sh {people|teams|functions|nikki|freescout|reverse|all}"
echo "  Remove all cron jobs:       crontab -r"
echo ""
