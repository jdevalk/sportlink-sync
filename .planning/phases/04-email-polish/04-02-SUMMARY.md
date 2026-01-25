---
phase: 04-email-polish
plan: 02
subsystem: infra
tags: [cron, bash, shell]

# Dependency graph
requires:
  - phase: 04-01
    provides: email formatting infrastructure
provides:
  - Clean cron output without npm header noise
  - Idempotent cron installation
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Direct node invocation for cleaner CLI output
    - Filter-before-append for idempotent crontab management

key-files:
  created: []
  modified:
    - scripts/cron-wrapper.sh
    - scripts/install-cron.sh

key-decisions:
  - "Direct node invocation instead of npm run for clean output"
  - "grep -v filter pattern for idempotent crontab installation"

patterns-established:
  - "Use direct node invocation when npm script headers pollute output"
  - "Filter existing entries before appending to crontab for re-runnability"

# Metrics
duration: 3min
completed: 2026-01-25
---

# Phase 4 Plan 2: Cron Output Cleanup Summary

**Direct node invocation for clean logs and idempotent cron installation via filter-before-append pattern**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-25T10:35:00Z
- **Completed:** 2026-01-25T10:38:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Eliminated npm lifecycle header from cron log output (cleaner email reports)
- Made install-cron.sh idempotent - running multiple times results in exactly 2 cron entries
- Both scripts pass bash syntax validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace npm run with direct node invocation** - `cfe75be` (fix)
2. **Task 2: Make install-cron idempotent** - `665ea53` (fix)

## Files Created/Modified

- `scripts/cron-wrapper.sh` - Changed `npm run sync-all` to `node "$PROJECT_DIR/sync-all.js"`
- `scripts/install-cron.sh` - Added grep filter to remove existing sportlink entries before adding new ones

## Decisions Made

- **Direct node invocation:** Using `node sync-all.js` instead of `npm run sync-all` eliminates the npm header line that was polluting email reports
- **Filter pattern:** Using `grep -v 'sportlink-sync\|cron-wrapper.sh'` catches both the comment lines and the cron job lines

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cron infrastructure is now production-ready
- Email reports will be cleaner without npm header noise
- Users can safely re-run install-cron without duplicate entries

---
*Phase: 04-email-polish*
*Completed: 2026-01-25*
