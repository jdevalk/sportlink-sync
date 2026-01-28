---
phase: 17-memberheader-data-capture
plan: 01
subsystem: database
tags: [sportlink, sqlite, api-capture, memberheader, playwright]

# Dependency graph
requires:
  - phase: 16-freescout-sync
    provides: download-functions-from-sportlink.js with /other page API capture pattern
provides:
  - SQLite schema with has_financial_block, photo_url, photo_date columns
  - MemberHeader API response capture in parallel with MemberFreeFields
  - Financial block status data for all members with functions/committees
  - Photo metadata for downstream photo optimization
affects:
  - 18-financial-block-sync
  - 19-photo-api-optimization

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel API capture with Promise.all during single page visit"
    - "Conditional schema migrations using PRAGMA table_info pattern"

key-files:
  created: []
  modified:
    - lib/stadion-db.js
    - download-functions-from-sportlink.js

key-decisions:
  - "Use INTEGER for has_financial_block (SQLite has no native boolean)"
  - "Capture MemberHeader during existing /other page visit to avoid extra overhead"
  - "Include all 6 fields in hash computation for proper change detection"

patterns-established:
  - "Parallel API waitForResponse: Set up promises BEFORE page.goto() to avoid race conditions"
  - "Graceful null handling: Optional chaining for Photo object fields"
  - "Extended hash functions: Include new fields in computeMemberFreeFieldsHash"

# Metrics
duration: 1min 56s
completed: 2026-01-28
---

# Phase 17 Plan 01: MemberHeader Data Capture Summary

**MemberHeader API captured in parallel with MemberFreeFields, extracting financial block status and photo metadata for 100% of members with functions/committees**

## Performance

- **Duration:** 1 minute 56 seconds
- **Started:** 2026-01-28T16:10:41Z
- **Completed:** 2026-01-28T16:12:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- SQLite schema extended with has_financial_block (INTEGER), photo_url (TEXT), photo_date (TEXT)
- MemberHeader API response captured during existing /other page visit (no additional overhead)
- Financial block status (HasFinancialTransferBlockOwnClub) extracted and stored as 0/1 integer
- Photo URL and PhotoDate extracted with graceful null handling when Photo object missing
- Hash computation updated to include all 6 fields for proper change detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Add schema migration and update upsert for MemberHeader fields** - `bc14045` (feat)
2. **Task 2: Capture MemberHeader API response in parallel with MemberFreeFields** - `724a2ab` (feat)

## Files Created/Modified
- `lib/stadion-db.js` - Added 3 columns to sportlink_member_free_fields, updated hash and upsert functions
- `download-functions-from-sportlink.js` - Renamed fetchMemberFreeFields to fetchMemberDataFromOtherPage, added parallel MemberHeader capture

## Decisions Made
- **Use INTEGER for has_financial_block:** SQLite has no native boolean type, so store as 0/1 integer for proper data type handling
- **Capture during existing /other page visit:** MemberHeader API is already fetched when visiting /other tab, so capture it in parallel with MemberFreeFields to avoid extra page loads
- **Include all fields in hash:** Updated computeMemberFreeFieldsHash to include all 6 fields (old 3 + new 3) to ensure proper change detection
- **Optional chaining for Photo fields:** Use `data?.Photo?.Url` pattern because Photo object can be null for members without photos

## Deviations from Plan

None - plan executed exactly as written

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 18 (Financial Block Sync):**
- Financial block status captured and stored in SQLite
- Data available for all members with functions/committees
- Hash-based change detection working correctly

**Ready for Phase 19 (Photo API Optimization):**
- Photo URL and PhotoDate captured from MemberHeader API
- Data available for downstream photo sync optimization
- Null Photo object handling tested and verified

**Next steps:**
1. Phase 18 can sync has_financial_block to Stadion `financiele-blokkade` field
2. Phase 19 can replace browser-based photo download with direct URL fetch using photo_url
3. Both phases can proceed independently after completion of this phase

---
*Phase: 17-memberheader-data-capture*
*Completed: 2026-01-28*
