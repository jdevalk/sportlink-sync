---
phase: quick
plan: 016
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/stadion-db.js
  - submit-stadion-sync.js
  - prepare-laposta-members.js
autonomous: true

must_haves:
  truths:
    - "huidig-vrijwilliger value from Stadion API is captured during every person sync"
    - "Laposta members include huidigvrijwilliger field with value '0' or '1'"
    - "Parent entries in Laposta always get huidigvrijwilliger '0'"
  artifacts:
    - path: "lib/stadion-db.js"
      provides: "huidig_vrijwilliger column migration + updateVolunteerStatus + getVolunteerStatusMap functions"
      contains: "huidig_vrijwilliger"
    - path: "submit-stadion-sync.js"
      provides: "Captures huidig-vrijwilliger from Stadion GET/POST responses into DB"
      contains: "updateVolunteerStatus"
    - path: "prepare-laposta-members.js"
      provides: "Adds huidigvrijwilliger to Laposta custom fields from stadion DB"
      contains: "huidigvrijwilliger"
  key_links:
    - from: "submit-stadion-sync.js"
      to: "lib/stadion-db.js"
      via: "updateVolunteerStatus call after sync"
      pattern: "updateVolunteerStatus"
    - from: "prepare-laposta-members.js"
      to: "lib/stadion-db.js"
      via: "getVolunteerStatusMap to build lookup"
      pattern: "getVolunteerStatusMap"
---

<objective>
Sync the computed `huidig-vrijwilliger` field from Stadion back into the sync tool's database, then include it as `huidigvrijwilliger` ("0"/"1") in Laposta member preparation.

Purpose: Laposta email lists need to know who is a current volunteer so segments/campaigns can target them.
Output: Three modified files implementing the full data flow: Stadion API -> stadion-sync.sqlite -> Laposta preparation.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/stadion-db.js (DB layer - add column migration + helper functions)
@submit-stadion-sync.js (Stadion sync - capture volunteer status from API responses)
@prepare-laposta-members.js (Laposta prep - inject huidigvrijwilliger into custom fields)
@field-mapping.json (reference only - do NOT modify, this field comes from Stadion not Sportlink)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add huidig_vrijwilliger column and DB helper functions to stadion-db.js</name>
  <files>lib/stadion-db.js</files>
  <action>
  In `initDb()`, after the last `memberColumns` migration (around line 332, after the `tracked_fields_hash` migration), add:

  ```javascript
  if (!memberColumns.some(col => col.name === 'huidig_vrijwilliger')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN huidig_vrijwilliger INTEGER DEFAULT 0');
  }
  ```

  Add two new functions before `module.exports`:

  1. `updateVolunteerStatus(db, knvbId, status)` - Updates the `huidig_vrijwilliger` column for a given KNVB ID:
  ```javascript
  function updateVolunteerStatus(db, knvbId, status) {
    db.prepare('UPDATE stadion_members SET huidig_vrijwilliger = ? WHERE knvb_id = ?').run(status ? 1 : 0, knvbId);
  }
  ```

  2. `getVolunteerStatusMap(db)` - Returns a Map of knvbId -> volunteerStatus (1 or 0) for ALL members. This is more efficient than per-member lookups:
  ```javascript
  function getVolunteerStatusMap(db) {
    const rows = db.prepare('SELECT knvb_id, huidig_vrijwilliger FROM stadion_members').all();
    const map = new Map();
    for (const row of rows) {
      map.set(row.knvb_id, row.huidig_vrijwilliger || 0);
    }
    return map;
  }
  ```

  Add both functions to `module.exports`: `updateVolunteerStatus, getVolunteerStatusMap`.
  </action>
  <verify>Run `node -e "const db = require('./lib/stadion-db'); const d = db.openDb(); console.log('Column exists:', d.prepare('PRAGMA table_info(stadion_members)').all().some(c => c.name === 'huidig_vrijwilliger')); const m = db.getVolunteerStatusMap(d); console.log('Map type:', m instanceof Map); d.close();"` -- should print `Column exists: true` and `Map type: true`.</verify>
  <done>stadion_members table has huidig_vrijwilliger INTEGER column, updateVolunteerStatus and getVolunteerStatusMap functions exported and working.</done>
</task>

<task type="auto">
  <name>Task 2: Capture huidig-vrijwilliger during Stadion sync in submit-stadion-sync.js</name>
  <files>submit-stadion-sync.js</files>
  <action>
  1. Add `updateVolunteerStatus` to the destructured imports from `./lib/stadion-db` (line 6-20).

  2. In `syncPerson()`, UPDATE path: After the GET request succeeds and `existingData` is set (line 169), extract the volunteer status. Then after the successful PUT (line 209 `updateSyncState(db, knvb_id, source_hash, stadion_id)`), also call `updateVolunteerStatus`:

  After line 209 (`updateSyncState(db, knvb_id, source_hash, stadion_id);`), add:
  ```javascript
  // Capture volunteer status from Stadion
  const volunteerStatus = existingData.acf?.['huidig-vrijwilliger'] === '1' ? 1 : 0;
  updateVolunteerStatus(db, knvb_id, volunteerStatus);
  ```

  3. In `syncPerson()`, CREATE path: After the successful POST (line 248 `updateSyncState(db, knvb_id, source_hash, newId)`), capture from the response body:

  After line 248 (`updateSyncState(db, knvb_id, source_hash, newId);`), add:
  ```javascript
  // Capture volunteer status from Stadion (newly created person defaults)
  const createVolunteerStatus = response.body.acf?.['huidig-vrijwilliger'] === '1' ? 1 : 0;
  updateVolunteerStatus(db, knvb_id, createVolunteerStatus);
  ```

  Note: For the UPDATE path, use `existingData` (from the GET) not the PUT response, since `existingData` is already available and guaranteed to have the ACF fields. For the CREATE path, use `response.body` from the POST response.
  </action>
  <verify>Run `node -c submit-stadion-sync.js` to verify syntax. Then grep: `grep -n "updateVolunteerStatus" submit-stadion-sync.js` should show the import and both call sites (UPDATE and CREATE paths).</verify>
  <done>updateVolunteerStatus is called after both UPDATE and CREATE paths in syncPerson(), capturing the huidig-vrijwilliger value from the Stadion API response into the stadion_members table.</done>
