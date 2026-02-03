# Phase 32: Pipeline Integration - Research

**Researched:** 2026-02-03
**Domain:** Node.js sync pipeline automation and cron integration
**Confidence:** HIGH

## Summary

Phase 32 integrates discipline case sync into the existing automation infrastructure by adding a new weekly sync pipeline. The codebase has a well-established pattern for sync pipelines, with five existing examples (people, teams, functions, nikki, freescout) that provide clear templates.

The sync infrastructure consists of three components: a unified shell wrapper (`scripts/sync.sh`) with flock-based locking, pipeline orchestrator scripts (`sync-*.js`) that aggregate multiple steps, and cron automation with email reporting via Postmark. All patterns are already proven in production.

**Primary recommendation:** Follow the sync-teams.js and sync-functions.js patterns exactly — they provide the complete template for weekly sync pipelines with download + sync + report generation.

## Standard Stack

The established libraries/tools for sync pipeline automation:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | latest | State tracking and change detection | Used by all sync pipelines for tracking stadion_id mappings |
| varlock | latest | Environment variable loading | Standard across all scripts |
| Node.js 18+ | 18+ | Runtime environment | Server standard |
| Postmark | ^4.0.5 | Email delivery for reports | Configured for all sync pipelines |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| flock (bash) | Prevents concurrent syncs | Every sync.sh invocation |
| cron | Scheduled execution | All automated syncs |

**Installation:**
All dependencies already installed (Phase 31 added discipline DB support).

## Architecture Patterns

### Recommended Project Structure

Discipline sync already has the building blocks from Phase 31:
```
├── download-discipline-cases.js       # Step 1: Download from Sportlink
├── submit-stadion-discipline.js       # Step 2: Sync to Stadion
├── lib/discipline-db.js               # State tracking
└── [NEW] sync-discipline.js           # Pipeline orchestrator (Phase 32)
```

### Pattern 1: Pipeline Orchestrator Script

**What:** Top-level script that sequences multiple steps (download → sync) and aggregates statistics.

**When to use:** Every sync pipeline that combines multiple operations.

**Example from sync-teams.js:**
```javascript
// Source: /Users/joostdevalk/Code/sportlink-sync/sync-teams.js
const { createSyncLogger } = require('./lib/logger');
const { runTeamDownload } = require('./download-teams-from-sportlink');
const { runSync: runTeamSync } = require('./submit-stadion-teams');
const { runSync: runWorkHistorySync } = require('./submit-stadion-work-history');

async function runTeamsSync(options = {}) {
  const { verbose = false, force = false } = options;
  const logger = createSyncLogger({ verbose, prefix: 'teams' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: { teamCount: 0, memberCount: 0, errors: [] },
    teams: { total: 0, synced: 0, created: 0, updated: 0, skipped: 0, errors: [] },
    workHistory: { total: 0, synced: 0, created: 0, ended: 0, skipped: 0, errors: [] }
  };

  try {
    // Step 1: Download
    const teamDownloadResult = await runTeamDownload({ logger, verbose });
    stats.download.teamCount = teamDownloadResult.teamCount || 0;

    // Step 2: Sync
    const teamResult = await runTeamSync({ logger, verbose, force });
    stats.teams = { ...teamResult };

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return { success: stats.errors.length === 0, stats };
  } catch (err) {
    // Error handling
  }
}

module.exports = { runTeamsSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runTeamsSync({ verbose, force })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    });
}
```

**Key elements:**
1. **Module/CLI hybrid:** Export function AND work as standalone script
2. **Stats aggregation:** Collect statistics from each step
3. **Error resilience:** Continue even if non-critical steps fail
4. **Logger prefix:** Enables per-pipeline log files (`logs/sync-discipline-2026-02-03.log`)
5. **Return structure:** `{ success: boolean, stats: Object, error?: string }`

### Pattern 2: Summary Report Format

**What:** Structured text output designed for email HTML conversion.

