---
status: resolved
trigger: "team-ids-zero"
created: 2026-01-26T10:00:00Z
updated: 2026-01-26T10:00:00Z
---

## Current Focus

hypothesis: Team sync fails because Sportlink source data contains invalid team names (single digits)
test: Filter out invalid team names (single digits) in prepare-stadion-teams.js
expecting: Clean team list that can sync successfully to Stadion
next_action: Add validation filter to extractTeamName function

## Symptoms

expected: Teams in local database should have correct Stadion WordPress IDs so work_history can reference them
actual: Local database has ID 0 for all teams, work_history entries can't reference actual teams
errors: "Created work_history for team recreanten zondag (index 0)" - index 0 is debug output showing all teams have same/zero ID
reproduction: Run sync - work_history entries don't link to real teams
started: Existing issue - work history has never been tied to teams directly

## Eliminated

## Evidence

- timestamp: 2026-01-26T10:05:00Z
  checked: Database structure
  found: Two separate databases - laposta-sync.sqlite (26M) and stadion-sync.sqlite (1.7M). Teams are stored in stadion-sync.sqlite
  implication: Teams are tracked separately from Laposta members

- timestamp: 2026-01-26T10:06:00Z
  checked: stadion-sync.sqlite stadion_teams table
  found: Teams exist with mostly empty names (1|, 2|, etc) and stadion_id values
  implication: Team sync has happened but team names are corrupt/missing

- timestamp: 2026-01-26T10:07:00Z
  checked: lib/stadion-db.js
  found: Complete team CRUD functions exist - upsertTeams, getTeamsNeedingSync, updateTeamSyncState, getAllTeams
  implication: Infrastructure exists for team sync

- timestamp: 2026-01-26T10:08:00Z
  checked: submit-stadion-teams.js
  found: Full team sync script exists - prepares teams from Sportlink, upserts to DB, syncs to Stadion API, updates stadion_id
  implication: Team sync mechanism exists and should be populating stadion_ids

- timestamp: 2026-01-26T10:10:00Z
  checked: sync-all.js integration
  found: Team sync IS integrated at line 393 - runTeamSync is called after member sync
  implication: Team sync should be running automatically

- timestamp: 2026-01-26T10:11:00Z
  checked: stadion_teams table data
  found: 76 teams total, 0 have stadion_id populated. Team names look corrupted - "1", "2", "2, JO7-1" instead of full team names
  implication: Team sync ran but failed to populate stadion_ids, OR team names are corrupted in the source data

- timestamp: 2026-01-26T10:15:00Z
  checked: Sportlink source data in Members array
  found: 170+ members have UnionTeams set to single digits ("1", "2", "3", "4", "5") - these are invalid/placeholder team names
  implication: These invalid team names are being extracted and stored, causing team sync to fail

- timestamp: 2026-01-26T10:16:00Z
  checked: Team extraction logic in prepare-stadion-teams.js
  found: extractTeamName() has NO validation - it accepts any non-empty string from UnionTeams/ClubTeams
  implication: Invalid team names pass through unchecked into database and sync attempts

## Resolution

root_cause: Sportlink data contains invalid team names (single-digit numbers like "1", "2", "3") in UnionTeams field. The prepare-stadion-teams.js script extracts ALL non-empty team names without validation, so these invalid names get stored in the database and attempted to sync to Stadion API (which fails or creates invalid teams). This prevents real teams from being linked in work_history.
fix: Added isValidTeamName() validation function to filter out single-digit team names. Modified extractTeamName() to use validation. Updated team splitting logic to filter each split team name. Cleared invalid teams from database and resynced.
verification:
1. Ran node submit-stadion-teams.js --force - all 53 valid teams synced successfully with stadion_ids (3473-3525)
2. Verified getAllTeams() returns 53 teams with proper ID mappings
3. Checked work_history table - team references properly link to stadion_teams.stadion_id
4. Cleaned up 172 invalid work_history records with single-digit team names
5. Work history can now properly reference real teams via stadion_id

Result: Teams now have valid stadion_ids. Work history entries reference these teams correctly. The --force flag can be used to resync teams at any time if needed.
files_changed: ['prepare-stadion-teams.js']
