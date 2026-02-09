---
phase: quick-18
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/dashboard-db.js
  - lib/run-tracker.js
  - lib/dashboard-queries.js
  - pipelines/sync-people.js
  - pipelines/sync-nikki.js
  - pipelines/sync-functions.js
  - pipelines/sync-teams.js
  - pipelines/sync-freescout.js
  - pipelines/sync-discipline.js
  - pipelines/sync-all.js
  - public/style.css
autonomous: true
must_haves:
  truths:
    - "A pipeline that completes with some item-level errors shows amber/yellow 'partial' status on dashboard"
    - "A pipeline that completes with zero errors shows green 'success' status (unchanged)"
    - "A pipeline whose critical download step fails shows red 'failure' status (unchanged)"
    - "A pipeline that throws an uncaught fatal error shows red 'failure' status (unchanged)"
  artifacts:
    - path: "lib/run-tracker.js"
      provides: "endRun accepts outcome string instead of boolean"
    - path: "lib/dashboard-db.js"
      provides: "Schema migration adding 'partial' to outcome CHECK constraint"
    - path: "public/style.css"
      provides: "Amber/yellow styles for .status-partial and .outcome-partial"
  key_links:
    - from: "pipelines/*.js"
      to: "lib/run-tracker.js"
      via: "tracker.endRun(outcome, stats) with 3-way string"
      pattern: "tracker\\.endRun\\("
---

<objective>
Add a 'partial' outcome state to the dashboard so pipeline runs that complete successfully but have some individual item errors display as amber/yellow warnings, distinct from both green (success, zero errors) and red (failure, critical step failed or uncaught error).

Purpose: Currently a People sync processing 300 members with 2 photo upload failures shows the same red "failure" as a total Sportlink download crash. This makes the dashboard useless for distinguishing "needs attention" from "broken."

Output: Updated run tracker, DB schema, all 7 pipelines, and CSS styles supporting 3-way outcome.
</objective>

<execution_context>
@.planning/quick/18-distinguish-partial-errors-from-pipeline/18-PLAN.md
</execution_context>

<context>
@lib/dashboard-db.js
@lib/run-tracker.js
@lib/dashboard-queries.js
@pipelines/sync-people.js
@pipelines/sync-nikki.js
@pipelines/sync-functions.js
@pipelines/sync-teams.js
@pipelines/sync-freescout.js
@pipelines/sync-discipline.js
@pipelines/sync-all.js
@public/style.css
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add 'partial' to DB schema, update RunTracker.endRun API, add CSS styles, update dashboard-queries</name>
  <files>
    lib/dashboard-db.js
    lib/run-tracker.js
    lib/dashboard-queries.js
    public/style.css
  </files>
  <action>
**lib/dashboard-db.js** - Migrate the `runs` table CHECK constraint to include 'partial':
- SQLite does not support ALTER CHECK constraints, so add a migration step in `initDb()`.
- After the existing CREATE TABLE IF NOT EXISTS block, add:
  ```sql
  -- Migrate: add 'partial' to outcome CHECK constraint
  -- SQLite can't ALTER CHECK, so recreate the table if needed
  ```
- Use a pragmatic approach: check if the constraint already includes 'partial' by attempting an INSERT+ROLLBACK test, or simpler: just recreate the table with the new constraint using the standard SQLite migration pattern (create new table, copy data, drop old, rename).
- **Simplest approach**: Since `CREATE TABLE IF NOT EXISTS` won't alter an existing table, add a separate migration block that runs `ALTER TABLE runs RENAME TO runs_old`, creates the new table with `CHECK(outcome IN ('success', 'failure', 'running', 'partial'))`, copies data with `INSERT INTO runs SELECT * FROM runs_old`, then `DROP TABLE runs_old`. Guard this with a check: only run if the table exists but doesn't support 'partial' yet. A safe way to check: wrap a test INSERT in a savepoint that gets rolled back.
- Apply the same pattern for `run_steps` table: add 'partial' to its CHECK constraint too (for future use, keeps consistency).
- The migration should be wrapped in a transaction and be idempotent (skip if 'partial' already works).

**Concrete migration approach** (recommended for simplicity):
```javascript
// After existing CREATE TABLE blocks in initDb(), add:
// Migration: expand outcome CHECK to include 'partial'
try {
  // Test if 'partial' is already accepted
  db.exec("SAVEPOINT test_partial");
  db.exec("INSERT INTO runs (pipeline, started_at, outcome) VALUES ('__test__', '2000-01-01', 'partial')");
  db.exec("DELETE FROM runs WHERE pipeline = '__test__'");
  db.exec("RELEASE test_partial");
} catch (e) {
  // 'partial' not yet in CHECK constraint - migrate
  db.exec("ROLLBACK TO test_partial");
  db.exec("RELEASE test_partial");

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    ALTER TABLE runs RENAME TO runs_old;
    CREATE TABLE runs (
      -- same columns with updated CHECK
    );
    INSERT INTO runs SELECT * FROM runs_old;
    DROP TABLE runs_old;
    -- Recreate indexes
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
```

