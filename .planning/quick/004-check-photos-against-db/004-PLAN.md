---
type: quick
task: 004
name: check-photos-against-db
autonomous: true
files_modified:
  - check-photo-consistency.js
  - package.json
---

<objective>
Create a script that checks the local photos directory against the database state, identifying missing photos that should be marked for re-download from Sportlink.

Purpose: After a failed photo download or accidental deletion, photos may be missing from the local `photos/` directory while the database still shows them as `downloaded` or `synced`. This script detects these inconsistencies and marks affected members for re-download.

Output: A CLI script `check-photo-consistency.js` that:
1. Reads all members with photo_state 'downloaded' or 'synced' from the database
2. Checks if the corresponding photo file exists in `photos/` directory
3. Reports missing photos
4. With `--fix` flag, updates database state to 'pending_download' for missing photos
</objective>

<context>
@download-photos-from-sportlink.js
@upload-photos-to-stadion.js
@lib/stadion-db.js

Key database facts:
- Table: `stadion_members`
- Column: `photo_state` - tracks photo sync state ('no_photo', 'pending_download', 'downloaded', 'pending_upload', 'synced', 'pending_delete')
- Column: `person_image_date` - timestamp of photo in Sportlink (used to detect changes)
- Photos stored as `photos/{knvb_id}.{ext}` (ext: jpg, jpeg, png, webp, gif)

Existing functions in lib/stadion-db.js:
- `getMembersByPhotoState(db, state)` - get members by photo state
- `updatePhotoState(db, knvbId, newState)` - update photo state for a member
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create check-photo-consistency.js script</name>
  <files>check-photo-consistency.js</files>
  <action>
Create a CLI script that:

1. Opens the database connection using `openDb()` from lib/stadion-db.js

2. Queries members where `photo_state IN ('downloaded', 'synced')` - these should have local photos

3. For each member, check if photo file exists using the same logic as `findPhotoFile()` in upload-photos-to-stadion.js:
   - Check for files: `{knvb_id}.jpg`, `{knvb_id}.jpeg`, `{knvb_id}.png`, `{knvb_id}.webp`, `{knvb_id}.gif`
   - If none found, photo is missing

4. Report findings:
   - Total members checked
   - Members with photos present
   - Members with missing photos (list KNVB IDs)

5. With `--fix` flag:
   - Update `photo_state` to `'pending_download'` for members with missing photos
   - Use existing `updatePhotoState()` function
   - Report how many were marked for re-download

6. CLI options:
   - `--fix` - actually update database (default: dry-run report only)
   - `--verbose` - show detailed progress

Follow existing code patterns:
- Module/CLI hybrid pattern (export function + require.main check)
- Use createSyncLogger from lib/logger.js
- Exit code 0 on success, 1 on errors
  </action>
  <verify>
Run `node check-photo-consistency.js` and verify it:
- Connects to database
- Reports photo consistency status
- Does NOT modify database without --fix flag
  </verify>
  <done>
Script exists and correctly identifies members whose photos are in 'downloaded' or 'synced' state but have no corresponding file in photos/ directory.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add npm script</name>
  <files>package.json</files>
  <action>
Add npm script for the new consistency checker:

```json
"check-photo-consistency": "node check-photo-consistency.js"
```

Place it near the other photo-related scripts (after `upload-photos` or similar).
  </action>
  <verify>
Run `npm run check-photo-consistency` and confirm it executes the script.
  </verify>
  <done>
`npm run check-photo-consistency` runs the photo consistency check script.
  </done>
</task>

</tasks>

<verification>
1. `node check-photo-consistency.js` runs without errors
2. Script correctly identifies missing photos (test by temporarily renaming a photo file)
3. `--fix` flag updates database state appropriately
4. `npm run check-photo-consistency` works
</verification>

<success_criteria>
- Script identifies inconsistencies between database photo_state and actual files
- Dry-run mode (default) only reports, does not modify
- Fix mode marks missing photos for re-download
- Follows existing codebase patterns
</success_criteria>

<output>
After completion, update `.planning/STATE.md` with quick task completion record.
</output>