</task>

<task type="auto">
  <name>Task 3: Add huidigvrijwilliger to Laposta member preparation</name>
  <files>prepare-laposta-members.js</files>
  <action>
  1. Add import at the top (after the existing `require('./laposta-db')` block, around line 12):
  ```javascript
  const { openDb: openStadionDb, getVolunteerStatusMap } = require('./lib/stadion-db');
  ```

  2. In `processMembers()` function (line 407), add a `volunteerStatusMap` parameter:
  Change the function signature to:
  ```javascript
  function processMembers(members, mapping, aggregationMaps, volunteerStatusMap) {
  ```

  3. Inside the `members.forEach` loop in `processMembers()` (around line 438), after `buildBaseCustomFields` is called, add the volunteer status to baseCustomFields using the member's PublicPersonId (which is the KNVB ID):
  ```javascript
  const baseCustomFields = buildBaseCustomFields(member, mapping);
  // Add volunteer status from Stadion (not in field-mapping.json, comes from Stadion DB)
  const knvbId = member.PublicPersonId;
  if (knvbId && volunteerStatusMap.has(String(knvbId))) {
    baseCustomFields.huidigvrijwilliger = String(volunteerStatusMap.get(String(knvbId)));
  } else {
    baseCustomFields.huidigvrijwilliger = '0';
  }
  ```

  Note: Use `String(knvbId)` because the DB stores knvb_id as TEXT but Sportlink member data may have it as a number. The value must be a string "0" or "1" for Laposta.

  For parent entries (handled in `buildParentCustomFields` via `buildMemberEntry`), since `baseCustomFields` already has `huidigvrijwilliger` set before being passed to `buildParentCustomFields`, and `buildParentCustomFields` creates a new object from `baseCustomFields`, parent entries will inherit the child's volunteer status. However, parents should always be "0" since they aren't volunteers themselves. To handle this: in `buildMemberEntry()` (line 283), after the parent custom fields are built (after line 311), override for parent entries:
  ```javascript
  // Parents are never volunteers themselves
  if (emailType === 'parent1' || emailType === 'parent2') {
    customFields.huidigvrijwilliger = '0';
  }
  ```
  Add this right after the parent `customFields = buildParentCustomFields(...)` block (after line 311), before the next `if` block on line 315.

  4. In `runPrepare()` (line 504), build the volunteer status map from the stadion DB before calling `processMembers`:
  After line 527 (`const aggregationMaps = buildAggregationMaps(members, mapping);`), add:
  ```javascript
  // Load volunteer status from Stadion DB
  let volunteerStatusMap = new Map();
  try {
    const stadionDb = openStadionDb();
    try {
      volunteerStatusMap = getVolunteerStatusMap(stadionDb);
    } finally {
      stadionDb.close();
    }
  } catch (e) {
    logVerbose('Could not load volunteer status from Stadion DB, defaulting all to 0');
  }
  ```

  5. Update the `processMembers` call on line 528 to pass the map:
  ```javascript
  const { listMembers, excludedCount } = processMembers(members, mapping, aggregationMaps, volunteerStatusMap);
  ```
  </action>
  <verify>Run `node -c prepare-laposta-members.js` to verify syntax. Then run `node -e "const { runPrepare } = require('./prepare-laposta-members'); runPrepare({ verbose: true }).then(r => console.log('Success:', r.success));"` to verify it runs without error and still produces output. Check output for "volunteer status" log line.</verify>
  <done>Laposta member preparation includes huidigvrijwilliger as "0" or "1" for all entries (members get their actual status from Stadion DB, parents always get "0"). Falls back gracefully to "0" if stadion DB is unavailable.</done>
</task>

</tasks>

<verification>
1. `node -c lib/stadion-db.js && node -c submit-stadion-sync.js && node -c prepare-laposta-members.js` -- all three files parse without syntax errors
2. `node -e "const db = require('./lib/stadion-db'); const d = db.openDb(); const m = db.getVolunteerStatusMap(d); console.log('Volunteer map entries:', m.size); d.close();"` -- shows number of entries (0 initially until next sync populates it)
3. `node -e "const { runPrepare } = require('./prepare-laposta-members'); runPrepare({ verbose: true }).then(r => console.log(JSON.stringify(r)));"` -- runs successfully, no errors
</verification>

<success_criteria>
- stadion_members table has huidig_vrijwilliger column (INTEGER, default 0)
- submit-stadion-sync.js captures volunteer status on both UPDATE and CREATE paths
- prepare-laposta-members.js includes huidigvrijwilliger in all Laposta custom fields
- Parent entries always have huidigvrijwilliger "0"
- All three files pass syntax check
- No changes to field-mapping.json (this data comes from Stadion, not Sportlink)
</success_criteria>

<output>
After completion, create `.planning/quick/016-sync-huidig-vrijwilliger-to-laposta/016-SUMMARY.md`
</output>
