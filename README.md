# Sportlink Sync

A CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists and Stadion WordPress. It downloads member data via browser automation, transforms it according to field mappings, and syncs changes to multiple downstream systems.

## Features

- **Dual-system sync**: Syncs to both Laposta email lists AND Stadion WordPress
- **Automated sync**: Daily cron job at 6:00 AM with email reports via Postmark
- **Change detection**: Only submits members whose data actually changed (hash-based diff)
- **Multi-list support**: Sync to up to 4 Laposta lists
- **Parent deduplication**: Handles parent/child member associations
- **Photo sync**: Downloads member photos from Sportlink and uploads to Stadion
- **Team sync**: Extracts teams from Sportlink and syncs to Stadion with work history linking
- **Email reports**: HTML-formatted sync summaries delivered via Postmark
- **Summary output**: Clean, email-friendly sync reports

## Quick Reference

```bash
npm run sync-all          # Full sync pipeline (Sportlink → Laposta + Stadion)
npm run sync-all-verbose  # Same with detailed logging
npm run install-cron      # Set up automated daily sync with email reports
```

## Architecture

### Sync Pipeline

The full sync pipeline runs in this order:

1. **download-data-from-sportlink.js** - Browser automation downloads member CSV from Sportlink Club
2. **prepare-laposta-members.js** - Transforms Sportlink fields for Laposta using field mappings
3. **submit-laposta-list.js** - Syncs to Laposta via API with hash-based change detection
4. **submit-stadion-sync.js** - Syncs to Stadion WordPress (reads from SQLite, not CSV)
5. **download-photos-from-sportlink.js** - Browser automation downloads member photos
6. **upload-photos-to-stadion.js** - Uploads photos to Stadion via REST API
7. **prepare-stadion-teams.js** - Extracts team assignments from Sportlink data
8. **submit-stadion-teams.js** - Creates/updates teams in Stadion
9. **submit-stadion-work-history.js** - Links persons to teams via work_history field
10. **sync-all.js** - Orchestrates full pipeline, produces HTML email-ready summary

### Data Flow

```
Sportlink Club (browser) → CSV → SQLite (state) → Laposta API
                                      ↓
                              Hash-based diff
                                      ↓
                           Only changed members sync
                                      ↓
                              Stadion WordPress API
                                      ↓
                              Photo download/upload
                                      ↓
                              Team sync + work history
                                      ↓
                              Email report (Postmark)
```

### Supporting Files

- `lib/logger.js` - Dual-stream logger (stdout + date-based files in `logs/`)
- `laposta-db.js` - SQLite operations for state tracking and change detection
- `field-mapping.json` - Configurable Sportlink → Laposta field transformations
- `scripts/cron-wrapper.sh` - Cron execution with flock locking and email delivery
- `scripts/install-cron.sh` - Interactive cron setup with credential prompts
- `scripts/send-email.js` - Postmark email delivery for sync reports

## Setup

Requires Node 18+ (for built-in `fetch`, `FormData`, and `Blob`).

```bash
npm install
npx playwright install chromium  # For browser automation
```

Create a `.env` file with your credentials and configuration:

```bash
# Sportlink credentials
SPORTLINK_USERNAME="you@example.com"
SPORTLINK_PASSWORD="your-password"
SPORTLINK_OTP_SECRET="your-totp-secret"  # TOTP secret for 2FA

# Laposta
LAPOSTA_API_KEY=
LAPOSTA_LIST=             # Primary list ID
LAPOSTA_LIST2=            # Optional additional lists
LAPOSTA_LIST3=
LAPOSTA_LIST4=

# Stadion WordPress
STADION_URL=              # WordPress site URL (https://...)
STADION_USERNAME=         # WordPress username
STADION_APP_PASSWORD=     # Application password (from WordPress profile)
STADION_PERSON_TYPE=      # Custom post type (default: person)

# Email delivery
OPERATOR_EMAIL=           # Receives sync reports
POSTMARK_API_KEY=         # Postmark server API token
POSTMARK_FROM_EMAIL=      # Verified sender address

# Optional
DEBUG_LOG=false
```

## Usage

### One-step full sync

```bash
npm run sync-all
```

For verbose output (shows per-member progress):

```bash
npm run sync-all-verbose
```

This runs the complete pipeline: download → prepare → Laposta sync → Stadion sync → email report.

### Individual pipeline steps

#### Download from Sportlink

```bash
npm run download
```

Downloads member data from Sportlink Club via browser automation. Automatically:
- Uses headless Chromium
- Logs into `https://club.sportlink.com/`
- Handles 2FA with TOTP
- Saves results to `laposta-sync.sqlite`

#### Laposta sync

```bash
npm run prepare-laposta   # Transform data for Laposta
npm run sync-laposta      # Sync to all lists
npm run sync-laposta -- 2 # Sync to list 2 only
npm run sync-laposta -- --force  # Force sync all members (ignore change detection)
```

The preparation script writes members to `laposta-sync.sqlite`, and the sync script only submits members whose Sportlink-derived data changed since the last sync.

- Running without a list index syncs all four lists.
- The list index (1-4) selects which Laposta list to sync.
- Use `--force` to sync all members even if unchanged.

#### Stadion WordPress sync

