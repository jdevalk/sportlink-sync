---
phase: 33-birthday-field-migration
plan: 01
completed: 2026-02-06
duration: 109s
subsystem: data-sync
tags: [stadion, acf, birthday, refactor]

requires:
  - "Sportlink DateOfBirth field in member data"
  - "Stadion person ACF field infrastructure"
  - "steps/prepare-stadion-members.js preparePerson function"

provides:
  - "acf.birthdate field on Stadion persons (Y-m-d format)"
  - "Simplified birthday sync through existing person pipeline"
  - "Removal of sync-important-dates.js dependency"

affects:
  - "Phase 33-02: Important dates cleanup (can now remove unused birthday sync step)"
  - "Phase 33-03: Field mapping documentation"
  - "Phase 33-04: Testing on production server"

key-files:
  created: []
  modified:
    - steps/prepare-stadion-members.js
    - pipelines/sync-people.js

tech-stack:
  added: []
  patterns:
    - "ACF field consolidation pattern (birthday data on person vs separate post)"
    - "Optional field pattern with null exclusion"

decisions:
  - id: birthdate-acf-field
    title: "Birthdate as ACF field on person"
    choice: "Add acf.birthdate (Y-m-d string) to person record"
    rationale: "Eliminates complex important_date post lifecycle management. Birthdate flows through existing person sync hash-based change detection."
    alternatives:
      - "Keep separate important_date posts"
      - "Use birth_year only (loses day/month precision)"

  - id: no-birthdate-counter
    title: "No separate birthdate counter in report"
    choice: "Don't add 'birthdates populated: X' to STADION SYNC section"
    rationale: "Birthdate is just another ACF field like birth_year or gender. Existing 'Persons synced' line already covers it through hash-based change detection."
    alternatives:
      - "Add explicit birthdate counter"
---

# Phase 33 Plan 01: Add Birthdate ACF Field Summary

**One-liner:** Migrated birthday handling from separate important_date posts to an ACF birthdate field on person records, synced through existing person pipeline.

## What Was Built

Replaced the complex birthday sync mechanism (separate WordPress important_date posts with create/update/delete lifecycle) with a simple ACF field on person records:

1. **Task 1: Birthdate extraction and ACF population**
   - Added `extractBirthdate()` function to validate and extract full YYYY-MM-DD date strings
   - Modified `preparePerson()` to include `acf.birthdate` when valid DateOfBirth exists
   - Follows same optional field pattern as birth_year, gender (null excluded from payload)
   - No changes needed in `submit-stadion-sync.js` - already sends all ACF fields

2. **Task 2: Pipeline cleanup**
   - Removed `sync-important-dates.js` import and Step 5 execution
   - Removed `stats.birthdays` tracking object
   - Removed "BIRTHDAY SYNC" section from email report
   - Removed birthdays errors from allErrors aggregation and success check
   - Renumbered steps: Photo Download now Step 5, etc.

## Key Changes

### steps/prepare-stadion-members.js

```javascript
// NEW: Extract full birthdate (YYYY-MM-DD)
function extractBirthdate(dateOfBirth) {
  if (!dateOfBirth) return null;
  const trimmed = dateOfBirth.trim();
  if (!trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  return trimmed;
}

// In preparePerson:
const birthdate = extractBirthdate(sportlinkMember.DateOfBirth);
if (birthdate) acf.birthdate = birthdate;
```

### pipelines/sync-people.js

**Before:** 8 steps (Download → Laposta → Stadion → **Birthday Sync** → Photo Download → Photo Upload → Reverse Sync)
**After:** 7 steps (Download → Laposta → Stadion → Photo Download → Photo Upload → Reverse Sync)

**Email report before:**
```
STADION SYNC
Persons synced: 1234/1250 (10 created, 45 updated)

BIRTHDAY SYNC
Birthdays synced: 850/1200

PHOTO SYNC
...
```

**Email report after:**
```
STADION SYNC
Persons synced: 1234/1250 (10 created, 45 updated)

PHOTO SYNC
...
```

Birthdate changes now included in the person sync stats (hash-based change detection).

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

**Decision 1: No separate birthdate counter in email report**
- **Context:** Should we add "Birthdates populated: X" to STADION SYNC section?
- **Choice:** No - birthdate is just another ACF field
- **Rationale:** The existing "Persons synced" line already covers birthdate changes through hash-based change detection. Adding a separate counter would be inconsistent with how we handle other optional ACF fields like birth_year, gender, etc.

## Testing Performed

1. **Module loading:** Both modified files load without errors
2. **Import verification:** No references to `runBirthdaySync` or `BIRTHDAY SYNC` remain in sync-people.js
3. **Stats cleanup:** No references to `stats.birthdays` remain
4. **Code inspection:** Verified `extractBirthdate()` function and ACF field addition follow existing patterns

**Production testing required:**
- Need to verify birthdate field appears in Stadion after next sync
- Need to verify email report shows correct format without BIRTHDAY SYNC section
- Need to verify hash-based change detection works for birthdate updates

## Next Phase Readiness

**Blockers:** None

**Concerns:**
- Production testing needed to verify birthdate field creation in Stadion
- May need to update field-mapping.json documentation (Phase 33-03)
- sync-important-dates.js still exists but is now unused (will be removed in Phase 33-02)

**Recommended next steps:**
1. Deploy to production server (git pull)
2. Run sync-people.js and verify birthdate field appears in Stadion
3. Proceed to Phase 33-02 to remove unused sync-important-dates.js and related code
4. Update field mapping documentation (Phase 33-03)

## Metrics

- **Tasks completed:** 2/2
- **Commits:** 2
  - `1e075be` - feat(33-01): add birthdate to person ACF payload
  - `6c36fd4` - refactor(33-01): remove birthday sync step from people pipeline
- **Files modified:** 2
  - steps/prepare-stadion-members.js (+14 lines)
  - pipelines/sync-people.js (-44 lines net)
- **Lines of code:** +14, -44 (net -30 lines)
- **Duration:** 109 seconds

## Lessons Learned

**Pattern: ACF field consolidation**
- Consolidating related data onto the main entity (person) vs separate posts simplifies the architecture
- Hash-based change detection automatically handles optional fields - no special tracking needed
- Email reports should focus on entity-level sync stats, not field-level detail

**Pattern: Optional ACF fields**
- Consistent pattern: extract → validate → conditionally add to ACF object
- Null/undefined values excluded from payload (not sent to API)
- Works seamlessly with existing submit-stadion-sync.js logic

---

*Summary generated on 2026-02-06 by Claude Code (GSD executor)*
