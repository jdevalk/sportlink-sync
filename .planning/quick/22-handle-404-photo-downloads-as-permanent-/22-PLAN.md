---
phase: quick-22
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/rondo-club-db.js
  - lib/photo-utils.js
  - steps/download-photos-from-api.js
autonomous: true
must_haves:
  truths:
    - "Members whose Sportlink photo URL returns 404 with body 'Not Found' are marked as 'error' state and not retried on subsequent runs"
    - "404 photo errors are NOT counted in failed/error totals and NOT logged as errors"
    - "When PersonImageDate changes for a member in 'error' state, the member transitions back to 'pending_download' and is retried"
  artifacts:
    - path: "lib/rondo-club-db.js"
      provides: "'error' added to photo_state CHECK constraint with migration for existing databases"
      contains: "error"
    - path: "lib/photo-utils.js"
      provides: "Detection of 404 + 'Not Found' body as a distinct permanent_error result"
      contains: "permanent_error"
    - path: "steps/download-photos-from-api.js"
      provides: "Handling of permanent_error: sets state to 'error', counts as skipped not failed"
      contains: "permanent_error"
  key_links:
    - from: "lib/photo-utils.js"
      to: "steps/download-photos-from-api.js"
      via: "downloadPhotoFromUrl return value"
      pattern: "permanent_error"
    - from: "lib/rondo-club-db.js"
      to: "steps/download-photos-from-api.js"
      via: "updatePhotoState with 'error' value"
      pattern: "updatePhotoState.*error"
    - from: "lib/rondo-club-db.js upsertMembers"
      to: "getMembersNeedingPhotoDownload"
      via: "person_image_date change resets error state to pending_download"
      pattern: "pending_download"
---

<objective>
Handle permanent 404 photo download errors gracefully.

Purpose: Many Sportlink members have a PersonImageDate set but their actual photo URL returns 404 "Not Found". These will never succeed and should not be retried every sync run. By marking them as "error" state, we skip them on future runs unless their PersonImageDate changes (indicating a new photo was uploaded). Critically, these are not treated as errors in script output — they are an accepted reality.

Output: Modified photo state machine with "error" state, 404 detection in photo download, and graceful handling in the download step.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/rondo-club-db.js (photo state columns at ~line 243, upsertMembers at ~line 510, getMembersNeedingPhotoDownload at ~line 867, updatePhotoState at ~line 895)
@lib/photo-utils.js (downloadPhotoFromUrl function)
@steps/download-photos-from-api.js (photo download step)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add 'error' photo state to database and update photo-utils to detect permanent 404s</name>
  <files>lib/rondo-club-db.js, lib/photo-utils.js</files>
  <action>
**In `lib/rondo-club-db.js`:**