**When to use:** End of every pipeline orchestrator script.

**Example structure:**
```javascript
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('DISCIPLINE SYNC SUMMARY');  // Matches regex in send-email.js
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('DISCIPLINE DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Cases downloaded: ${stats.download.caseCount}`);
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  logger.log(`Cases synced: ${stats.sync.synced}/${stats.sync.total}`);
  logger.log(`  Created: ${stats.sync.created}`);
  logger.log(`  Updated: ${stats.sync.updated}`);
  logger.log(`  Skipped: ${stats.sync.skipped} (unchanged)`);
  logger.log('');

  // Errors section (if any)
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.dossier_id || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}
```

**HTML conversion rules (from send-email.js):**
- `========` dividers → Skip (CSS handles section styling)
- `TITLE SYNC SUMMARY` → `<h1>` (must match regex: `/^[A-Z][A-Z\s-]+ SYNC SUMMARY$/`)
- `ALL CAPS SECTIONS` → `<h2>` (e.g., "DISCIPLINE DOWNLOAD")
- `Key: value` lines → `<p><strong>Key:</strong> value</p>`
- `- List items` → `<ul><li>`
- `Log file: path` → `<p class="log-path">` (muted gray)

### Pattern 3: Unified Sync Wrapper (scripts/sync.sh)

**What:** Bash wrapper that handles locking, logging, and email delivery.

**When to use:** Every sync command invoked by cron or manually.

**Structure:**
```bash
# scripts/sync.sh discipline

# Validates sync type
case "$SYNC_TYPE" in
    discipline)
        SYNC_SCRIPT="sync-discipline.js"
        ;;
esac

# Flock-based locking (per sync type)
LOCKFILE="$PROJECT_DIR/.sync-${SYNC_TYPE}.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "Another $SYNC_TYPE sync is running. Exiting." >&2
    exit 1
fi

# Run with logging
node "$PROJECT_DIR/$SYNC_SCRIPT" 2>&1 | tee -a "$LOG_FILE"

# Send email report (if configured)
if [ -n "$POSTMARK_API_KEY" ]; then
    node "$PROJECT_DIR/scripts/send-email.js" "$LOG_FILE" "$SYNC_TYPE"
fi
```

**Benefits:**
- **Prevents overlaps:** Flock lock per sync type (people + discipline can run concurrently)
- **Automatic logging:** All output to `logs/cron/sync-discipline-YYYY-MM-DD_HH-MM-SS.log`
- **Email delivery:** Automatic HTML email to `OPERATOR_EMAIL` via Postmark
- **Error propagation:** Exit code from Node.js script passed through

### Pattern 4: Cron Configuration

**What:** Time-based trigger for automated syncs.

**When to use:** All recurring syncs.

**Configuration (install-cron.sh):**
```bash
# Discipline sync: weekly on Monday at 11:30 PM
30 23 * * 1 /path/to/sync.sh discipline
```

**Best practices:**
- **CRON_TZ:** Set to `Europe/Amsterdam` at top of crontab
- **Single-line entries:** Each sync gets one cron line
- **Absolute paths:** Full path to sync.sh (resolved in install-cron.sh)
- **Non-overlapping times:** Avoid conflicts with other syncs

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrent sync prevention | Custom PID files, database flags | flock (bash builtin) | Race-condition free, auto-cleanup on crash |
| Email HTML formatting | Manual HTML generation | send-email.js formatAsHtml() | Proven parser for sync output format |
| Log file management | Custom rotation logic | Logger module with date-based files | Already handles streams, timestamps, cleanup |
| Stats aggregation | Ad-hoc object building | Follow stats pattern from sync-teams.js | Consistent structure expected by email formatter |
| Cron installation | Manual crontab editing | install-cron.sh interactive script | Validates credentials, removes old entries, sets timezone |

**Key insight:** The sync infrastructure is a complete system. Each component depends on specific output formats from others (e.g., email formatter expects specific divider patterns). Don't deviate from established patterns.

## Common Pitfalls

### Pitfall 1: Email Summary Title Mismatch

**What goes wrong:** Email report shows "DISCIPLINE SYNC SUMMARY" but send-email.js doesn't recognize it as a title, breaking HTML formatting.

**Why it happens:** send-email.js has a hardcoded regex for sync summary titles:
```javascript
if (/^(SPORTLINK|PEOPLE|PHOTO|TEAM) SYNC SUMMARY$/.test(trimmed)) {
```

**How to avoid:**
- **Option A (recommended):** Add "DISCIPLINE" to the regex in send-email.js
- **Option B:** Use generic "SYNC SUMMARY" (but inconsistent with other pipelines)

**Warning signs:** Email report shows discipline summary as plain text instead of formatted sections.

### Pitfall 2: Missing sync.sh Case Statement

**What goes wrong:** `scripts/sync.sh discipline` fails with "Invalid sync type" error.

**Why it happens:** sync.sh validates sync type against hardcoded case statement (lines 39-46).

**How to avoid:** Add discipline to the validation list AND the script mapping:
```bash
# Line 40: Validation
case "$SYNC_TYPE" in
    people|photos|teams|functions|nikki|freescout|reverse|discipline|all)
        ;;

