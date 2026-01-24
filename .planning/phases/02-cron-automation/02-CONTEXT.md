# Phase 2: Cron Automation - Context

**Gathered:** 2026-01-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Daily sync runs automatically with email reports on completion. Configure cron to execute `npm run sync-all` on a schedule with appropriate environment setup and error handling. Manual trigger and monitoring are separate concerns.

</domain>

<decisions>
## Implementation Decisions

### Schedule timing
- Run daily at 6:00 AM Europe/Amsterdam timezone
- Every day including weekends (7 days/week)
- Use lockfile to prevent overlapping runs if previous job is still executing

### Email delivery
- Single operator email address configured in crontab MAILTO
- Email sent after every run (success and failure)
- Use standard cron MAILTO mechanism for delivery
- Subject should include date: "Sportlink Sync Report - 2026-01-24"

### Error handling
- Retry once after 2-hour delay if sync fails
- All error types treated the same (including auth failures)
- Log errors to logs/ directory in addition to email notification
- Persistent log file for troubleshooting beyond email

### Environment setup
- Target environment: Linux server with standard cron
- Create wrapper shell script that sources .env and sets PATH before running node
- Provide install script (`npm run install-cron` or similar) to set up crontab entry
- Cron logs go to logs/ directory alongside existing sync logs

### Claude's Discretion
- Exact lockfile implementation and location
- Retry mechanism (separate cron entry vs. script logic)
- Log rotation policy
- Wrapper script naming and location

</decisions>

<specifics>
## Specific Ideas

- Subject format with date allows easy email filtering/searching
- Wrapper script approach keeps crontab entry clean and maintainable
- Same logs/ directory keeps all operational logs together

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-cron-automation*
*Context gathered: 2026-01-24*