1. Add a migration for existing databases to update the CHECK constraint on `photo_state`. After the existing `photo_state` column migration block (~line 250-252), add a new migration that recreates the CHECK constraint to include 'error'. Use this pattern:
   ```sql
   -- Check if 'error' is already allowed by trying to find any row with that state
   -- If the column exists but constraint doesn't include 'error', alter it
   ```
   Since SQLite doesn't support ALTER COLUMN or modifying CHECK constraints directly, the migration approach should be:
   - Create a new column `photo_state_new` with the updated CHECK constraint including 'error'
   - Copy data from `photo_state` to `photo_state_new`
   - Drop `photo_state`
   - Rename `photo_state_new` to `photo_state`

   **IMPORTANT:** SQLite does NOT support DROP COLUMN in older versions. Instead, use a simpler approach: just remove the CHECK constraint migration entirely and replace it. Since the column already exists on production, add a **separate migration block** that:
   - Checks if the migration is needed (e.g., by checking if a pragma or test INSERT of 'error' would fail)
   - Uses the standard SQLite table rebuild pattern: create temp table, copy data, drop original, recreate with new constraint, copy back

   **ACTUALLY, simplest approach:** SQLite CHECK constraints on ALTER TABLE ADD COLUMN are not enforced on existing rows in many SQLite versions, and better-sqlite3 may not enforce them strictly. The safest approach:
   - After the existing photo_state migration block, add a new block that tries to update a test row to 'error' and catches the error. If it fails, we need the rebuild.
   - BUT: better-sqlite3 DOES enforce CHECK constraints on INSERT/UPDATE. So we DO need to handle this.
   - **Best approach:** Use a pragma-based check. Run `PRAGMA table_info(stadion_members)` and check if the `photo_state` column's check constraint already includes 'error'. Since PRAGMA doesn't expose CHECK constraints directly, instead:
     1. Try: `db.exec("UPDATE stadion_members SET photo_state = 'error' WHERE 0")` — this will fail if 'error' is not in the CHECK constraint
     2. If it fails, do the table rebuild

   Here is the exact migration pattern to add after the existing photo_state migration (~line 252):

   ```javascript
   // Migrate photo_state CHECK constraint to include 'error' state
   try {
     // Test if 'error' state is already allowed
     db.exec("UPDATE stadion_members SET photo_state = 'error' WHERE 0");
   } catch (e) {
     // CHECK constraint doesn't include 'error' — rebuild table
     db.exec(`
       CREATE TABLE stadion_members_backup AS SELECT * FROM stadion_members;
       DROP TABLE stadion_members;
     `);
     // Recreate with all columns — copy the CREATE TABLE from the original schema
     // but update the CHECK constraint to include 'error'
     // Then INSERT ... SELECT from backup, then DROP backup
   }
   ```

   **WAIT — this is getting complex.** The stadion_members table has many columns added via ALTER TABLE over time. A full table rebuild is risky.

   **Simplest correct approach:** Since the CHECK constraint was added via ALTER TABLE ADD COLUMN, and SQLite stores it as part of the column definition, we can use a targeted approach. Drop and re-add the column? No, that loses data.

   **FINAL approach — the pragmatic one:** Remove the CHECK constraint entirely by rebuilding just the column:
   1. Add `photo_state_v2 TEXT` column (no CHECK constraint)
   2. Copy `photo_state` values to `photo_state_v2`
   3. Set `photo_state` to NULL for all rows (the CHECK allows existing values)

   No wait, we can't drop columns easily either.

   **ACTUALLY SIMPLEST:** The `photo_state` CHECK constraint was added in an ALTER TABLE. In SQLite, we can work around this by:
   - Adding a NEW column `photo_state_v2 TEXT` with no CHECK constraint
   - Updating it with values from `photo_state`
   - Then having all code use `photo_state_v2`... No, this changes too much.

   **THE REAL SIMPLEST APPROACH:** Just use the standard SQLite table reconstruction:
   1. `PRAGMA foreign_keys=off`
   2. Begin transaction
   3. `CREATE TABLE stadion_members_new (...)` with ALL current columns and the updated CHECK
   4. `INSERT INTO stadion_members_new SELECT * FROM stadion_members`
   5. `DROP TABLE stadion_members`
   6. `ALTER TABLE stadion_members_new RENAME TO stadion_members`
   7. Recreate indexes
   8. Commit
   9. `PRAGMA foreign_keys=on`

   To get the current schema, use: `SELECT sql FROM sqlite_master WHERE type='table' AND name='stadion_members'` — but this will vary between installations.

   **PRAGMATIC FINAL DECISION:** The CHECK constraint was a nice-to-have but is causing migration pain. Replace the approach:
   - Do the test UPDATE as described above
   - If it fails, drop the CHECK constraint by rebuilding the table, but since we don't know the exact current schema (it varies by migration history), take a different approach:
   - Just validate in application code instead. Remove the CHECK constraint entirely using the `sqlite_master` approach.

   OK here is what to ACTUALLY DO (sorry for the deliberation above):

   Add this migration block right after the existing photo_state column check (~line 252):

   ```javascript
   // Migration: expand photo_state to allow 'error' state for permanent download failures
   // SQLite CHECK constraints can't be altered, so test and rebuild if needed
   let needsPhotoStateRebuild = false;
   try {
     db.exec("UPDATE stadion_members SET photo_state = 'error' WHERE 0");
   } catch {
     needsPhotoStateRebuild = true;
   }

   if (needsPhotoStateRebuild) {
     // Get current table schema and replace the CHECK constraint
     const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stadion_members'").get().sql;
     const newSql = currentSql.replace(
       /CHECK\(photo_state IN \([^)]+\)\)/,
       "CHECK(photo_state IN ('no_photo', 'pending_download', 'downloaded', 'pending_upload', 'synced', 'pending_delete', 'error'))"
     ).replace('stadion_members', 'stadion_members_new');

     // Get all index definitions
     const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='stadion_members' AND sql IS NOT NULL").all();

     db.pragma('foreign_keys = OFF');
     db.transaction(() => {
       db.exec(newSql);
       db.exec('INSERT INTO stadion_members_new SELECT * FROM stadion_members');
       db.exec('DROP TABLE stadion_members');
       db.exec('ALTER TABLE stadion_members_new RENAME TO stadion_members');
       // Recreate indexes
       for (const idx of indexes) {
         db.exec(idx.sql);
       }
     })();
     db.pragma('foreign_keys = ON');
   }
   ```

2. In the `upsertMembers` function (~line 544), update the ON CONFLICT photo_state CASE expression. The "Photo removed" branch currently checks:
   ```sql
   AND stadion_members.photo_state IN ('synced', 'pending_upload', 'downloaded', 'pending_download')
   ```
   Add `'error'` to this list so that if a photo date goes NULL and the member was in error state, it transitions to `pending_delete` (which will clear the state):
   ```sql
   AND stadion_members.photo_state IN ('synced', 'pending_upload', 'downloaded', 'pending_download', 'error')
   ```

**In `lib/photo-utils.js`:**