**lib/run-tracker.js** - Change `endRun` signature from `endRun(success, stats)` to `endRun(outcome, stats)`:
- The `outcome` parameter now accepts a string: `'success'`, `'partial'`, or `'failure'`.
- For backward compatibility, also accept boolean `true` (maps to `'success'`) and `false` (maps to `'failure'`). This protects against any callers not yet updated. Add at the top of endRun:
  ```javascript
  // Backward compat: accept boolean
  if (outcome === true) outcome = 'success';
  if (outcome === false) outcome = 'failure';
  ```
- Remove the ternary `success ? 'success' : 'failure'` on line 280 and use `outcome` directly in the `_updateRun.run()` call.
- Update the JSDoc to document the new signature.
- Update the CLI self-test at the bottom to pass a string outcome.

**lib/dashboard-queries.js** - Update the "last completed run" query:
- Line 51: Change `outcome IN ('success', 'failure')` to `outcome IN ('success', 'failure', 'partial')` so partial runs count as completed runs for the "previous duration" and overdue calculation.

**public/style.css** - Add amber/yellow styles for partial status:
- Add `.status-partial` (for the overview pipeline cards) with `background: #ffc107` (Bootstrap warning yellow). Place it after `.status-failure` block around line 227.
- Add `.outcome-partial` (for run history table text) with `color: #e0a800; font-weight: 600;`. Place after `.outcome-running` block around line 379.
- Add `.outcome-badge.outcome-partial` (for run detail badge) with `background: #fff3cd; color: #856404;`. Place after `.outcome-badge.outcome-running` block around line 402.
  </action>
  <verify>
Run `node lib/dashboard-db.js` to verify schema migration works without errors on a fresh database. Verify that `node lib/run-tracker.js` self-test still passes (it uses boolean `true` which should backward-compat map to 'success').
  </verify>
  <done>
- dashboard-db.js `initDb()` creates tables with 'partial' in CHECK constraint and migrates existing databases
- run-tracker.js `endRun()` accepts string outcome ('success'|'partial'|'failure') with boolean backward compat
- dashboard-queries.js includes 'partial' in completed-run queries
- style.css has amber/yellow styles for `.status-partial`, `.outcome-partial`, and `.outcome-badge.outcome-partial`
  </done>
</task>

<task type="auto">
  <name>Task 2: Update all 7 pipelines to compute 3-way outcome (success/partial/failure)</name>
  <files>
    pipelines/sync-people.js
    pipelines/sync-nikki.js
    pipelines/sync-functions.js
    pipelines/sync-teams.js
    pipelines/sync-freescout.js
    pipelines/sync-discipline.js
    pipelines/sync-all.js
  </files>
  <action>
For each pipeline, replace the binary `const success = ...` + `tracker.endRun(success, stats)` pattern with 3-way outcome computation. The logic for each pipeline:

**Outcome rules (apply consistently across all pipelines):**
- `'success'`: Zero errors across all steps
- `'partial'`: Some errors occurred, but the pipeline ran to completion (no early abort from critical step failure)
- `'failure'`: Only used for early aborts (critical download/prepare steps failing, or uncaught fatal errors in the outer catch block)

Note: The existing early-abort paths (e.g., Sportlink download failure in sync-people.js lines 139-154) already call `tracker.endRun(false, stats)` and return early. These should change to `tracker.endRun('failure', stats)` (or leave as `false` since backward compat handles it - but prefer explicit string for clarity).

**sync-people.js** (lines 372-376):
Replace:
```javascript
const success = stats.errors.length === 0 &&
                stats.rondoClub.errors.length === 0 &&
                stats.photos.errors.length === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const totalErrors = stats.errors.length + stats.rondoClub.errors.length + stats.photos.errors.length;
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Also update `return { success, stats }` to `return { success: outcome !== 'failure', stats }` (or keep `success: totalErrors === 0` for the return value since the pipeline's own return value is separate from the dashboard outcome). Actually, keep the pipeline return value as `success: totalErrors === 0` for backward compat with email reports and exit codes. Only the tracker outcome changes.

Also update early abort calls:
- Line 148: `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`
- Line 174: `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`
- Line 387 (outer catch): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**sync-nikki.js** (lines 138-139):
Replace:
```javascript
const success = stats.download.errors.length === 0 && stats.rondoClub.errors === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const hasDownloadFailure = stats.download.errors.some(e => e.message && e.message.includes('failed'));
const totalErrors = stats.download.errors.length + (typeof stats.rondoClub.errors === 'number' ? stats.rondoClub.errors : 0);
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Note: Nikki uses `stats.rondoClub.errors` as a number, not an array. The download step's inner try/catch catches exceptions and pushes to errors array, and the download failure check on line 79 pushes an error too. If the download step itself threw (caught at line 91), the error is in `stats.download.errors` - this is already a non-early-abort path, so 'partial' is correct. The outer catch (line 146) should use `tracker.endRun('failure', stats)`.

