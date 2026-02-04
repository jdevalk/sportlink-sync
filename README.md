# Sportlink Sync

A CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists and Stadion WordPress. It downloads member data via browser automation, transforms it according to field mappings, and syncs changes to multiple downstream systems.

## Features

- **Multi-system sync**: Syncs to Laposta email lists, Stadion WordPress, and FreeScout helpdesk
- **Automated scheduling**: 4x daily, daily, and weekly cron jobs with email reports via Postmark
- **Change detection**: Only submits members whose data actually changed (hash-based diff)
- **Multi-list support**: Sync to up to 4 Laposta lists
- **Parent deduplication**: Handles parent/child member associations
- **Photo sync**: Downloads member photos from Sportlink and uploads to Stadion
- **Team sync**: Extracts teams from Sportlink and syncs to Stadion with work history linking
- **Nikki integration**: Downloads contribution data and updates Stadion member ACF fields
- **FreeScout customer sync**: Syncs Stadion members to FreeScout helpdesk as customers
- **Email reports**: HTML-formatted sync summaries delivered via Postmark
- **Summary output**: Clean, email-friendly sync reports

## Quick Reference

```bash
# Individual sync pipelines (recommended)
scripts/sync.sh people    # 4x daily sync: members, photos → Laposta + Stadion
scripts/sync.sh photos    # Alias for people (photos integrated)
scripts/sync.sh nikki     # Daily sync: Nikki contributions → Stadion
scripts/sync.sh teams     # Weekly sync: team extraction + work history
scripts/sync.sh functions # Weekly sync: commissies + work history

# Full sync (all pipelines)
scripts/sync.sh all       # Run all syncs sequentially (includes FreeScout)
npm run sync-all          # Alternative to sync.sh all

# Automated scheduling
npm run install-cron      # Set up automated sync schedules with email reports
```

## Architecture

### Sync Pipelines

The sync is split into four independent pipelines, each with its own schedule:

**1. People Pipeline (4x daily via scripts/sync.sh people):**
- download-data-from-sportlink.js - Browser automation downloads member data (includes photo URLs)
- prepare-laposta-members.js - Transforms Sportlink fields for Laposta
- submit-laposta-list.js - Syncs to Laposta via API (hash-based change detection)
- submit-stadion-sync.js - Syncs members to Stadion WordPress
- sync-important-dates.js - Syncs birthdays to Stadion calendar
- download-photos-from-api.js - Downloads photos via HTTP (URL from MemberHeader API)
- upload-photos-to-stadion.js - Uploads photos to Stadion via REST API
- Produces email-ready HTML summary

**2. Nikki Pipeline (daily via scripts/sync.sh nikki):**
- download-nikki-contributions.js - Downloads contribution data from Nikki
- sync-nikki-to-stadion.js - Updates Stadion person ACF fields with contribution status
- Produces email-ready HTML summary

**3. Team Pipeline (weekly via scripts/sync.sh teams):**
- download-teams-from-sportlink.js - Extracts team data from Sportlink
- submit-stadion-teams.js - Creates/updates teams in Stadion
- submit-stadion-work-history.js - Links persons to teams via work_history
- Produces email-ready HTML summary

**4. Functions Pipeline (weekly via scripts/sync.sh functions):**
- download-functions-from-sportlink.js - Extracts commissie/function data
- submit-stadion-commissies.js - Creates/updates commissies in Stadion
- submit-stadion-commissie-work-history.js - Links persons to commissies
- Produces email-ready HTML summary

**Full Sync (scripts/sync.sh all or npm run sync-all):**
Runs all four pipelines sequentially plus FreeScout customer sync. Used for manual full syncs or initial setup.

### Data Flow

Four independent pipelines running on different schedules:

```
People Pipeline (4x daily):
Sportlink Club → SQLite → Laposta API (hash-based diff)
                       ↓
              Stadion WordPress API (members)
                       ↓
              Stadion Calendar API (birthdays)
                       ↓
              Photo URLs → downloads/ → Stadion WordPress API (media)
                       ↓
              Email report (Postmark)

Nikki Pipeline (daily):
Nikki API → nikki-sync.sqlite → Stadion WordPress API (ACF fields)
                              ↓
                     Email report (Postmark)

Team Pipeline (weekly):
Sportlink members → team extraction → Stadion Teams API
                                   ↓
                        Stadion work_history field
                                   ↓
                        Email report (Postmark)

Functions Pipeline (weekly):
Sportlink members → function extraction → Stadion Commissies API
                                       ↓
                           Stadion work_history field
                                       ↓
                           Email report (Postmark)

FreeScout Pipeline (runs with full sync):
Stadion members → freescout-sync.sqlite → FreeScout API (customers)
```

### Supporting Files