3. Modify `downloadPhotoFromUrl` to detect the specific 404 + "Not Found\n" pattern. When `response.ok` is false (line 59-61), before returning `{ success: false }`, check:
   ```javascript
   if (response.status === 404) {
     const body = await response.text();
     if (body === 'Not Found\n' || body === 'Not Found') {
       logger.verbose(`    Photo permanently unavailable (404 Not Found)`);
       return { success: false, permanent_error: true };
     }
   }
   ```
   The existing `{ success: false }` return on line 61 stays as the fallback for other HTTP errors.
  </action>
  <verify>
Run `node -e "const db = require('./lib/rondo-club-db'); const d = db.openDb(); d.exec(\"UPDATE stadion_members SET photo_state = 'error' WHERE 0\"); console.log('CHECK constraint accepts error'); d.close()"` — should print "CHECK constraint accepts error" without throwing.

Run `node -e "const { downloadPhotoFromUrl } = require('./lib/photo-utils'); console.log(typeof downloadPhotoFromUrl)"` — should print "function".
  </verify>
  <done>
The photo_state CHECK constraint includes 'error' on both fresh and existing databases. The `downloadPhotoFromUrl` function returns `{ success: false, permanent_error: true }` when it encounters a 404 with "Not Found" body. The upsertMembers ON CONFLICT handles the 'error' state correctly for both "photo changed" and "photo removed" transitions.
  </done>
</task>

<task type="auto">
  <name>Task 2: Handle permanent 404 errors in download step without counting as failures</name>
  <files>steps/download-photos-from-api.js</files>
  <action>
Modify `steps/download-photos-from-api.js` to handle the new `permanent_error` result from `downloadPhotoFromUrl`:

1. Add a `skipped` counter to the result object (after `failed` on line 28):
   ```javascript
   const result = {
     success: true,
     total: 0,
     downloaded: 0,
     skipped: 0,
     failed: 0,
     errors: []
   };
   ```

2. After the `downloadPhotoFromUrl` call (~line 104), check for permanent_error BEFORE the existing success check. Replace the block at lines 106-113:
   ```javascript
   if (photoResult.permanent_error) {
     // Photo URL returns 404 "Not Found" — this is permanent, not an error
     updatePhotoState(db, member.knvb_id, 'error');
     result.skipped++;
     logger.verbose(`    Photo unavailable (404) — marked as permanent error, will retry if PersonImageDate changes`);
   } else if (photoResult.success) {
     updatePhotoState(db, member.knvb_id, 'downloaded');
     result.downloaded++;
     logger.verbose(`    Saved ${path.basename(photoResult.path)} (${photoResult.bytes} bytes)`);
   } else {
     result.failed++;
     result.errors.push({ knvb_id: member.knvb_id, message: 'Photo download failed' });
   }
   ```

3. Update the summary logging at the end (~lines 131-134). Add skipped to the summary:
   ```javascript
   logger.log(`Photos: ${result.downloaded} downloaded, ${result.skipped} unavailable, ${result.failed} failed (${result.total} total)`);
   ```
   Remove the separate failed log line since it's now in the summary.

4. Keep the `result.success` check on line 137 as-is: only errors (real failures) cause `success: false`. Skipped permanent 404s do NOT affect success.
  </action>
  <verify>
Run `node -c steps/download-photos-from-api.js` — should exit 0 (syntax valid).

Run `node -e "const { runPhotoDownload } = require('./steps/download-photos-from-api'); console.log(typeof runPhotoDownload)"` — should print "function".

Verify the result object includes `skipped`: `node -e "
const mod = require('./steps/download-photos-from-api');
// Can't run full function without browser, but module loads
console.log('Module loaded successfully');
"` — should print "Module loaded successfully".
  </verify>
  <done>
The download step handles permanent 404 errors by setting photo_state to 'error' and counting them as skipped (not failed). The summary log shows downloaded/unavailable/failed counts. Permanent 404s do not affect the success flag, do not appear in the errors array, and will not be retried unless PersonImageDate changes.
  </done>
</task>

</tasks>

<verification>
1. Database migration: Run `openDb()` on existing database — 'error' state should be accepted in CHECK constraint
2. Photo utils: `downloadPhotoFromUrl` returns `{ success: false, permanent_error: true }` for 404 + "Not Found" body
3. Download step: Members with permanent 404 get `photo_state = 'error'` and are excluded from `getMembersNeedingPhotoDownload` (which only selects `pending_download`)
4. Re-download trigger: If a member in 'error' state gets a new `person_image_date` via upsertMembers, their state transitions back to `pending_download`
5. All scripts load without syntax errors: `node -c lib/rondo-club-db.js && node -c lib/photo-utils.js && node -c steps/download-photos-from-api.js`
</verification>

<success_criteria>
- Members with permanently unavailable photos (404 "Not Found") are marked as 'error' and not retried
- 404 photo errors are counted as "unavailable" (skipped), not as failures
- The script's success flag and error totals are not affected by permanent 404s
- A change in PersonImageDate resets 'error' state back to 'pending_download' for retry
- No existing photo state transitions are broken
</success_criteria>

<output>
After completion, create `.planning/quick/22-handle-404-photo-downloads-as-permanent-/22-SUMMARY.md`
</output>
