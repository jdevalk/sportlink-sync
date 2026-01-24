# Phase 2: Cron Automation - Research

**Researched:** 2026-01-24
**Domain:** Linux cron job automation for Node.js applications
**Confidence:** HIGH

## Summary

This phase implements daily automated execution of Node.js sync script using Linux cron with email reporting. The research focused on production-ready cron patterns for Node.js applications, lockfile-based concurrency prevention, email delivery via MAILTO, and retry mechanisms.

The standard approach for Node.js cron jobs in 2026 uses a shell wrapper script that handles environment setup (PATH, .env sourcing, working directory), implements flock-based locking to prevent overlaps, and pipes output to mail command for custom email subjects. Cron's built-in MAILTO provides reliable email delivery but cannot customize subjects, requiring the wrapper to handle email formatting.

**Primary recommendation:** Use shell wrapper script with flock locking, explicit environment setup, and mail command for subject customization. Implement retry logic as separate delayed cron entry rather than in-script loops.

## Standard Stack

The established tools for Linux cron automation:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cron | Built-in | Job scheduling | Standard Linux scheduler, runs 24/7, precise timing |
| flock | Built-in | File-based locking | Advisory locking prevents overlapping executions |
| mail/mailx | Built-in | Email delivery | Simple SMTP client for cron output, -s flag for subjects |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| logrotate | Built-in | Log rotation | Automatic cleanup of cron logs, runs daily via /etc/cron.daily |
| dotenv | latest | Environment variables | Already in project, loads .env for credentials |
| bash | 4.0+ | Shell scripting | Wrapper script for environment setup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cron | anacron | Only runs once/day, better for laptops; cron better for 24/7 servers |
| cron | node-cron | In-process scheduling, requires app running; cron is system-level |
| flock | PID files | More complex cleanup, race conditions; flock auto-releases on exit |
| mail | sendmail | More configuration required; mail is simpler for basic emails |

**Installation:**
Cron and flock are built-in to Linux. Mail command may need installation:
```bash
# Debian/Ubuntu
apt-get install mailutils

# RHEL/CentOS
yum install mailx
```

## Architecture Patterns

### Recommended Project Structure
```
sportlink-sync/
├── scripts/
│   ├── cron-wrapper.sh      # Environment setup, locking, email
│   └── install-cron.sh      # Automated crontab installation
├── logs/
│   └── cron/                # Cron-specific logs (separate from sync logs)
└── .cron.lock               # Lockfile for flock (created automatically)
```

### Pattern 1: Shell Wrapper with Environment Setup
**What:** Shell script that sources .env, sets PATH, changes to project directory, then runs Node.js
**When to use:** Always for Node.js cron jobs (cron runs with minimal environment)
**Example:**
```bash
#!/bin/bash
# Source: Standard cron best practice (2026)
# https://cronitor.io/guides/node-cron-jobs

# Exit on error
set -e

# Get script directory (works even when called from cron)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Change to project directory (required for relative paths in Node.js)
cd "$PROJECT_DIR"

# Set PATH to include node and npm
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Source .env file (absolute path required)
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a  # Auto-export variables
    source "$PROJECT_DIR/.env"
    set +a
fi

# Run the actual command
exec npm run sync-all
```

### Pattern 2: Flock-Based Locking
**What:** Use flock to prevent overlapping executions via file-based advisory locking
**When to use:** Any cron job that could still be running when next execution starts
**Example:**
```bash
# Source: https://ma.ttias.be/prevent-cronjobs-from-overlapping-in-linux/
# https://dev.to/mochafreddo/understanding-the-use-of-flock-in-linux-cron-jobs

# In crontab entry:
0 6 * * * /usr/bin/flock -w 0 /path/to/.cron.lock /path/to/wrapper.sh

# Or in wrapper script using file descriptor:
LOCKFILE="$PROJECT_DIR/.cron.lock"
exec 200>"$LOCKFILE"
flock -n 200 || exit 1

# Lock auto-releases when script exits (even on crash)
```

**Key insight:** `-w 0` means non-blocking. If lock exists, job exits immediately with code 1. Lock auto-releases when process exits, even on crash.

### Pattern 3: Custom Email Subject with mail Command
**What:** Pipe script output to mail command with -s flag for subject customization
**When to use:** When MAILTO default subject "Cron <user@host> command" is insufficient
**Example:**
```bash
# Source: https://www.cyberciti.biz/faq/linux-unix-crontab-change-mailto-settings/
# http://positon.org/cron-mail-subject-format

# Generate date for subject
DATE=$(date +%Y-%m-%d)
SUBJECT="Sportlink Sync Report - $DATE"
MAILTO="operator@example.com"

# Capture all output and send with custom subject
{
    npm run sync-all 2>&1
    EXIT_CODE=$?
    exit $EXIT_CODE
} | mail -s "$SUBJECT" "$MAILTO"
```

