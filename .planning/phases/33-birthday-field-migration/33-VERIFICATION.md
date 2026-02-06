---
phase: 33-birthday-field-migration
verified: 2026-02-06T11:15:00Z
status: gaps_found
score: 9/11 must-haves verified
gaps:
  - truth: "The people pipeline no longer calls sync-important-dates.js"
    status: partial
    reason: "sync-important-dates.js removed from sync-people.js but still referenced in sync-all.js and package.json"
    artifacts:
      - path: "pipelines/sync-all.js"
        issue: "Line 15 imports runBirthdaySync from sync-important-dates.js"
      - path: "package.json"
        issue: "Lines 43-44 define sync-birthdays npm scripts"
    missing:
      - "Remove import of sync-important-dates from pipelines/sync-all.js"
      - "Remove sync-birthdays scripts from package.json"
      - "Consider deleting steps/sync-important-dates.js entirely (file still exists)"
  - truth: "Email report shows birthdate count inside STADION SYNC section, not a separate BIRTHDAY SYNC section"
    status: partial
    reason: "scripts/install-cron.sh still mentions 'birthdays' as a separate sync concept"
    artifacts:
      - path: "scripts/install-cron.sh"
        issue: "Lines 12, 110, 141 mention 'members, parents, birthdays, photos' as separate items"
    missing:
      - "Update install-cron.sh comments to 'members, parents, photos' (birthdate is now just an ACF field)"
---

# Phase 33: Birthday Field Migration Verification Report

**Phase Goal:** Birthdate syncs as an ACF field on the person record, replacing the separate important_date post lifecycle entirely

**Verified:** 2026-02-06T11:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running sync-people populates acf.birthdate (Y-m-d) on every person in Stadion that has a DateOfBirth | ✓ VERIFIED | Code analysis: extractBirthdate() validates YYYY-MM-DD format, preparePerson() adds to acf object (line 165), submit-stadion-sync.js sends all ACF fields |
| 2 | The people pipeline no longer calls sync-important-dates.js | ⚠️ PARTIAL | sync-people.js correctly removes import and call, BUT sync-all.js line 15 and package.json lines 43-44 still reference sync-important-dates.js |
| 3 | Email report shows birthdate count inside STADION SYNC section, not a separate BIRTHDAY SYNC section | ⚠️ PARTIAL | sync-people.js correctly removes BIRTHDAY SYNC section, BUT install-cron.sh still describes people sync as "members, parents, birthdays, photos" (lines 12, 110, 141) |
| 4 | stadion_important_dates table no longer used by active sync code | ✓ VERIFIED | Grep shows only references in stadion-db.js (deprecated) and sync-important-dates.js (unused). No active pipeline imports it |

**Score:** 2/4 truths fully verified, 2/4 partial

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `steps/prepare-stadion-members.js` | Birthdate extraction and ACF field population | ✓ VERIFIED | extractBirthdate() function exists (line 33), called in preparePerson (line 151), added to acf object (line 165). Validates YYYY-MM-DD format. |
| `steps/prepare-stadion-members.js` | Contains "acf.birthdate" | ✓ VERIFIED | Line 165: `if (birthdate) acf.birthdate = birthdate;` |
| `pipelines/sync-people.js` | Pipeline without birthday sync step | ✓ VERIFIED | No import of sync-important-dates. Goes from Step 4 (Stadion) to Step 5 (Photos). 7 steps total. |
| `pipelines/sync-people.js` | Updated report without BIRTHDAY SYNC section | ✓ VERIFIED | printSummary() has no BIRTHDAY SYNC header. stats.birthdays removed. Only sections: SPORTLINK, LAPOSTA, STADION, PHOTO, REVERSE SYNC, ERRORS. |
| `lib/stadion-db.js` | Deprecated important_dates functions with comments | ✓ VERIFIED | 8 functions marked @deprecated v2.3 (lines 935, 944, 968, 995, 1014, 1041, 1056, 1065). Table schema has deprecation comment (line 64). |
| `docs/pipeline-people.md` | Updated pipeline docs without Step 5 | ✓ VERIFIED | Shows 7-step pipeline (line 18-24). Step 4 mentions birthdate as ACF field (line 106). Field mapping shows birthdate -> YYYY-MM-DD (line 168). |

**Score:** 6/6 artifacts verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| steps/prepare-stadion-members.js | steps/submit-stadion-sync.js | preparePerson returns acf.birthdate in data payload | ✓ WIRED | preparePerson() line 151 extracts birthdate, line 165 adds to acf object, returns in data.acf (line 223-226). submit-stadion-sync.js line 4 imports runPrepare, sends data object with all ACF fields to Stadion API. |
| docs/pipeline-people.md | steps/prepare-stadion-members.js | Documents birthdate as ACF field in person sync | ✓ WIRED | pipeline-people.md line 106 explicitly mentions birthdate as acf.birthdate (v2.3+), line 168 shows field mapping DateOfBirth -> birthdate (YYYY-MM-DD). |