```bash
npm run sync-stadion                      # Sync all members
npm run sync-stadion-verbose              # Sync all members (verbose)
npm run sync-stadion-parents              # Sync parent members only
npm run sync-stadion-parents-verbose      # Sync parent members only (verbose)
```

The Stadion sync:
- Reads member data from SQLite (not CSV directly)
- Creates/updates WordPress custom posts via REST API
- Uses WordPress Application Passwords for authentication
- Supports custom post types via `STADION_PERSON_TYPE`
- Can sync all members or parent members only

### Photo sync

```bash
npm run download-photos           # Download photos from Sportlink
npm run download-photos-verbose   # Same with detailed logging
npm run sync-photos               # Upload photos to Stadion
npm run sync-photos-verbose       # Same with detailed logging
```

Photo sync:
- Downloads member photos from Sportlink when PersonImageDate indicates presence
- Tracks photo state changes (added, updated, removed)
- Uploads photos to Stadion WordPress via REST API
- Deletes photos from Stadion when removed in Sportlink

### Team sync

Team sync is integrated into `sync-all` and runs automatically. Teams are extracted from:
- UnionTeams field (KNVB-assigned teams, preferred)
- ClubTeams field (club-assigned teams, fallback)

The sync:
- Creates teams in Stadion if they don't exist
- Links persons to teams via work_history ACF repeater field
- Tracks team assignments for change detection
- Only sync-created work_history entries are modified (manual entries preserved)

### Inspection tools

To see what would be sent to Laposta for a given email:

```bash
npm run show-laposta-member -- someone@example.com
npm run show-laposta-member -- someone@example.com 2  # For list 2
```

To see the full list of members pending sync (changes only, with diffs):

```bash
npm run show-laposta-changes
npm run show-laposta-changes -- 2  # For list 2
```

To see all members that would be sent (including unchanged, with diffs):

```bash
npm run show-laposta-changes -- --all
```

Note: diffs are based on the last successful Laposta sync.

To see what is in the latest Sportlink results for an email:

```bash
npm run show-sportlink-member -- someone@example.com
```

### Parent deduplication

To remove duplicate parent members in Laposta (same email, missing last name) across all lists:

```bash
npm run dedupe-laposta              # Dry run (shows what would be deleted)
npm run dedupe-laposta -- --apply   # Actually delete duplicates
npm run dedupe-laposta -- 2 --apply # Delete duplicates in list 2 only
```

- The default run targets all four lists and is a dry run.
- Add `--apply` to delete duplicates.

## Automated daily sync

Set up a cron job that runs the sync daily at 6:00 AM (Amsterdam time) and emails the report via Postmark:

```bash
npm run install-cron
```

This will:
- Prompt for your operator email address and Postmark credentials
- Install crontab entries for daily sync at 6:00 AM
- Configure automatic retry at 8:00 AM if the first sync fails
- Send HTML email reports via Postmark after each sync
- Use flock to prevent overlapping executions

To verify installation:

```bash
crontab -l
```

### Email reports

After each sync (manual or cron), an HTML email report is sent via Postmark containing:
- Sync summary (Laposta + Stadion)
- Members added/updated/deleted
- Error details if any occurred
- Execution duration

## Database

SQLite database `laposta-sync.sqlite` tracks:
- Member hashes for change detection
- Sync state per list
- Last sync timestamps
- Member data for Stadion sync
- Photo state and PersonImageDate for change detection
- Team assignments and work history indices

## Development

### Debug individual steps

```bash
npm run download         # Just download from Sportlink
npm run prepare-laposta  # Just prepare members
npm run sync-laposta     # Just submit to Laposta
npm run sync-stadion     # Just submit to Stadion
npm run download-photos  # Download photos from Sportlink
npm run sync-photos      # Upload photos to Stadion
```

### Inspect data

```bash
npm run show-laposta-changes    # Pending changes
npm run show-laposta-member     # Single member lookup
npm run show-sportlink-member   # Sportlink data lookup
```

### Code patterns

All main scripts follow a module/CLI hybrid pattern:

```javascript
async function runDownload(options) { /* ... */ }
module.exports = { runDownload };

if (require.main === module) {
  runDownload({ verbose: true });
}
```

This allows scripts to be run standalone OR imported as modules.

### Logging

```javascript
const { createSyncLogger } = require('./lib/logger');
const logger = createSyncLogger({ verbose });
logger.log('Always shown');
logger.verbose('Only in verbose mode');
logger.error('Error messages');
```

Logs are written to:
- stdout/stderr (for interactive use)
- `logs/YYYY-MM-DD.log` (for cron/debugging)

### Error handling

- Graceful failures with detailed logging
- Email delivery failure doesn't fail sync
- Exit codes: 0 = success, 1 = errors occurred

## Tech Stack

- Node.js 18+
- Playwright (Chromium for browser automation)
- better-sqlite3 (state tracking)
- otplib (TOTP generation for 2FA)
- postmark (email delivery)
- varlock (environment variable loading)

## What the automation does

The browser automation:
- Runs in headless mode (no visible window)
- Uses `https://club.sportlink.com/` as the login URL
- Handles TOTP-based 2FA automatically
- Waits for `#panelHeaderTasks` selector to confirm login success
- Downloads member data export
- Saves results to SQLite database

## License

Private project - all rights reserved.
