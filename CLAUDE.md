# Sportlink Sync

CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists.

## Quick Reference

```bash
npm run sync-all          # Full sync pipeline (download → prepare → submit)
npm run sync-all-verbose  # Same with detailed logging
npm run install-cron      # Set up automated daily sync with email reports
```

## Architecture

### Sync Pipeline

1. **download-data-from-sportlink.js** - Browser automation (Playwright) logs into Sportlink, handles OTP, downloads member CSV
2. **prepare-laposta-members.js** - Transforms Sportlink fields to Laposta format, handles parent/child associations, deduplication
3. **submit-laposta-list.js** - Syncs to up to 4 Laposta lists via API, uses hash-based change detection
4. **sync-all.js** - Orchestrates full pipeline, produces email-ready summary

### Supporting Files

- `lib/logger.js` - Dual-stream logger (stdout + date-based files in `logs/`)
- `laposta-db.js` - SQLite operations for state tracking and change detection
- `field-mapping.json` - Configurable Sportlink → Laposta field transformations
- `scripts/cron-wrapper.sh` - Cron execution with flock locking and email delivery
- `scripts/install-cron.sh` - Interactive cron setup with credential prompts
- `scripts/send-email.js` - Postmark email delivery for sync reports

### Data Flow

```
Sportlink Club (browser) → CSV → SQLite (state) → Laposta API
                                      ↓
                              Hash-based diff
                                      ↓
                           Only changed members sync
```

## Environment Variables

Required in `.env`:

```bash
# Sportlink credentials
SPORTLINK_USERNAME=
SPORTLINK_PASSWORD=
SPORTLINK_OTP_SECRET=     # TOTP secret for 2FA

# Laposta
LAPOSTA_API_KEY=
LAPOSTA_LIST=             # Primary list ID
LAPOSTA_LIST2=            # Optional additional lists
LAPOSTA_LIST3=
LAPOSTA_LIST4=

# Email delivery
OPERATOR_EMAIL=           # Receives sync reports
POSTMARK_API_KEY=         # Postmark server API token
POSTMARK_FROM_EMAIL=      # Verified sender address
```

## Database

SQLite database `laposta-sync.sqlite` tracks:
- Member hashes for change detection
- Sync state per list
- Last sync timestamps

## Cron Automation

After `npm run install-cron`:
- Daily sync at 6:00 AM Amsterdam time
- Retry at 8:00 AM if primary fails
- Email report via Postmark after each run
- flock prevents overlapping executions

## Code Patterns

### Module/CLI Hybrid

All main scripts export functions AND work as CLI:

```javascript
async function runDownload(options) { /* ... */ }
module.exports = { runDownload };

if (require.main === module) {
  runDownload({ verbose: true });
}
```

### Error Handling

- Graceful failures with detailed logging
- Email delivery failure doesn't fail sync
- Exit codes: 0 = success, 1 = errors occurred

### Logging

```javascript
const { createSyncLogger } = require('./lib/logger');
const logger = createSyncLogger({ verbose });
logger.log('Always shown');
logger.verbose('Only in verbose mode');
logger.error('Error messages');
```

## Development

```bash
npm install              # Install dependencies (includes Playwright)
npx playwright install chromium  # Browser for Sportlink automation

# Debug individual steps
npm run download         # Just download from Sportlink
npm run prepare-laposta  # Just prepare members
npm run sync-laposta     # Just submit to Laposta

# Inspect data
npm run show-laposta-changes    # Pending changes
npm run show-laposta-member     # Single member lookup
npm run show-sportlink-member   # Sportlink data lookup
```

## Tech Stack

- Node.js 18+
- Playwright (Chromium for browser automation)
- better-sqlite3 (state tracking)
- otplib (TOTP generation)
- postmark (email delivery)
- varlock (env loading)
