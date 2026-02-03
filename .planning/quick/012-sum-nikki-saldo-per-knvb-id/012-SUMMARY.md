---
phase: quick
plan: 012
subsystem: database
tags: [nikki, sqlite, better-sqlite3, aggregation]

# Dependency graph
requires:
  - phase: 31
    provides: Nikki contribution sync infrastructure
provides:
  - Multi-entry storage for Nikki contributions per member per year
  - Aggregated saldo/hoofdsom retrieval with SUM operations
affects: [nikki-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store granular data, aggregate on retrieval pattern for multi-entry records"

key-files:
  created: []
  modified:
    - lib/nikki-db.js

key-decisions:
  - "Changed UNIQUE constraint from (knvb_id, year) to (knvb_id, year, nikki_id)"
  - "All retrieval functions use GROUP BY and SUM for aggregation"
  - "MAX() used for nikki_id and status in aggregated results"

patterns-established:
  - "Multi-entry database pattern: Store all entries, aggregate on retrieval rather than at insert time"
  - "Database migrations handled inline with try/catch in initDb()"

# Metrics
duration: 1min
completed: 2026-02-03
---

# Quick Task 012: Sum Nikki Saldo per KNVB ID

**Database schema updated to store multiple Nikki entries per member per year with aggregation on retrieval**

## Performance

- **Duration:** 1 minute
- **Started:** 2026-02-03T22:31:28Z
- **Completed:** 2026-02-03T22:32:49Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Changed UNIQUE constraint to allow multiple nikki_id entries per (knvb_id, year)
- Added automatic migration from old schema to new schema
- Updated all 5 retrieval functions to aggregate saldo/hoofdsom with SUM
- Maintained backward compatibility - existing code works unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Update nikki-db.js schema and retrieval to support multiple entries per member per year** - `e4f411f` (feat)

## Files Created/Modified
- `lib/nikki-db.js` - Updated schema constraint, added migration, updated all retrieval queries with GROUP BY and SUM

## Decisions Made

1. **UNIQUE constraint change:** From `UNIQUE(knvb_id, year)` to `UNIQUE(knvb_id, year, nikki_id)` to allow multiple Nikki contribution entries for the same member and year
2. **Aggregation pattern:** Use `SUM(saldo)` and `SUM(hoofdsom)` in GROUP BY queries rather than storing pre-aggregated values
3. **Migration strategy:** Detect old schema by checking table SQL, recreate table if needed
4. **Single value selection:** Use `MAX(nikki_id)` and `MAX(status)` for fields that need one value per group (alphabetically latest status tends to be worst status)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation went smoothly. All verification tests passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Database now correctly handles multiple Nikki contributions per member per year
- Aggregated saldo values will be accurate for Stadion sync
- Ready for production use when members have multiple contribution entries

---
*Phase: quick-012*
*Completed: 2026-02-03*
