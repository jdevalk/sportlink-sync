---
phase: 02-cron-automation
plan: 01
subsystem: automation
tags: [cron, shell, email, locking]

requires:
  - 01-summary-output

provides:
  - cron automation infrastructure
  - email reporting with custom subjects
  - execution locking
  - automatic retry mechanism

affects:
  - Phase 2 Plan 2 (email configuration)

tech-stack:
  added:
    - bash shell scripting
    - flock for process locking
    - mail command for email delivery
  patterns:
    - cron job wrapper pattern
    - lockfile-based mutual exclusion
    - environment variable sourcing

key-files:
  created:
    - scripts/cron-wrapper.sh
    - scripts/install-cron.sh
  modified:
    - package.json

decisions:
  - id: cron-timezone
    choice: Europe/Amsterdam
    rationale: Club operates in Amsterdam timezone
  - id: email-in-wrapper
    choice: Email delivery in wrapper script, not crontab MAILTO
    rationale: Enables custom subject lines per execution
  - id: retry-timing
    choice: 2-hour retry delay (8:00 AM after 6:00 AM failure)
    rationale: Gives time for transient issues to resolve
  - id: lockfile-location
    choice: .cron.lock in project root
    rationale: Shared location for both main and retry jobs

metrics:
  duration: 2 min
  completed: 2026-01-24
---

# Phase 02 Plan 01: Cron Automation Infrastructure Summary

**One-liner:** Shell wrapper with flock locking, environment setup, and email delivery for automated daily sync at 6:00 AM Amsterdam time.

## What Was Built

Created complete cron automation infrastructure with two executable shell scripts and npm integration:

1. **Cron Wrapper Script** (`scripts/cron-wrapper.sh`)
   - Flock-based locking prevents overlapping executions
   - Resolves project directory using dirname/pwd pattern
   - Creates logs/cron directory if needed
   - Sources .env file with set -a/set +a pattern
   - Sets PATH to include standard binary locations
   - Runs npm run sync-all with tee logging
   - Captures exit code via PIPESTATUS[0]
   - Touches /tmp/sportlink-sync-retry flag on failure
   - Sends email with custom subject if MAILTO is set
   - Exits with original sync exit code

2. **Cron Install Script** (`scripts/install-cron.sh`)
   - Checks for mail command availability with helpful error
   - Prompts for operator email address
   - Validates email is not empty
   - Builds crontab entries with Amsterdam timezone
   - Main job: 6:00 AM daily with flock wrapper
   - Retry job: 8:00 AM if retry flag exists
   - Installs via (crontab -l || true; echo) | crontab pattern
   - Prints success message with helpful commands

3. **NPM Script Integration**
   - Added `npm run install-cron` to package.json
   - Enables simple installation workflow

## Technical Implementation

**Locking Mechanism:**
```bash
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "Another instance is running. Exiting." >&2
    exit 1
fi
```

**Environment Loading:**
```bash
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi
```

**Exit Code Preservation:**
```bash
npm run sync-all 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}
```

**Email with Custom Subject:**
```bash
if [ -n "$MAILTO" ]; then
    SUBJECT="Sportlink Sync Report - $(date +%Y-%m-%d)"
    cat "$LOG_FILE" | mail -s "$SUBJECT" "$MAILTO"
fi
```

**Crontab Installation:**
```bash
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

(crontab -l 2>/dev/null || true; echo "$CRON_ENTRIES") | crontab -
```

## Decisions Made

1. **Timezone Configuration**
   - Set CRON_TZ and TZ to Europe/Amsterdam in crontab
   - Ensures consistent execution time regardless of system timezone
   - Club operates in Amsterdam timezone

2. **Email Delivery Strategy**
   - Email sent from wrapper script, not crontab MAILTO
   - Enables custom subject: "Sportlink Sync Report - YYYY-MM-DD"
   - Uses mail command with -s flag for subject
   - Only sends if MAILTO environment variable is set

3. **Retry Timing**
   - Main sync: 6:00 AM daily
   - Retry: 8:00 AM (2 hours after failure)
   - Flag file: /tmp/sportlink-sync-retry
   - Gives time for transient network/service issues to resolve

4. **Lockfile Location**
   - .cron.lock in project root
   - Shared between main and retry jobs
   - flock with -w 0 (no wait) for immediate failure if locked

5. **Logging Strategy**
   - Logs to logs/cron/sync-YYYY-MM-DD_HH-MM-SS.log
   - Uses tee to both display and log
   - Preserves exit code via PIPESTATUS[0]
   - Log file sent as email body

## Deviations from Plan

None - plan executed exactly as written.

## Testing Performed

**Syntax Validation:**
```bash
bash -n scripts/cron-wrapper.sh  # PASS
bash -n scripts/install-cron.sh  # PASS
```

**Permissions Verification:**
```bash
ls -la scripts/*.sh
# Both scripts: -rwxr-xr-x (executable)
```

**Logic Verification:**
- Wrapper has flock locking
- Wrapper sources .env with set -a/set +a
- Wrapper touches retry flag on failure
- Wrapper sends email with custom subject
- Installer checks for mail command
- Installer prompts for email
- Installer adds crontab entries

**NPM Integration:**
```bash
npm run install-cron --help  # Command recognized
```

## Files Modified

**Created:**
- `scripts/cron-wrapper.sh` (52 lines, executable)
- `scripts/install-cron.sh` (57 lines, executable)

**Modified:**
- `package.json` (added install-cron script)

## Commits

1. `ffd8212` - feat(02-01): create cron wrapper script
2. `289a04e` - feat(02-01): create cron install script
3. `1b9c59a` - feat(02-01): add npm script for cron installation

## Next Phase Readiness

**Ready for Phase 2 Plan 2:** Email configuration and testing.

**Prerequisites met:**
- Wrapper script handles email delivery
- MAILTO environment variable supported
- Custom subject line format established
- Logging infrastructure in place

**No blockers identified.**

## Usage Instructions

**Installation:**
```bash
npm run install-cron
# Prompts for operator email
# Installs crontab with:
#   - Daily sync at 6:00 AM Amsterdam time
#   - Retry at 8:00 AM on failure
```

**Verification:**
```bash
crontab -l  # View installed cron jobs
```

**Manual Testing:**
```bash
./scripts/cron-wrapper.sh  # Run wrapper directly
# Check logs/cron/ for log file
# Check email delivery (if MAILTO set in .env)
```

**Removal:**
```bash
crontab -r  # Remove all cron jobs (careful!)
# Or manually edit: crontab -e
```

## Metrics

- **Duration:** 2 minutes
- **Tasks completed:** 3/3
- **Files created:** 2
- **Files modified:** 1
- **Lines of code:** 109 shell script lines
- **Commits:** 3