- `lib/logger.js` - Dual-stream logger (stdout + date-based files in `logs/`)
- `laposta-db.js` - SQLite operations for state tracking and change detection
- `field-mapping.json` - Configurable Sportlink → Laposta field transformations
- `scripts/sync.sh` - Unified sync wrapper with flock locking and email delivery
- `scripts/install-cron.sh` - Interactive cron setup with credential prompts
- `scripts/send-email.js` - Postmark email delivery for sync reports

### Shared Utility Modules

Common functionality is consolidated in `lib/`:

- `lib/utils.js` - General utilities (hashing, formatting, env reading)
- `lib/sportlink-login.js` - Sportlink authentication with TOTP 2FA
- `lib/log-adapters.js` - Logger adapters for consistent logging patterns
- `lib/http-client.js` - HTTP request utilities with timeout and error handling

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

# FreeScout (optional)
FREESCOUT_API_KEY=        # FreeScout API key
FREESCOUT_URL=            # FreeScout instance URL

# Nikki (optional)
NIKKI_API_KEY=            # Nikki API key
NIKKI_URL=                # Nikki API URL

# Optional
DEBUG_LOG=false
```

## Usage

### Running syncs

**Individual pipelines (recommended for production):**

```bash
scripts/sync.sh people    # 4x daily: members, parents, birthdays, photos
scripts/sync.sh photos    # Alias for people (backwards compatible)
scripts/sync.sh teams     # Weekly: team sync + work history
scripts/sync.sh functions # Weekly: commissies + work history
```

**Full sync (all pipelines):**

```bash
scripts/sync.sh all       # Runs all four pipelines sequentially
npm run sync-all          # Alternative (same behavior)
npm run sync-all-verbose  # With detailed per-member logging
```

Each sync produces an HTML email report sent via Postmark to OPERATOR_EMAIL.

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

Photos are now integrated into the people pipeline and sync 4x daily. For backwards compatibility:

```bash
npm run download-photos           # Download photos via API (runs download-photos-from-api.js)
npm run download-photos-verbose   # Same with detailed logging
npm run sync-photos               # Runs full people sync (photos included)
npm run sync-photos-verbose       # Same with detailed logging
```

Photo sync:
- Downloads member photos via HTTP using URLs from MemberHeader API
- Uses Photo.PhotoDate for change detection (more reliable than PersonImageDate)
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

## Automated sync schedules

Set up automated cron jobs with staggered schedules:

```bash
npm run install-cron
```

This will:
- Prompt for your operator email address and Postmark credentials
- Install four crontab entries with different schedules:
  - **People sync:** 4x daily (members, parents, birthdays, photos)
  - **Nikki sync:** Daily at 7:00 AM Amsterdam time
  - **Team sync:** Weekly on Sunday at 6:00 AM
  - **Functions sync:** Weekly on Sunday at 7:00 AM (after teams)
- Send HTML email reports via Postmark after each sync
- Use flock to prevent overlapping executions (per sync type)

To verify installation:

```bash
crontab -l
```

To view logs:

```bash
ls -la logs/cron/
```

### Email reports

After each sync (manual or cron), an HTML email report is sent via Postmark containing:
- Sync summary (Laposta + Stadion)
- Members added/updated/deleted
- Error details if any occurred
- Execution duration

## Database

Four SQLite databases track sync state (on the server only):

**`laposta-sync.sqlite`** - Laposta sync tracking:
- Member hashes for change detection
- Sync state per list
- Last sync timestamps
- Member data for Stadion sync
- Photo state and PersonImageDate for change detection
- Team assignments and work history indices

**`stadion-sync.sqlite`** - Stadion WordPress sync tracking:
- `stadion_members` - Maps `knvb_id` → `stadion_id` (WordPress post ID)
- `stadion_parents` - Maps parent `email` → `stadion_id`
- `stadion_teams`, `stadion_commissies` - Team/committee mappings
- `stadion_work_history` - Team membership history

**`freescout-sync.sqlite`** - FreeScout customer sync tracking:
- Maps `knvb_id` → `freescout_id` (FreeScout customer ID)
- Tracks sync state and last update times
- Supports hash-based change detection

**`nikki-sync.sqlite`** - Nikki contribution sync tracking:
- Contribution data from Nikki
- Sync state for Stadion ACF field updates
- Last sync timestamps

The database mappings (especially `stadion_id`) are critical: without them, sync creates new entries instead of updating existing ones.

## Development

### Debug individual steps

```bash
npm run download         # Just download from Sportlink
npm run prepare-laposta  # Just prepare members
npm run sync-laposta     # Just submit to Laposta
npm run sync-stadion     # Just submit to Stadion
npm run download-photos  # Download photos via API
npm run upload-photos    # Upload photos to Stadion
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