### Pattern 4: Retry Logic via Delayed Cron Entry
**What:** Schedule retry execution 2 hours after main job using separate cron entry
**When to use:** When retry should happen only on failure, without modifying main script
**Example:**
```bash
# Source: https://cronitor.io/guides/how-to-prevent-duplicate-cron-executions

# Main job at 6:00 AM
0 6 * * * /path/to/wrapper.sh --main

# Retry at 8:00 AM (only if flag file exists)
0 8 * * * [ -f /tmp/sportlink-sync-retry ] && /path/to/wrapper.sh --retry && rm /tmp/sportlink-sync-retry

# Wrapper creates retry flag on failure:
npm run sync-all || touch /tmp/sportlink-sync-retry
```

### Pattern 5: Timezone Configuration
**What:** Set CRON_TZ and TZ variables to run jobs in specific timezone
**When to use:** Always when scheduling needs specific timezone (especially with DST)
**Example:**
```bash
# Source: https://thelinuxcode.com/set-timezone-crontab/
# In crontab:
CRON_TZ=Europe/Amsterdam
TZ=Europe/Amsterdam

# Now 6:00 means 6:00 Amsterdam time (handles DST automatically)
0 6 * * * /path/to/wrapper.sh
```

**Key insight:** `CRON_TZ` controls when cron schedules the job. `TZ` controls timezone inside the executed script. Both should be set for consistency.

### Anti-Patterns to Avoid
- **Using relative paths:** Cron runs from `/` or user home, not project directory
- **Assuming environment variables:** .bashrc/.bash_profile don't load in cron
- **In-script retry loops:** Blocks cron execution; use separate scheduled retry instead
- **PID files without cleanup:** Can leave orphaned locks; flock auto-cleans
- **Piping directly without exit code:** `cmd | mail` loses exit code; wrap in subshell

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lock management | Custom PID files with stale cleanup | flock | Advisory locking, auto-release on exit/crash, atomic operations |
| Environment loading | Inline export statements | source .env with set -a | Consistent with local development, handles complex values |
| Log rotation | Cron job that truncates logs | logrotate | Standard tool, configurable compression/retention, runs automatically |
| Email sending | Custom SMTP client | mail/mailx command | Simple, handles MTA configuration, subject/body formatting |
| Date formatting | awk/sed parsing | date command | Built-in, locale-aware, all formats supported |
| Exit code capture | Complex trap handlers | $? variable | POSIX standard, reliable, simple |

**Key insight:** Shell utilities (flock, mail, date) are battle-tested and handle edge cases custom scripts miss. Cron environment differences make seemingly simple tasks complex - use proven tools.

## Common Pitfalls

### Pitfall 1: PATH Not Set
**What goes wrong:** Node or npm commands fail with "command not found" even though they work interactively
**Why it happens:** Cron runs with minimal PATH (typically `/usr/bin:/bin`), doesn't load shell profile
**How to avoid:** Explicitly set PATH in wrapper script or crontab header: `PATH=/usr/local/bin:/usr/bin:/bin`
**Warning signs:** Job works when run manually but fails from cron; email contains "command not found"