# Line 80: Script mapping
case "$SYNC_TYPE" in
    discipline)
        SYNC_SCRIPT="sync-discipline.js"
        ;;
```

**Warning signs:** Error message "Usage: sync.sh {people|teams|...}" appears when running `sync.sh discipline`.

### Pitfall 3: Wrong Logger Prefix

**What goes wrong:** Log file created as `logs/sync-2026-02-03.log` instead of `logs/sync-discipline-2026-02-03.log`, making it impossible to distinguish from other syncs.

**Why it happens:** Logger prefix parameter not passed or incorrect:
```javascript
// WRONG
const logger = createSyncLogger({ verbose });

// CORRECT
const logger = createSyncLogger({ verbose, prefix: 'discipline' });
```

**How to avoid:** Always pass `prefix` parameter matching the sync type. Check logger.getLogPath() output in summary.

**Warning signs:** Multiple syncs writing to same log file, log file doesn't include sync type in filename.

### Pitfall 4: Stats Object Structure Mismatch

**What goes wrong:** Pipeline returns stats object but email summary looks broken or incomplete.

**Why it happens:** Each pipeline has its own stats structure, but certain fields are expected by printSummary:
- `completedAt` (ISO 8601 string)
- `duration` (formatted as "2m 34s")
- Section-specific nested objects (download, sync, etc.)
- `errors` arrays with consistent structure

**How to avoid:** Follow the stats pattern from sync-teams.js exactly:
```javascript
const stats = {
  completedAt: '',
  duration: '',
  download: { /* step-specific fields */, errors: [] },
  sync: { /* step-specific fields */, errors: [] }
};
```

**Warning signs:** Email report missing duration, errors shown without context, sync steps not appearing in summary.

### Pitfall 5: Cron Timing Conflicts

**What goes wrong:** Discipline sync scheduled at same time as another sync that uses shared resources (Sportlink login, database writes).

**Why it happens:** Not checking existing cron schedules before choosing time.

**How to avoid:**
1. Review install-cron.sh to see existing schedules
2. Avoid times used by people sync (8:00, 11:00, 14:00, 17:00)
3. Avoid times used by nikki/functions (7:00, 7:15 AM)
4. Avoid times used by teams (6:00 AM Sunday)
5. Space syncs at least 15 minutes apart

**User decision:** Monday 11:00 PM - 1:00 AM range (late night, after weekend match processing).

**Warning signs:** Sync timeouts, database lock errors, Sportlink login failures.

## Code Examples

Verified patterns from existing sync pipelines.

### Example 1: Complete Pipeline Orchestrator

```javascript
// Source: Adapted from sync-teams.js pattern
require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { runDownload } = require('./download-discipline-cases');
const { runSync: runDisciplineSync } = require('./submit-stadion-discipline');

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('DISCIPLINE SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('DISCIPLINE DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Cases downloaded: ${stats.download.caseCount}`);
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  if (stats.sync.total > 0) {
    logger.log(`Cases synced: ${stats.sync.synced}/${stats.sync.total}`);
    if (stats.sync.created > 0) {
      logger.log(`  Created: ${stats.sync.created}`);
    }
    if (stats.sync.updated > 0) {
      logger.log(`  Updated: ${stats.sync.updated}`);
    }
    if (stats.sync.skipped > 0) {
      logger.log(`  Skipped: ${stats.sync.skipped} (unchanged)`);
    }
    if (stats.sync.linked > 0) {
      logger.log(`  Linked to persons: ${stats.sync.linked}`);
    }
  } else {
    logger.log('Cases synced: 0 changes');
  }
  logger.log('');

  const allErrors = [
    ...stats.download.errors,
    ...stats.sync.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.dossier_id || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

async function runDisciplineSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'discipline' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      caseCount: 0,
      errors: []
    },
    sync: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      linked: 0,
      errors: []
    }
  };

  try {
    // Step 1: Download discipline cases from Sportlink
    logger.verbose('Downloading discipline cases from Sportlink...');
    try {
      const downloadResult = await runDownload({ logger, verbose });
      stats.download.caseCount = downloadResult.caseCount || 0;
      if (!downloadResult.success) {
        stats.download.errors.push({
          message: downloadResult.error || 'Unknown error',
          system: 'discipline-download'
        });
      }
    } catch (err) {
      logger.error(`Discipline download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Discipline download failed: ${err.message}`,
        system: 'discipline-download'
      });
    }

    // Step 2: Sync cases to Stadion
    logger.verbose('Syncing discipline cases to Stadion...');
    try {
      const syncResult = await runDisciplineSync({ logger, verbose, force });
      stats.sync.total = syncResult.total;
      stats.sync.synced = syncResult.synced;
      stats.sync.created = syncResult.created;
      stats.sync.updated = syncResult.updated;
      stats.sync.skipped = syncResult.skipped;
      stats.sync.linked = syncResult.linked;
      if (syncResult.errors?.length > 0) {
        stats.sync.errors = syncResult.errors.map(e => ({
          dossier_id: e.dossier_id,
          message: e.message,
          system: 'discipline-sync'
        }));
      }
    } catch (err) {
      logger.error(`Discipline sync failed: ${err.message}`);
      stats.sync.errors.push({
        message: `Discipline sync failed: ${err.message}`,
        system: 'discipline-sync'
      });
    }

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.download.errors.length === 0 &&
               stats.sync.errors.length === 0,
      stats
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);
    printSummary(logger, stats);

    logger.close();

    return { success: false, stats, error: errorMsg };
  }
}

module.exports = { runDisciplineSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runDisciplineSync({ verbose, force })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
```

### Example 2: Cron Installation Update

```bash
# Source: Adapted from install-cron.sh pattern

CRON_ENTRIES="
# Sportlink Sync automation (installed $(date +%Y-%m-%d))
CRON_TZ=Europe/Amsterdam

# People sync: 4x daily during work hours
0 8,11,14,17 * * * $PROJECT_DIR/scripts/sync.sh people

# Nikki sync: daily at 7:00 AM
0 7 * * * $PROJECT_DIR/scripts/sync.sh nikki

# FreeScout sync: daily at 8:00 AM
0 8 * * * $PROJECT_DIR/scripts/sync.sh freescout

# Team sync: weekly on Sunday at 6:00 AM
0 6 * * 0 $PROJECT_DIR/scripts/sync.sh teams

# Functions sync: daily at 7:15 AM
15 7 * * * $PROJECT_DIR/scripts/sync.sh functions

# Discipline sync: weekly on Monday at 11:30 PM
30 23 * * 1 $PROJECT_DIR/scripts/sync.sh discipline

# Reverse sync: every 15 minutes
*/15 * * * * $PROJECT_DIR/scripts/sync.sh reverse
"
```

### Example 3: sync.sh Case Statement Update

```bash
# Source: scripts/sync.sh lines 39-107

# Validate sync type
case "$SYNC_TYPE" in
    people|photos|teams|functions|nikki|freescout|reverse|discipline|all)
        ;;
    *)
        echo "Usage: $0 {people|photos|teams|functions|nikki|freescout|reverse|discipline|all}" >&2
        exit 1
        ;;
esac

# Later, determine which script to run
case "$SYNC_TYPE" in
    people)
        SYNC_SCRIPT="sync-people.js"
        ;;
    teams)
        SYNC_SCRIPT="sync-teams.js"
        ;;
    discipline)
        SYNC_SCRIPT="sync-discipline.js"
        ;;
    all)
        SYNC_SCRIPT="sync-all.js"
        ;;
esac
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-sync shell scripts | Unified sync.sh wrapper | Phase 17 (2025) | Single wrapper handles all sync types, reduces duplication |
| Manual cron editing | install-cron.sh interactive | Phase 9 (2024) | Validates credentials, handles Postmark setup, sets CRON_TZ |
| Text-only email reports | HTML-formatted reports | Phase 20 (2025) | Structured emails with semantic HTML from plain text logs |
| Global log files | Per-sync-type log files | Phase 13 (2024) | Logger prefix parameter enables `logs/sync-discipline-2026-02-03.log` |
| No sync locking | flock-based per-type locks | Phase 15 (2025) | Prevents overlaps per sync type while allowing different syncs concurrently |

**Deprecated/outdated:**
- None - current patterns are stable and proven in production

## Open Questions

Things that couldn't be fully resolved:

1. **Should discipline sync be included in sync-all.js?**
   - What we know: sync-all.js orchestrates all pipelines for manual full sync
   - What's unclear: Whether discipline cases should be part of "full sync" given their weekly cadence
   - Recommendation: Add to sync-all.js for completeness (operator may want full refresh), but keep weekly cron separate

2. **Exact cron time within 11 PM - 1 AM window**
   - What we know: Monday late night after weekend match processing, range is 11 PM - 1 AM
   - What's unclear: Specific minute to use
   - Recommendation: 11:30 PM (23:30) to avoid top/bottom of hour conflicts, leaves buffer before midnight

## Sources

### Primary (HIGH confidence)
- `/Users/joostdevalk/Code/sportlink-sync/sync-teams.js` - Weekly sync pipeline pattern
- `/Users/joostdevalk/Code/sportlink-sync/sync-functions.js` - Weekly sync pipeline pattern
- `/Users/joostdevalk/Code/sportlink-sync/sync-nikki.js` - Daily sync pipeline pattern
- `/Users/joostdevalk/Code/sportlink-sync/scripts/sync.sh` - Unified wrapper with flock and email
- `/Users/joostdevalk/Code/sportlink-sync/scripts/install-cron.sh` - Cron installation script
- `/Users/joostdevalk/Code/sportlink-sync/scripts/send-email.js` - Email formatter with HTML conversion
- `/Users/joostdevalk/Code/sportlink-sync/lib/logger.js` - Dual-stream logger module
- `/Users/joostdevalk/Code/sportlink-sync/sync-all.js` - Full sync orchestrator

### Secondary (MEDIUM confidence)
- Project README.md and CLAUDE.md - Documentation of sync patterns

### Tertiary (LOW confidence)
- None - all research based on existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in package.json, proven in production
- Architecture: HIGH - Five existing sync pipelines provide complete pattern templates
- Pitfalls: HIGH - Derived from existing code patterns and error handling

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable infrastructure, unlikely to change)