**sync-functions.js** (lines 273-277):
Replace:
```javascript
const success = stats.download.errors.length === 0 &&
                stats.commissies.errors.length === 0 &&
                stats.workHistory.errors.length === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const totalErrors = stats.download.errors.length + stats.commissies.errors.length + stats.workHistory.errors.length;
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Outer catch (line 289): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**sync-teams.js** (lines 257-261):
Replace:
```javascript
const success = stats.download.errors.length === 0 &&
                stats.teams.errors.length === 0 &&
                stats.workHistory.errors.length === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const totalErrors = stats.download.errors.length + stats.teams.errors.length + stats.workHistory.errors.length;
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Outer catch (line 274): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**sync-freescout.js** (lines 131-133):
Replace:
```javascript
const success = stats.errors.length === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const outcome = stats.errors.length === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Early abort (line 80, credentials not configured): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`
Outer catch (line 144): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**sync-discipline.js** (line 188):
Replace:
```javascript
const success = stats.download.errors.length === 0 && stats.sync.errors.length === 0;
tracker.endRun(success, stats);
```
With:
```javascript
const totalErrors = stats.download.errors.length + stats.sync.errors.length;
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Outer catch (line 201): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**sync-all.js** (lines 783-796):
Replace the long boolean chain with:
```javascript
const allErrorArrays = [
  stats.errors,
  stats.rondoClub.errors,
  stats.teams.errors,
  stats.workHistory.errors,
  stats.functions.errors,
  stats.commissies.errors,
  stats.commissieWorkHistory.errors,
  stats.photos.download.errors,
  stats.photos.upload.errors,
  stats.photos.delete.errors,
  stats.freescout.errors,
  stats.discipline.errors
];
const totalErrors = allErrorArrays.reduce((sum, arr) => sum + arr.length, 0);
const outcome = totalErrors === 0 ? 'success' : 'partial';
tracker.endRun(outcome, stats);
```
Early aborts (lines 392, 410): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`
Outer catch (line 811): `tracker.endRun(false, stats)` -> `tracker.endRun('failure', stats)`

**Important**: Do NOT change the pipeline's own `return { success, stats }` value or the `process.exitCode = 1` logic. These remain based on whether any errors occurred (for email reports and cron monitoring). Only the RunTracker outcome changes to distinguish partial from failure.
  </action>
  <verify>
Run `node lib/run-tracker.js` to verify the self-test still works. Grep all pipeline files to confirm no remaining `endRun(true,` or `endRun(false,` calls exist (all should use string outcomes or the backward-compat booleans only in the self-test).
  </verify>
  <done>
- All 7 pipelines compute 3-way outcome: 'success' (zero errors), 'partial' (some errors, pipeline completed), 'failure' (early abort or fatal error)
- Early abort paths explicitly pass 'failure' string
- Normal completion paths pass 'success' or 'partial' based on error count
- Pipeline return values and exit codes unchanged (backward compatible)
  </done>
</task>

</tasks>

<verification>
1. `node lib/dashboard-db.js` succeeds (schema migration on fresh and existing databases)
2. `node lib/run-tracker.js` self-test succeeds (backward compat with boolean)
3. `grep -r "endRun(true" pipelines/` returns no matches (all migrated to string outcomes)
4. `grep -r "endRun(false" pipelines/` returns no matches (all migrated to 'failure' string)
5. `grep -r "'partial'" lib/dashboard-db.js lib/run-tracker.js lib/dashboard-queries.js public/style.css` confirms 'partial' is referenced in all 4 infrastructure files
6. CSS file contains `.status-partial`, `.outcome-partial`, and `.outcome-badge.outcome-partial` rules
</verification>

<success_criteria>
- Dashboard shows amber/yellow indicator for pipeline runs that completed with some errors
- Dashboard shows green indicator for pipeline runs with zero errors (unchanged behavior)
- Dashboard shows red indicator only for true failures (download crashes, fatal errors)
- Existing historical run data is preserved through schema migration
- Pipeline exit codes and return values are unchanged (no breakage for cron/email monitoring)
</success_criteria>

<output>
After completion, create `.planning/quick/18-distinguish-partial-errors-from-pipeline/18-SUMMARY.md`
</output>