**Source:** [Cronitor Cron Troubleshooting](https://cronitor.io/guides/cron-troubleshooting-guide)

### Pitfall 2: Working Directory Assumptions
**What goes wrong:** Node.js require() fails with MODULE_NOT_FOUND for relative paths
**Why it happens:** Cron runs from root or user home, not project directory; node resolves relative paths from cwd
**How to avoid:** Always `cd` to project directory in wrapper before running node commands
**Warning signs:** "Cannot find module" errors for local files; works when run from project directory

**Source:** [GitHub nodejs-cron-job-must-know](https://github.com/wahengchang/nodejs-cron-job-must-know/blob/master/README.md)

### Pitfall 3: .env File Not Loaded
**What goes wrong:** Application crashes with "undefined is not a function" or missing credential errors
**Why it happens:** dotenv.config() uses process.cwd() by default, which is wrong in cron context
**How to avoid:** Source .env in wrapper script before running node, or use absolute path in dotenv.config()
**Warning signs:** Auth failures, database connection errors, works locally but not in cron

**Source:** [JavaScript in Plain English - Environment Variables in Node.js Cron Jobs](https://javascript.plainenglish.io/environment-variables-file-i-o-in-node-js-cron-jobs-5e8558202fc7)

### Pitfall 4: Overlapping Executions Without Locking
**What goes wrong:** Multiple instances run simultaneously, corrupting SQLite database or causing Playwright conflicts
**Why it happens:** Previous job still running when next scheduled execution starts
**How to avoid:** Always use flock with `-w 0` (non-blocking) to prevent concurrent runs
**Warning signs:** Database locked errors, duplicate Playwright browsers, log interleaving

**Source:** [Prevent cronjobs from overlapping](https://ma.ttias.be/prevent-cronjobs-from-overlapping-in-linux/)

### Pitfall 5: Silent Failures (No Exit Code Handling)
**What goes wrong:** Job fails but cron doesn't send email because command appears successful
**Why it happens:** Piping to mail command without capturing exit code: `cmd | mail` always returns mail's exit code
**How to avoid:** Wrap in subshell to preserve exit code, or capture $? before piping
**Warning signs:** No email on failures, scripts crash but cron shows success

**Source:** [Crontab Exit Codes Best Practices](https://crontab.io/resources/troubleshooting-cron-jobs)

### Pitfall 6: Timezone Confusion with DST
**What goes wrong:** Job runs at wrong time twice a year during DST transitions
**Why it happens:** Cron uses system timezone by default; CRON_TZ not set
**How to avoid:** Always set both CRON_TZ and TZ to Europe/Amsterdam in crontab
**Warning signs:** Job runs 1 hour off twice yearly; time is correct between DST changes

**Source:** [Setting Timezone for Cron Jobs](https://thelinuxcode.com/set-timezone-crontab/)

### Pitfall 7: MAILTO Without Custom Subject
**What goes wrong:** All emails have generic "Cron" subject, hard to filter or identify
**Why it happens:** MAILTO variable doesn't support subject customization
**How to avoid:** Don't use MAILTO; pipe to mail command with -s flag for custom subject
**Warning signs:** Email subject is "Cron <user@host> command" instead of descriptive text

**Source:** [Cron Mail Subject Format](http://positon.org/cron-mail-subject-format)

## Code Examples

Verified patterns from official sources and best practices:

### Complete Wrapper Script
```bash
#!/bin/bash
# cron-wrapper.sh - Production-ready wrapper for Node.js cron jobs
# Source: Combined best practices from Cronitor, Better Stack, and standard Linux documentation

set -e  # Exit on first error

# === SETUP ===
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
LOCKFILE="$PROJECT_DIR/.cron.lock"
LOG_DIR="$PROJECT_DIR/logs/cron"

# Create log directory if needed
mkdir -p "$LOG_DIR"

# === LOCKING ===
# Prevent overlapping executions using flock
# Source: https://dev.to/mochafreddo/understanding-the-use-of-flock-in-linux-cron-jobs
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "Another instance is running. Exiting." >&2
    exit 1
fi

# === ENVIRONMENT ===
# Set PATH for node/npm (adjust paths for your system)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Change to project directory (required for npm and relative paths)
cd "$PROJECT_DIR"

# Source .env file with auto-export
# Source: https://cronitor.io/guides/cron-environment-variables
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
else
    echo "Warning: .env file not found" >&2
fi

# === EXECUTION ===
DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$LOG_DIR/sync-$DATE.log"

# Run sync with logging
echo "=== Sportlink Sync Started: $(date) ===" | tee "$LOG_FILE"

# Execute and capture exit code
npm run sync-all 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

echo "=== Sportlink Sync Completed: $(date) Exit Code: $EXIT_CODE ===" | tee -a "$LOG_FILE"

# === RETRY HANDLING ===
# Create retry flag on failure
if [ $EXIT_CODE -ne 0 ]; then
    touch /tmp/sportlink-sync-retry
fi

exit $EXIT_CODE
```

### Crontab Configuration
```bash
# Crontab entry for daily sync with email reports
# Install with: crontab -e

# Set timezone to Europe/Amsterdam (handles DST automatically)
CRON_TZ=Europe/Amsterdam
TZ=Europe/Amsterdam

# Set email for notifications
MAILTO=operator@example.com

# Main sync job: Daily at 6:00 AM with lockfile prevention
# Uses flock for additional protection (belt and suspenders)
0 6 * * * /usr/bin/flock -w 0 /home/user/sportlink-sync/.cron.lock /home/user/sportlink-sync/scripts/cron-wrapper.sh | mail -s "Sportlink Sync Report - $(date +\%Y-\%m-\%d)" operator@example.com

# Retry job: Runs at 8:00 AM only if retry flag exists
0 8 * * * [ -f /tmp/sportlink-sync-retry ] && /home/user/sportlink-sync/scripts/cron-wrapper.sh --retry && rm /tmp/sportlink-sync-retry || true
```

### Email with Custom Subject (Alternative Pattern)
```bash
# If wrapper handles emailing (instead of piping in crontab)
# Add to end of cron-wrapper.sh:

# === EMAIL DELIVERY ===
SUBJECT="Sportlink Sync Report - $(date +%Y-%m-%d)"
MAILTO="operator@example.com"
LOG_CONTENT=$(cat "$LOG_FILE")

# Send email with custom subject
# Source: https://mailtrap.io/blog/bash-send-email/
echo "$LOG_CONTENT" | mail -s "$SUBJECT" "$MAILTO"
```

### Install Script for Automated Setup
```bash
#!/bin/bash
# scripts/install-cron.sh - Automated crontab installation
# Source: Standard package.json script pattern

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Installing crontab entries for Sportlink Sync..."

# Verify mail command exists
if ! command -v mail &> /dev/null; then
    echo "Error: 'mail' command not found. Install mailutils:"
    echo "  Ubuntu/Debian: sudo apt-get install mailutils"
    echo "  RHEL/CentOS: sudo yum install mailx"
    exit 1
fi

# Prompt for email
read -p "Enter operator email address: " OPERATOR_EMAIL
if [ -z "$OPERATOR_EMAIL" ]; then
    echo "Error: Email address required"
    exit 1
fi

# Create crontab entries
CRON_ENTRIES="
# Sportlink Sync Automation (installed $(date))
CRON_TZ=Europe/Amsterdam
TZ=Europe/Amsterdam
MAILTO=$OPERATOR_EMAIL

# Main sync: Daily at 6:00 AM
0 6 * * * /usr/bin/flock -w 0 $PROJECT_DIR/.cron.lock $PROJECT_DIR/scripts/cron-wrapper.sh | mail -s \"Sportlink Sync Report - \$(date +\\%Y-\\%m-\\%d)\" $OPERATOR_EMAIL

# Retry: 8:00 AM if previous failed
0 8 * * * [ -f /tmp/sportlink-sync-retry ] && $PROJECT_DIR/scripts/cron-wrapper.sh && rm /tmp/sportlink-sync-retry || true
"

# Add to crontab
(crontab -l 2>/dev/null || true; echo "$CRON_ENTRIES") | crontab -

echo "Crontab installed successfully!"
echo "View with: crontab -l"
echo "Remove with: crontab -r"
```

### Logrotate Configuration
```bash
# /etc/logrotate.d/sportlink-sync
# Source: https://betterstack.com/community/guides/logging/how-to-manage-log-files-with-logrotate-on-ubuntu-20-04/

/home/user/sportlink-sync/logs/cron/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 user user
    sharedscripts
    postrotate
        # Optional: Clean up logs older than 30 days
        find /home/user/sportlink-sync/logs/cron -name "*.log.gz" -mtime +30 -delete
    endscript
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PID files | flock advisory locking | ~2015 | Simpler, auto-cleanup, no orphaned locks |
| node-cron in-process | System cron with shell wrapper | Ongoing | Better separation, survives app crashes |
| Manual PATH exports | set -a with source .env | ~2018 | Consistent with development, handles complex values |
| anacron for servers | cron with precise timing | Always | Cron better for 24/7 servers, anacron for laptops |
| Custom retry loops | Separate delayed cron entry | ~2020 | Non-blocking, simpler scripts, standard pattern |
| CRON_TZ only | CRON_TZ + TZ both set | ~2019 | Handles DST correctly in both scheduling and execution |

**Deprecated/outdated:**
- **at command for one-time delays:** Use cron with conditional flag files for retry logic
- **Systemd timers for simple daily jobs:** Overkill for basic scheduling; cron is simpler
- **Custom lockfile implementations:** flock is standard and handles all edge cases

## Open Questions

Things that couldn't be fully resolved:

1. **MTA Configuration on Target Server**
   - What we know: mail command requires working MTA (postfix, sendmail, exim)
   - What's unclear: Target server's MTA setup and relay configuration
   - Recommendation: Document MTA verification in installation script; test with `echo "test" | mail -s "Test" email@example.com`

2. **Log Rotation Frequency**
   - What we know: Logrotate runs daily via /etc/cron.daily by default
   - What's unclear: Whether daily rotation is needed or weekly/monthly is sufficient
   - Recommendation: Start with daily rotation, 30-day retention; adjust based on log volume

3. **Retry Flag File Location**
   - What we know: /tmp works but may be cleared on reboot
   - What's unclear: Whether /var/run or project directory is better for retry flags
   - Recommendation: Use /tmp for simplicity; retry only relevant within same day

4. **Node.js Path on Target Server**
   - What we know: Common paths are /usr/local/bin/node or /usr/bin/node
   - What's unclear: Actual path on deployment server
   - Recommendation: Wrapper script should detect with `which node` or provide configuration

## Sources

### Primary (HIGH confidence)
- [Cronitor: Scheduling Cron Jobs in Node.js](https://cronitor.io/guides/node-cron-jobs) - Node.js cron best practices
- [Cronitor: Cron Environment Variables](https://cronitor.io/guides/cron-environment-variables) - Environment setup
- [Cronitor: Prevent Duplicate Cron Executions](https://cronitor.io/guides/how-to-prevent-duplicate-cron-executions) - Locking patterns
- [Cronitor: Cron Troubleshooting Guide](https://cronitor.io/guides/cron-troubleshooting-guide) - Common issues
- [Better Stack: How to Prevent Duplicate Cron Jobs](https://betterstack.com/community/questions/how-to-prevent-duplicate-cron-jobs-from-running/) - Flock usage
- [Better Stack: Log Files with Logrotate](https://betterstack.com/community/guides/logging/how-to-manage-log-files-with-logrotate-on-ubuntu-20-04/) - Log rotation
- [nixCraft: Crontab MAILTO Settings](https://www.cyberciti.biz/faq/linux-unix-crontab-change-mailto-settings/) - Email configuration
- [ma.ttias.be: Prevent Cronjobs from Overlapping](https://ma.ttias.be/prevent-cronjobs-from-overlapping-in-linux/) - Flock patterns
- [TheLinuxCode: Setting Timezone for Cron](https://thelinuxcode.com/set-timezone-crontab/) - Timezone handling
- [Baeldung: Crontab Email Notifications](https://www.baeldung.com/linux/crontab-email-notifications) - MAILTO basics

### Secondary (MEDIUM confidence)
- [Mailtrap: Bash Send Email Tutorial (2026)](https://mailtrap.io/blog/bash-send-email/) - Mail command patterns
- [DEV: Understanding flock in Linux Cron Jobs](https://dev.to/mochafreddo/understanding-the-use-of-flock-in-linux-cron-jobs-preventing-concurrent-script-execution-3c5h) - Flock implementation
- [JavaScript in Plain English: Environment Variables in Node.js Cron Jobs](https://javascript.plainenglish.io/environment-variables-file-i-o-in-node-js-cron-jobs-5e8558202fc7) - .env loading
- [Crontab.io: Troubleshooting Cron Jobs](https://crontab.io/resources/troubleshooting-cron-jobs) - Exit codes and debugging
- [DEV: How to Monitor Cron Jobs in 2026](https://dev.to/cronmonitor/how-to-monitor-cron-jobs-in-2026-a-complete-guide-28g9) - Best practices
- [Libre Things: Cron Mail Subject Format](http://positon.org/cron-mail-subject-format) - Email subject customization
- [TecMint: Cron vs Anacron](https://www.tecmint.com/cron-vs-anacron-schedule-jobs-using-anacron-on-linux/) - Scheduler comparison
- [Finisky Garden: How to Set Crontab Timezone](https://finisky.github.io/en/how-to-set-crontab-timezone/) - TZ configuration

### Tertiary (LOW confidence)
- GitHub discussions and issue threads about node-cron (informational only)
- npm package documentation (not using node-cron package, using system cron)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Cron/flock/mail are standard Linux tools with stable interfaces
- Architecture patterns: HIGH - Shell wrapper, flock locking, and mail piping are well-documented best practices verified across multiple authoritative sources
- Don't hand-roll: HIGH - Flock advantages and environment loading patterns verified in official documentation
- Pitfalls: HIGH - All pitfalls verified with multiple sources from Cronitor, Better Stack, and Linux documentation
- Email subject customization: MEDIUM - MAILTO limitation verified, mail command workaround confirmed but less documented
- Retry patterns: MEDIUM - Flag file approach is common pattern but less standardized than core cron features

**Research date:** 2026-01-24
**Valid until:** 2026-02-24 (30 days - stable technology with infrequent changes)
