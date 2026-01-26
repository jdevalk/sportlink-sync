---
phase: quick-003
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [README.md]
autonomous: true

must_haves:
  truths:
    - "README documents photo sync capability"
    - "README documents team sync capability"
    - "README shows all npm run commands"
  artifacts:
    - path: "README.md"
      provides: "Up-to-date project documentation"
      contains: ["Photo sync", "Team sync", "sync-photos", "sync-teams"]
  key_links: []
---

<objective>
Update README.md to reflect current project state (v1.5) with photo sync and team sync features.

Purpose: Documentation is outdated - missing v1.4 photo sync and v1.5 team sync features.
Output: Updated README.md that accurately describes all current capabilities.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md (authoritative feature list)
@README.md (current documentation to update)
@package.json (npm scripts for reference)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update README with photo and team sync documentation</name>
  <files>README.md</files>
  <action>
Update README.md with the following additions while preserving existing structure:

1. **Features section** (after line 12) - Add two bullets:
   - `- **Photo sync**: Downloads member photos from Sportlink and uploads to Stadion`
   - `- **Team sync**: Extracts teams from Sportlink and syncs to Stadion with work history linking`

2. **Architecture section** - Update sync pipeline (after step 4, before sync-all.js):
   - Add `5. **download-photos-from-sportlink.js** - Browser automation downloads member photos`
   - Add `6. **upload-photos-to-stadion.js** - Uploads photos to Stadion via REST API`
   - Add `7. **prepare-stadion-teams.js** - Extracts team assignments from Sportlink data`
   - Add `8. **submit-stadion-teams.js** - Creates/updates teams in Stadion`
   - Add `9. **submit-stadion-work-history.js** - Links persons to teams via work_history field`
   - Renumber sync-all.js to step 10

3. **Data Flow diagram** - Expand to show photo and team flows:
```
Sportlink Club (browser) → CSV → SQLite (state) → Laposta API
                                      ↓
                              Hash-based diff
                                      ↓
                           Only changed members sync
                                      ↓
                              Stadion WordPress API
                                      ↓
                              Photo download/upload
                                      ↓
                              Team sync + work history
                                      ↓
                              Email report (Postmark)
```

4. **Usage section** - Add new subsections after "Stadion WordPress sync":

### Photo sync

```bash
npm run download-photos           # Download photos from Sportlink
npm run download-photos-verbose   # Same with detailed logging
npm run sync-photos               # Upload photos to Stadion
npm run sync-photos-verbose       # Same with detailed logging
```

Photo sync:
- Downloads member photos from Sportlink when PersonImageDate indicates presence
- Tracks photo state changes (added, updated, removed)
- Uploads photos to Stadion WordPress via REST API
- Deletes photos from Stadion when removed in Sportlink

### Team sync

Team sync is integrated into `sync-all` and runs automatically. Teams are extracted from:
- UnionTeams field (KNVB-assigned teams, preferred)
- ClubTeams field (club-assigned teams, fallback)

The sync:
- Creates teams in Stadion if they don't exist
- Links persons to teams via work_history ACF repeater field
- Tracks team assignments for change detection
- Only sync-created work_history entries are modified (manual entries preserved)

5. **Database section** - Add photo and team tracking:
   Update to: "SQLite database `laposta-sync.sqlite` tracks:
   - Member hashes for change detection
   - Sync state per list
   - Last sync timestamps
   - Member data for Stadion sync
   - Photo state and PersonImageDate for change detection
   - Team assignments and work history indices"

6. **Development section** - Add to debug individual steps:
```bash
npm run download-photos  # Download photos from Sportlink
npm run sync-photos      # Upload photos to Stadion
```
  </action>
  <verify>
    - `grep -q "Photo sync" README.md` returns success
    - `grep -q "Team sync" README.md` returns success
    - `grep -q "sync-photos" README.md` returns success
    - `grep -q "download-photos" README.md` returns success
    - `grep -q "work_history" README.md` returns success
  </verify>
  <done>README.md accurately documents v1.4 photo sync and v1.5 team sync features with usage instructions</done>
</task>

</tasks>

<verification>
- README contains documentation for photo sync feature
- README contains documentation for team sync feature
- All npm scripts from package.json are documented
- Architecture section reflects current pipeline (10 steps)
- Data flow diagram shows photo and team flows
</verification>

<success_criteria>
- README.md updated with complete v1.4 and v1.5 feature documentation
- All new npm scripts documented with usage examples
- Architecture and data flow diagrams updated
</success_criteria>

<output>
After completion, create `.planning/quick/003-update-readme/003-SUMMARY.md`
</output>
