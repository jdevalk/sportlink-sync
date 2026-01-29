---
phase: 22-stadion-change-detection
plan: 01
subsystem: sync
tags: [sqlite, change-detection, reverse-sync, wordpress-api, hash-comparison]

# Dependency graph
requires:
  - phase: 20-foundation
    provides: Bidirectional timestamp tracking columns and TRACKED_FIELDS constant
  - phase: 21-conflict-resolution-infrastructure
    provides: Conflict resolution audit table pattern and database helper structure
provides:
  - Change detection module with hash-based field comparison for 7 tracked fields
  - SQLite audit tables for detection runs and detected changes
  - CLI entry point for manual change detection runs
affects: [23-reverse-sync-sportlink-general, 24-reverse-sync-sportlink-photos]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Change detection via tracked_fields_hash comparison"
    - "Stadion API modified_after parameter for incremental queries"
    - "Audit table pattern for change detection logging"

key-files:
  created:
    - lib/detect-stadion-changes.js
    - detect-stadion-changes.js
  modified:
    - lib/stadion-db.js

key-decisions:
  - "Hash-based change detection using SHA-256 of tracked fields only"
  - "Skip members where sync_origin=SYNC_FORWARD to avoid loop detection false positives"
  - "Use WordPress modified_after parameter for efficient incremental detection"
  - "Store detection_run_id for correlating changes within a single detection run"

patterns-established:
  - "extractFieldValue pattern for ACF field extraction (contact_info vs direct fields)"
  - "stableStringify for deterministic JSON serialization in hash computation"
  - "Self-test pattern in library modules for development verification"

# Metrics
duration: 3min
completed: 2026-01-29
---

# Phase 22 Plan 01: Stadion Change Detection Summary

**Hash-based change detection for 7 tracked fields with SQLite audit trail and incremental timestamp tracking**

## Performance

- **Duration:** 3 minutes
- **Started:** 2026-01-29T16:38:32Z
- **Completed:** 2026-01-29T16:41:52Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- Database schema with stadion_change_detections audit table and reverse_sync_state singleton
- Change detection module extracting fields from Stadion ACF structure (contact_info repeater + direct fields)
- Hash comparison identifies actual field changes without false positives from unrelated modifications
- CLI entry point with module/CLI hybrid pattern for manual detection runs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add database schema for change detection** - `ff8d715` (feat)
2. **Task 2: Create change detection module and CLI** - `ea2a84a` (feat)
3. **Task 3: Verify integration and add self-test** - (no commit, verification only)

## Files Created/Modified

- `lib/stadion-db.js` - Added stadion_change_detections and reverse_sync_state tables, tracked_fields_hash column, helper functions
- `lib/detect-stadion-changes.js` - Change detection logic with field extraction, hash computation, and API queries
- `detect-stadion-changes.js` - CLI entry point with verbose logging and error handling

## Decisions Made

**Hash-based detection approach:**
- Compute SHA-256 hash of all 7 tracked fields for each member
- Store hash in stadion_members.tracked_fields_hash column
- Compare stored hash vs current hash to detect changes
- Only log individual field changes when hash differs

**Field extraction strategy:**
- Contact fields (email, email2, mobile, phone) extract from acf.contact_info repeater array
- Direct fields (datum_vog, freescout_id, financiele_blokkade) extract from acf properties
- Use consistent extraction logic for both hash computation and change logging

**Loop prevention:**
- Skip members where sync_origin = SYNC_FORWARD
- Prevents false positives when forward sync just updated the member
- Actual user edits have sync_origin = USER_EDIT or NULL

**Incremental detection:**
- Use reverse_sync_state.last_detection_at to track last run
- WordPress modified_after parameter filters API query efficiently
- Detection run ID correlates all changes within a single run

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 23 (Reverse Sync - General Fields):**
- Change detection identifies which members need reverse sync
- Detection audit table provides old_value/new_value for each field
- sync_origin column prevents sync loops

**Architecture notes:**
- Current implementation logs ALL tracked fields as changed when hash differs (simple approach)
- Phase 23 will need to compare individual field values to determine which specific fields changed
- Detection runs are independent of sync - can run detection without triggering sync

**Testing considerations:**
- Self-test validates field extraction and hash computation
- Full integration test requires actual Stadion API with modified members
- Production testing will occur when Phase 23 implements actual reverse sync

---
*Phase: 22-stadion-change-detection*
*Completed: 2026-01-29*
