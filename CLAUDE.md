# Sportlink Sync

CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists and Stadion WordPress.

## Quick Reference

```bash
# Sync commands (via unified wrapper)
scripts/sync.sh people    # 4x daily: members, parents, birthdays, photos
scripts/sync.sh photos    # Alias for people (photos integrated)
scripts/sync.sh nikki     # Daily: Nikki contributions to Stadion
scripts/sync.sh freescout # Daily: FreeScout customer sync
scripts/sync.sh teams     # Weekly: team sync + work history
scripts/sync.sh functions # Weekly: commissies + work history
scripts/sync.sh all       # Full sync (all pipelines)

# Alternative: npm scripts
npm run sync-people       # Same as scripts/sync.sh people
npm run sync-photos       # Same as sync-people (backwards compatible)
npm run sync-nikki        # Same as scripts/sync.sh nikki
npm run sync-freescout    # Same as scripts/sync.sh freescout
npm run sync-teams        # Same as scripts/sync.sh teams
npm run sync-functions    # Same as scripts/sync.sh functions
npm run sync-all          # Full sync (all pipelines)

# Setup
npm run install-cron      # Set up automated sync schedules with email reports
```

## Architecture

### Sync Architecture

The sync is split into four independent pipelines, each with its own schedule:

**1. People Pipeline (4x daily via sync-people.js):**
- download-data-from-sportlink.js - Browser automation downloads member data (includes photo URLs)
- prepare-laposta-members.js - Transforms Sportlink fields for Laposta
- submit-laposta-list.js - Syncs to Laposta via API (hash-based change detection)
- submit-stadion-sync.js - Syncs members to Stadion WordPress
- sync-important-dates.js - Syncs birthdays to Stadion calendar
- download-photos-from-api.js - Downloads photos via HTTP (URL from MemberHeader API)
- upload-photos-to-stadion.js - Uploads photos to Stadion via REST API

**2. Nikki Pipeline (daily via sync-nikki.js):**
- download-nikki-contributions.js - Downloads contribution data from Nikki
- sync-nikki-to-stadion.js - Updates Stadion person ACF fields with contribution status
- Produces email-ready HTML summary

**3. Team Pipeline (weekly via sync-teams.js):**
- download-teams-from-sportlink.js - Extracts team data from Sportlink
- submit-stadion-teams.js - Creates/updates teams in Stadion
- submit-stadion-work-history.js - Links persons to teams via work_history

**4. Functions Pipeline (weekly via sync-functions.js):**
- download-functions-from-sportlink.js - Extracts commissie/function data
- submit-stadion-commissies.js - Creates/updates commissies in Stadion
- submit-stadion-commissie-work-history.js - Links persons to commissies

**5. FreeScout Pipeline (daily via sync-freescout.js):**
- submit-freescout-sync.js - Syncs Stadion members to FreeScout customers

**Full Sync (sync-all.js):**
Runs all five pipelines sequentially. Used for manual full syncs or initial setup.

### Supporting Files

- `lib/logger.js` - Dual-stream logger (stdout + date-based files in `logs/`)
- `laposta-db.js` - SQLite operations for state tracking and change detection
- `field-mapping.json` - Configurable Sportlink → Laposta field transformations
- `scripts/sync.sh` - Unified sync wrapper with flock locking and email delivery
- `scripts/install-cron.sh` - Interactive cron setup with credential prompts
- `scripts/send-email.js` - Postmark email delivery for sync reports

### Shared Utility Modules

Common functionality is consolidated in `lib/` to avoid duplication:

- **`lib/utils.js`** - General utilities used across scripts:
  - `stableStringify(value)` - Deterministic JSON serialization for hash computation
  - `computeHash(data)` - SHA-256 hash computation
  - `formatDuration(ms)` - Human-readable duration (e.g., "2m 30s")
  - `formatTimestamp(date)` - Timestamp formatting for display
  - `nowISO()` - Current ISO timestamp
  - `readEnv(name, fallback)` - Environment variable reading with fallback
  - `parseBool(value, fallback)` - Boolean parsing from strings

- **`lib/sportlink-login.js`** - Sportlink authentication:
  - `loginToSportlink(page, options)` - Complete login flow with TOTP 2FA
  - Reads credentials from env vars or accepts them via options
  - Used by all download-*-from-sportlink.js scripts

- **`lib/log-adapters.js`** - Logger adapters for consistent logging:
  - `createLoggerAdapter({ logger, verbose })` - Creates log/verbose/error functions
  - `createDebugLogger()` - Debug logger based on DEBUG_LOG env var
  - `isDebugEnabled()` - Check if debug logging is enabled

