---
phase: 40-former-member-import-tool
plan: 02
subsystem: sync
tags: [photos, playwright, sportlink, rondo-club, former-members, multipart-upload]

# Dependency graph
requires:
  - phase: 40-former-member-import-tool
    plan: 01
    provides: Former member import orchestrator and member sync
  - phase: 35-run-tracking
    provides: Photo state tracking in database
  - phase: 34-infrastructure-foundation
    provides: Playwright and Sportlink login patterns
provides:
  - Photo download for former members via MemberHeader API
  - Photo upload to Rondo Club person records
  - Complete former member import with photos
affects: [future-photo-workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Photo download via MemberHeader API during browser session
    - Multipart form-data upload to WordPress REST API
    - Photo state machine (pending_download → downloaded → synced)

key-files:
  created: []
  modified:
    - tools/import-former-members.js

key-decisions:
  - "Photo steps integrated into import tool rather than separate script for atomic operation"
  - "--skip-photos flag allows member-only import without photos for faster testing"
  - "Photo failures don't prevent member sync completion (non-critical steps)"

patterns-established:
  - "Pattern 1: Photo download requires separate Playwright session after member sync completes"
  - "Pattern 2: Photo upload uses inline implementation to avoid external dependencies"
  - "Pattern 3: Dry-run mode shows photo potential count without downloading"

# Metrics
duration: 2min
completed: 2026-02-09
---

# Phase 40 Plan 02: Former Member Photo Import Summary

**Photo download via MemberHeader API and upload to Rondo Club integrated into former member import tool**

## Performance

- **Duration:** 1 min 57s
- **Started:** 2026-02-09T20:52:22Z
- **Completed:** 2026-02-09T20:54:19Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Photo download step launches Playwright session to capture MemberHeader API responses
- Photos download immediately from signed CDN URLs while session is active
- Photo upload uses multipart form-data to WordPress REST API endpoint
- --skip-photos flag allows member-only import without photo processing
- Dry-run mode estimates photo count by checking PersonImageDate fields
- Photo statistics included in summary output

## Task Commits

Each task was committed atomically:

1. **Task 1: Add photo download and upload to import-former-members tool** - `f7239fa` (feat)

## Files Created/Modified
- `tools/import-former-members.js` - Added Step 4 (photo download) and Step 5 (photo upload) after member sync, --skip-photos flag, photo statistics tracking

## Decisions Made

**Inline photo implementation:** Implemented photo download and upload directly in the import tool rather than calling separate modules. This creates an atomic operation where photos are processed immediately after member sync. If photo steps fail, member sync is still complete.

**Skip-photos flag for flexibility:** Added --skip-photos flag to allow operators to run member-only import without photo processing. Useful for quick testing or when photos aren't immediately needed.

**Non-critical photo steps:** Photo download and upload failures are tracked but don't fail the overall import. Former members are successfully imported even if photos fail. This follows the pattern established in regular sync pipelines.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed as specified.

## User Setup Required

None - photo functionality uses existing credentials and infrastructure.

## Next Phase Readiness

- Former member import tool now complete with full photo support
- Tool ready for production use on server (46.202.155.16)
- Phase 40 (Former Member Import Tool) complete
- All v3.1 milestone requirements satisfied

---
*Phase: 40-former-member-import-tool*
*Completed: 2026-02-09*

## Self-Check: PASSED

All claimed files and commits verified to exist.
