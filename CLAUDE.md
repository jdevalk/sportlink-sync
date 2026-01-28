# Sportlink Sync

CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists and Stadion WordPress.

## Quick Reference

```bash
npm run sync-all          # Full sync pipeline (Sportlink → Laposta + Stadion)
npm run sync-all-verbose  # Same with detailed logging
npm run install-cron      # Set up automated daily sync with email reports
```

## Architecture

### Sync Pipeline

1. **download-data-from-sportlink.js** - Browser automation downloads member values to SQLite
2. **prepare-laposta-members.js** - Transforms Sportlink fields for Laposta
3. **submit-laposta-list.js** - Syncs to Laposta via API (hash-based change detection, reads from SQLite)
4. **submit-stadion-sync.js** - Syncs to Stadion WordPress (reads from SQLite)
5. **sync-all.js** - Orchestrates full pipeline, produces email-ready summary

### Supporting Files

- `lib/logger.js` - Dual-stream logger (stdout + date-based files in `logs/`)
- `laposta-db.js` - SQLite operations for state tracking and change detection
- `field-mapping.json` - Configurable Sportlink → Laposta field transformations
- `scripts/cron-wrapper.sh` - Cron execution with flock locking and email delivery
- `scripts/install-cron.sh` - Interactive cron setup with credential prompts
- `scripts/send-email.js` - Postmark email delivery for sync reports

### Data Flow

```
Sportlink Club (browser) → JSON download → SQLite (state) → Laposta API
                                      ↓
                              Hash-based diff
                                      ↓
                           Only changed members sync
                                      ↓
                              Stadion WordPress API
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

# Stadion WordPress
STADION_URL=              # WordPress site URL (https://...)
STADION_USERNAME=         # WordPress username
STADION_APP_PASSWORD=     # Application password (from WordPress profile)
STADION_PERSON_TYPE=      # Custom post type (default: person)

# Email delivery
OPERATOR_EMAIL=           # Receives sync reports
POSTMARK_API_KEY=         # Postmark server API token
POSTMARK_FROM_EMAIL=      # Verified sender address
```

## Remote server
When checking current data, you can connect as root to the live sync server over SSH. It's details:

IP: 46.202.155.16
Remote path: /home/sportlink/

You can login with the user's key. Get new code to the server by committing to GitHub and doing a `git pull` on the remote server in the `/home/sportlink/` directory.

## CRITICAL: Never Run Sync Locally

**Sync scripts must only run on the production server.** Running sync from a local machine causes duplicate entries in Stadion because:

1. Each machine has its own SQLite database tracking `stadion_id` mappings
2. Local database doesn't know about entries created by server syncs
3. Local sync creates NEW WordPress entries instead of updating existing ones
4. Result: hundreds of duplicate members in Stadion

The sync scripts (`sync-all.js`, `sync-people.js`) enforce this with a server check that blocks local execution. If you see:
```
ERROR: Cannot run sync from local machine
```

This is intentional. Always sync from the server:
```bash
ssh root@46.202.155.16
cd /home/sportlink
npm run sync-all
```

If duplicates occur, use `scripts/delete-duplicates.js` to clean up (keeps oldest entry per KNVB ID).

## Database

Two SQLite databases track sync state (on the server only):

**`laposta-sync.sqlite`** - Laposta sync tracking:
- Member hashes for change detection
- Sync state per list
- Last sync timestamps

**`stadion-sync.sqlite`** - Stadion WordPress sync tracking:
- `stadion_members` - Maps `knvb_id` → `stadion_id` (WordPress post ID)
- `stadion_parents` - Maps parent `email` → `stadion_id`
- `stadion_teams`, `stadion_commissies` - Team/committee mappings
- `stadion_work_history` - Team membership history

The `stadion_id` mapping is critical: without it, sync creates new entries instead of updating existing ones.

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

## Related Documentation

Stadion API documentation is at `~/Code/stadion/docs/`. Key files:
- `api-leden-crud.md` - Person API (fields, work_history, relationships)
- `api-teams.md` - Team API
- `api-commissies.md` - Commissies API
- `api-custom-fields.md` - Custom field definitions
- `rest-api.md` - Full REST API docs, including important dates, used for birthdates
- `data-model.md` - Data model overview

Always check these docs for correct field names and formats before guessing.

## Tech Stack

- Node.js 18+
- Playwright (Chromium for browser automation)
- better-sqlite3 (state tracking)
- otplib (TOTP generation)
- postmark (email delivery)
- varlock (env loading)