- **`lib/http-client.js`** - HTTP request utilities:
  - `makeRequest(config)` - Generic HTTP with timeout, JSON parsing, error handling
  - `createBasicAuthHeader(username, password)` - Basic Auth header creation
  - Used by stadion-client.js and freescout-client.js

### Data Flow

Four parallel pipelines:

```
People (4x daily):
Sportlink Club → SQLite → Laposta API (hash-based diff)
                       ↓
              Stadion WordPress API (members)
                       ↓
              Stadion Calendar API (birthdays)
                       ↓
              Photo URLs → downloads/ → Stadion WordPress API (media upload)

Nikki (daily):
Nikki API → nikki-sync.sqlite → Stadion WordPress API (ACF fields)

Teams (weekly):
Sportlink members → team extraction → Stadion Teams API
                                   ↓
                        Stadion work_history field

Functions (weekly):
Sportlink members → function extraction → Stadion Commissies API
                                       ↓
                           Stadion work_history field

FreeScout (daily):
Stadion members → freescout-sync.sqlite → FreeScout API (customers)
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

# FreeScout (optional)
FREESCOUT_API_KEY=        # FreeScout API key
FREESCOUT_URL=            # FreeScout instance URL

# Nikki (optional)
NIKKI_API_KEY=            # Nikki API key
NIKKI_URL=                # Nikki API URL
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

The sync scripts (`sync-all.js`, `sync-people.js`, etc.) enforce this with a server check that blocks local execution. If you see:
```
ERROR: Cannot run sync from local machine
```

This is intentional. Always sync from the server:
```bash
ssh root@46.202.155.16
cd /home/sportlink
scripts/sync.sh people    # or photos, teams, functions, all
```

If duplicates occur, use `scripts/delete-duplicates.js` to clean up (keeps oldest entry per KNVB ID).

## Database

Four SQLite databases track sync state (on the server only):

**`laposta-sync.sqlite`** - Laposta sync tracking:
- Member hashes for change detection
- Sync state per list
- Last sync timestamps

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

The `stadion_id` mapping is critical: without it, sync creates new entries instead of updating existing ones.

## Cron Automation

After `npm run install-cron`, six sync schedules are configured:

- **People sync:** 4x daily at 8am, 11am, 2pm, 5pm (members, parents, birthdays, photos)
- **Nikki sync:** Daily at 7:00 AM Amsterdam time
- **FreeScout sync:** Daily at 8:00 AM Amsterdam time
- **Team sync:** Weekly on Sunday at 6:00 AM
- **Functions sync:** Daily at 7:15 AM (after Nikki sync)

Each sync:
- Runs via scripts/sync.sh wrapper
- Sends email report via Postmark after completion
- Uses flock to prevent overlapping executions (per sync type)
- Logs to logs/cron/sync-{type}-{timestamp}.log

## Documentation Maintenance

**After making any functional change, update documentation:**
- README.md - User-facing docs (features, usage, setup)
- CLAUDE.md - AI assistant instructions (architecture, patterns, gotchas)

Both files should stay in sync. Changes to add:
- New sync pipelines or scripts
- New environment variables
- New database tables or files
- New API integrations
- Cron schedule changes
- Important gotchas discovered

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

# Run individual pipelines
scripts/sync.sh people    # People sync (hourly, includes photos)
scripts/sync.sh photos    # Alias for people (backwards compatible)
scripts/sync.sh teams     # Team sync (weekly)
scripts/sync.sh functions # Functions sync (daily)
scripts/sync.sh all       # Full sync (all pipelines)

# Debug individual steps within people pipeline
npm run download         # Just download from Sportlink
npm run prepare-laposta  # Just prepare members
npm run sync-laposta     # Just submit to Laposta
npm run sync-stadion     # Just submit to Stadion

# Inspect data
npm run show-laposta-changes    # Pending changes
npm run show-laposta-member     # Single member lookup
npm run show-sportlink-member   # Sportlink data lookup
```

## Stadion API Gotchas

### Required Fields on ACF Updates

When updating a person's ACF fields via PUT request, **`first_name` and `last_name` are always required**, even if you're only updating a single field like `nikki-contributie-status`.

```javascript
// WRONG - will return 400 error
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: { 'nikki-contributie-status': html }
});

// CORRECT - include required fields
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: {
    first_name: existingFirstName,
    last_name: existingLastName,
    'nikki-contributie-status': html
  }
});
```

This means partial ACF updates require a GET request first to fetch the existing required fields.

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
