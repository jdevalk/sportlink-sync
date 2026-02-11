---
phase: 41-database-migration
verified: 2026-02-11T07:29:41Z
status: human_needed
score: 7/7 truths verified
re_verification: false
human_verification:
  - test: "Run sync on production server after deploying Phase 41 + Phase 42"
    expected: "All pipelines run without errors, new column names used in queries"
    why_human: "Migration runs automatically on openDb() and modifies production database. Must verify on actual production server with real data, not locally."
  - test: "Check actual database schema on production server"
    expected: "All tables use rondo_club_* naming, all columns use rondo_club_id and *_rondo_club_modified"
    why_human: "Database file is on remote server (46.202.155.16), cannot verify actual schema from local codebase"
---

# Phase 41: Database Migration Verification Report

**Phase Goal:** Rename SQLite tables and columns from stadion to rondo_club
**Verified:** 2026-02-11T07:29:41Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All stadion_* tables renamed to rondo_club_* in database layer | ✓ VERIFIED | Migration function creates 8 rondo_club_* tables via CREATE+INSERT+DROP. initDb() schema uses rondo_club_* names. |
| 2 | All stadion_id columns renamed to rondo_club_id | ✓ VERIFIED | Found rondo_club_id in: rondo_club_members, parents, teams, commissies schemas. discipline_cases uses ALTER TABLE RENAME COLUMN migration. |
| 3 | All *_stadion_modified columns renamed to *_rondo_club_modified | ✓ VERIFIED | Migration maps _stadion_modified suffix to _rondo_club_modified. Schema defines 7 tracked fields with _rondo_club_modified. |
| 4 | Migration functions are idempotent and safe | ✓ VERIFIED | rondo-club-db: checks for stadion_members existence. discipline-db: checks for stadion_id column. Both return early if already migrated. |
| 5 | All SQL queries in lib/ use new naming | ✓ VERIFIED | Verified 12 FROM, 3 INSERT, 7 UPDATE statements use rondo_club_* tables. Sample functions (getMembersNeedingSync, updateSyncState) use rondo_club_id. |
| 6 | No stadion references remain in lib/ except migration code | ✓ VERIFIED | rondo-club-db.js: 41 refs (all in migration). discipline-db.js: 3 refs (migration only). conflict-resolver.js: 0 refs. sync-origin.js: 0 refs. detect-rondo-club-changes.js: 0 refs. |
| 7 | sync_origin constants updated to rondo_club | ✓ VERIFIED | SYNC_FORWARD = 'sync_sportlink_to_rondo_club', SYNC_REVERSE = 'sync_rondo_club_to_sportlink'. getTimestampColumnNames returns rondo_club key. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/rondo-club-db.js` | Migration function + updated schema + query layer | ✓ VERIFIED | migrateStadionToRondoClub() exists (line 21), wired in openDb() (line 376). initDb() uses rondo_club_* tables. 80+ query functions updated. |
| `lib/discipline-db.js` | ALTER TABLE migration + query updates | ✓ VERIFIED | migrateStadionToRondoClub() uses ALTER TABLE RENAME COLUMN (line 37). All queries use rondo_club_id. |
| `lib/conflict-resolver.js` | Variable/return value updates to rondo_club | ✓ VERIFIED | rondoClubData, rondoClubValue, rondoClubTs variables. Returns rondo_club_value, rondo_club_modified. Self-tests pass. |
| `lib/sync-origin.js` | Updated constants | ✓ VERIFIED | SYNC_FORWARD/SYNC_REVERSE use rondo_club. getTimestampColumnNames returns {rondo_club, sportlink}. |
| `lib/detect-rondo-club-changes.js` | Query updates | ✓ VERIFIED | 0 stadion references. Uses rondo_club_* naming. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| lib/rondo-club-db.js | data/rondo-sync.sqlite | openDb() calls migration after pragmas, before initDb | ✓ WIRED | Line 376: migrateStadionToRondoClub(db) between pragmas and initDb |
| lib/discipline-db.js | data/discipline-sync.sqlite | openDb() with ALTER TABLE migration | ✓ WIRED | Migration checks for stadion_id column, renames to rondo_club_id |
| lib/sync-origin.js | lib/rondo-club-db.js | SYNC_FORWARD/SYNC_REVERSE constants used in sync_origin updates | ✓ WIRED | Migration lines 110, 115 use new constant values |
| lib/conflict-resolver.js | lib/sync-origin.js | getTimestampColumnNames returns rondo_club key | ✓ WIRED | Line 27 uses cols.rondo_club from getTimestampColumnNames() |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| DB-01: All stadion_* tables renamed to rondo_club_* | ✓ SATISFIED | 8 tables migrated in rondo-club-db, initDb() creates rondo_club_* tables |
| DB-02: All stadion_id columns renamed to rondo_club_id | ✓ SATISFIED | Migration maps stadion_id → rondo_club_id across all tables. discipline_cases uses ALTER TABLE. |
| DB-03: All *_stadion_modified columns renamed | ✓ SATISFIED | 7 tracked fields have _rondo_club_modified columns in schema and migration |
| DB-04: Migration runs safely on live server | ? NEEDS HUMAN | Code is idempotent and transactional, but actual server execution not verified locally |

### Anti-Patterns Found

None found.

**Scanned files:**
- lib/rondo-club-db.js (2899 lines)
- lib/discipline-db.js (361 lines)
- lib/conflict-resolver.js (275 lines)
- lib/sync-origin.js (107 lines)
- lib/detect-rondo-club-changes.js

**Checks:**
- TODO/FIXME/XXX/HACK: None found
- Stub implementations: None found (return null statements are valid error handling)
- Empty handlers: None found
- Console.log-only implementations: None found

### Human Verification Required

#### 1. Production Database Migration Execution

**Test:** Deploy Phase 41 + Phase 42 to production server (46.202.155.16) and verify migration runs successfully
**Expected:** 
- Migration completes without errors
- All 8 tables renamed from stadion_* to rondo_club_*
- All data preserved (3,675 members, 386 parents, 61 teams per SUMMARY)
- Can verify with: `node -e "const db = require('./lib/rondo-club-db').openDb(); const count = db.prepare('SELECT COUNT(*) as c FROM rondo_club_members').get(); console.log(count.c); db.close()"`
**Why human:** Database file lives on remote server. Migration runs on first openDb() call. Cannot verify actual database schema from local codebase alone.

#### 2. Sync Pipeline Execution After Migration

**Test:** Run all sync pipelines on production after Phase 41 + Phase 42 deployment
**Expected:**
- scripts/sync.sh people completes successfully
- scripts/sync.sh teams completes successfully
- scripts/sync.sh discipline completes successfully
- scripts/sync.sh functions completes successfully
- No "no such table" or "no such column" errors in logs
**Why human:** Phase 41 renames database layer, Phase 42 updates consuming code (steps/, pipelines/, tools/). Must verify atomically on production. Cannot run sync locally per CRITICAL warning in CLAUDE.md.

#### 3. Verify No Regressions in steps/ and tools/ Files

**Test:** After Phase 42 completion, verify steps/ and tools/ files use new naming
**Expected:**
- steps/submit-rondo-club-sync.js uses member.rondo_club_id (not stadion_id)
- steps/submit-discipline-cases.js uses case.rondo_club_id
- tools/validate-rondo-club-ids.js uses rondo_club_id column
- All 22 files (11 steps + 3 pipelines + 8 tools) updated
**Why human:** Phase 41 scope is database layer only. Phase 42 must update code references. This verification bridges both phases.

### Critical Deployment Notes

**BLOCKER:** Phase 41 MUST NOT be deployed to production without Phase 42 (Code References).

**Why:**
- Plan 41-01 migration runs automatically on `openDb()`
- Migration renames tables from stadion_* to rondo_club_*
- Current steps/, pipelines/, tools/ files (22 files total) still reference old naming
- Deploying Phase 41 alone will cause runtime errors: "no such table stadion_members"

**Safe deployment path:**
1. Complete Phase 42 (Code References) - updates steps/, pipelines/, tools/
2. Test Phase 41 + Phase 42 on production server
3. Deploy both phases atomically (single deployment)
4. Run verification tests (human verification items above)

**Evidence of incomplete work:**
```bash
# Files still using stadion naming (Phase 42 scope):
steps/submit-rondo-club-sync.js
steps/download-functions-from-sportlink.js
steps/prepare-freescout-customers.js
# ... 19 more files
```

---

_Verified: 2026-02-11T07:29:41Z_
_Verifier: Claude (gsd-verifier)_
