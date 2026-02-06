---
phase: 33-birthday-field-migration
plan: 02
subsystem: database
tags: [sqlite, stadion-db, documentation, deprecation]

# Dependency graph
requires:
  - phase: 33-01
    provides: Birthday sync migrated to acf.birthdate on person records
provides:
  - Deprecated stadion_important_dates database table and functions
  - Updated all documentation to reflect birthdate-as-ACF-field architecture
  - Cleaned up tools referencing old birthday sync model
affects: [future-database-cleanup, documentation-maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deprecated database functions retained for backward compatibility"
    - "Documentation deprecation notices with version tags"

key-files:
  created: []
  modified:
    - lib/stadion-db.js
    - tools/validate-stadion-ids.js
    - tools/find-orphan-dates.js
    - tools/verify-stadion-data.js
    - docs/pipeline-people.md
    - docs/database-schema.md
    - docs/sync-architecture.md
    - docs/operations.md
    - docs/utility-scripts.md
    - docs/troubleshooting.md
    - docs/installation.md
    - scripts/sync.sh
    - CLAUDE.md
    - README.md

key-decisions:
  - "Keep stadion_important_dates table schema for backward compatibility - only mark functions as deprecated"
  - "Add @deprecated JSDoc tags to all 8 important_date functions"
  - "Remove --reset-dates flag from validate-stadion-ids.js (no longer needed)"

patterns-established:
  - "Deprecation pattern: mark DB functions @deprecated but keep in exports for backward compat"
  - "Documentation pattern: mark deprecated sections with (DEPRECATED - vX.X) prefix"

# Metrics
duration: 6min
completed: 2026-02-06
---

# Phase 33 Plan 02: Deprecate Important Dates Table Summary

**Deprecated stadion_important_dates table and all 8 database functions, updated 10 documentation files to reflect birthdate-as-ACF-field architecture**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-06T10:35:31Z
- **Completed:** 2026-02-06T10:41:47Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Marked stadion_important_dates table as deprecated in schema with backward compatibility
- Added @deprecated JSDoc tags to all 8 important_date database functions
- Updated people pipeline documentation from 8-step to 7-step flow
- Removed all active references to sync-important-dates.js from documentation
- Updated field mappings to show birthdate as acf.birthdate on person

## Task Commits

Each task was committed atomically:

1. **Task 1: Deprecate DB functions and clean up tools** - `e7796f8` (refactor)
2. **Task 2: Update documentation** - `b5452dd` (docs)

## Files Created/Modified

**lib/stadion-db.js** - Added deprecation comment to table schema, @deprecated JSDoc to 8 functions
**tools/validate-stadion-ids.js** - Removed --reset-dates flag and related functionality
**tools/find-orphan-dates.js** - Added deprecation warning at runtime
**tools/verify-stadion-data.js** - Removed importantDates entity from verification config

**docs/pipeline-people.md** - Removed Step 5 (birthday sync), renumbered to 7 steps, updated field mappings
**docs/database-schema.md** - Marked stadion_important_dates section as deprecated
**docs/sync-architecture.md** - Updated pipeline flow, field mappings, database table list
**docs/operations.md** - Removed sync-important-dates.js from individual step commands
**docs/utility-scripts.md** - Marked find-orphan-dates.js as deprecated, removed --reset-dates
**docs/troubleshooting.md** - Updated orphaned birthdays section to orphaned relationships only
**docs/installation.md** - Removed important_date post type from Stadion theme requirements

**scripts/sync.sh** - Updated help text to remove "birthdays" as separate concept
**CLAUDE.md** - Updated Quick Reference and pipeline step count
**README.md** - Updated architecture diagram, pipeline table, quick reference

## Decisions Made

**Keep table schema for backward compatibility:** The stadion_important_dates table CREATE statement remains in stadion-db.js to avoid breaking existing databases on the production server. Only functions are marked deprecated.

**@deprecated JSDoc approach:** All 8 functions (computeDateHash, upsertImportantDate, getImportantDatesNeedingSync, updateImportantDateSyncState, getOrphanImportantDates, deleteImportantDate, getImportantDatesCount, getSyncedImportantDatesCount) marked with @deprecated tag and kept in module.exports for tools that haven't been updated yet.

**Documentation versioning:** Used "(DEPRECATED - v2.3)" pattern consistently across all docs to indicate when deprecation occurred.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Documentation and code now accurately reflect the birthdate-as-ACF-field architecture. The stadion_important_dates table exists but is unused by active sync code.

**Ready for next phase:** Yes - can proceed to 33-03 (remove unused birthday sync script and email report code).

**Note:** Production testing still pending from 33-01 - must verify birthdate field appears in Stadion after next sync.

---
*Phase: 33-birthday-field-migration*
*Completed: 2026-02-06*