**Score:** 2/2 links verified

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| BDAY-01: Sync birthdate as acf.birthdate field on person | ✓ SATISFIED | All supporting truths verified |
| BDAY-02: Remove sync-important-dates.js step from people pipeline | ✓ SATISFIED | Removed from sync-people.js (truth 2 verified in that context) |
| BDAY-03: Remove or deprecate stadion_important_dates DB table | ✓ SATISFIED | Table and 8 functions marked deprecated (truth 4 verified) |
| BDAY-04: Update email reports to remove birthday sync section | ✓ SATISFIED | BIRTHDAY SYNC section removed from sync-people.js (truth 3 verified in that context) |

**Note:** Requirements are satisfied in the primary context (sync-people.js pipeline), but gaps exist in secondary files (sync-all.js, package.json, install-cron.sh).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| pipelines/sync-all.js | 15 | Import of deprecated sync-important-dates.js | ⚠️ Warning | sync-all pipeline still calls birthday sync as separate step |
| package.json | 43-44 | npm scripts for sync-birthdays | ⚠️ Warning | Documentation inconsistency - users might run these scripts expecting them to work |
| scripts/install-cron.sh | 12, 110, 141 | Comments mention "birthdays" as separate sync item | ℹ️ Info | Minor documentation inconsistency |

### Gaps Summary

**Gap 1: sync-important-dates.js still referenced in sync-all.js and package.json**

The people pipeline (`sync-people.js`) correctly removed all birthday sync references, but:
- `pipelines/sync-all.js` line 15 still imports and calls `runBirthdaySync`
- `package.json` defines `sync-birthdays` and `sync-birthdays-verbose` npm scripts

**Impact:** If a user runs `scripts/sync.sh all`, it will attempt to run the deprecated birthday sync step. The npm scripts are misleading.

**Fix needed:**
1. Remove line 15 from `pipelines/sync-all.js`: `const { runSync: runBirthdaySync } = require('../steps/sync-important-dates');`
2. Remove the birthday sync step call from sync-all.js pipeline execution
3. Remove lines 43-44 from `package.json`
4. Optionally: delete `steps/sync-important-dates.js` entirely (currently unused but still present)

**Gap 2: install-cron.sh describes people sync with birthdays as separate item**

The install-cron.sh script comments still say "4x daily (members, parents, birthdays, photos)" which implies birthdays are a separate sync concept. Since v2.3, birthdate is just an ACF field on the person, not a separate sync step.

**Impact:** Minor documentation inconsistency. Users reading the cron install script might think birthdays need special handling.

**Fix needed:**
1. Update lines 12, 110, 141 in `scripts/install-cron.sh` to say "members, parents, photos" (remove "birthdays" as a separate item)

---

## Verification Details

### Level 1: Existence Check

All required artifacts exist:
- ✓ steps/prepare-stadion-members.js
- ✓ pipelines/sync-people.js
- ✓ lib/stadion-db.js
- ✓ docs/pipeline-people.md

### Level 2: Substantive Check

**steps/prepare-stadion-members.js:**
- File length: 358 lines (substantive)
- Contains `extractBirthdate()` function with validation logic (lines 33-38)
- Contains `if (birthdate) acf.birthdate = birthdate;` (line 165)
- No stub patterns detected
- Has exports and is used by submit-stadion-sync.js

**pipelines/sync-people.js:**
- File length: 386 lines (substantive)
- No references to `sync-important-dates`, `runBirthdaySync`, or `BIRTHDAY SYNC`
- No references to `stats.birthdays`
- printSummary() function has 5 sections (SPORTLINK, LAPOSTA, STADION, PHOTO, REVERSE SYNC) — no BIRTHDAY section
- 7 steps in pipeline (confirmed by reading Step 1-7 comments)

**lib/stadion-db.js:**
- 8 functions marked with `@deprecated v2.3` JSDoc tag
- CREATE TABLE statement has deprecation comment (line 64)
- Functions still exported (backward compatibility)

**docs/pipeline-people.md:**
- Updated pipeline flow shows 7 steps (line 18-24)
- Step 4 description mentions birthdate as ACF field (line 106)
- Field mapping table shows birthdate (line 168)
- No "Step 5: Birthday Sync" section

### Level 3: Wiring Check

**prepare-stadion-members.js → submit-stadion-sync.js:**
- submit-stadion-sync.js line 4 imports `runPrepare` from prepare-stadion-members.js
- prepare-stadion-members.js returns `{ data: { acf: { ... } } }` with birthdate included
- submit-stadion-sync.js sends the entire `data` object to Stadion API (lines 159-161 for PUT, similar for POST)
- Connection verified: birthdate flows from extraction to API submission

**docs → code:**
- pipeline-people.md documents birthdate as ACF field with correct field name and format
- References prepare-stadion-members.js in Source Files table (line 213)
- Field mapping matches code implementation (DateOfBirth -> birthdate YYYY-MM-DD)

### Module Loading

Both files load without errors:
```bash
✓ prepare-stadion-members.js loads successfully
✓ sync-people.js loads successfully
```

### Database Table Verification

`stadion_important_dates` table:
- Table schema present in stadion-db.js with deprecation comment
- 8 associated functions marked `@deprecated v2.3`
- Functions still in module.exports (backward compatibility)
- No active sync code imports or calls these functions (grep confirmed only stadion-db.js and sync-important-dates.js reference them)

---

_Verified: 2026-02-06T11:15:00Z_
_Verifier: Claude (gsd-verifier)_
