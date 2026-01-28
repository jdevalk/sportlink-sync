---
status: resolved
trigger: "First run of sync-commissie-work-history shows '0 added, 0 removed, 2 unchanged' instead of adding new entries"
created: 2026-01-28T10:00:00Z
updated: 2026-01-28T10:20:00Z
---

## Current Focus

hypothesis: CONFIRMED - detectCommissieChanges compares currentCommissies vs tracked history AFTER upsert populates the table
test: traced runSync flow: upsert (line 305) happens BEFORE detectCommissieChanges is called (line 106)
expecting: records appear as "unchanged" because they exist in tracking table when detectCommissieChanges runs
next_action: implement fix - detect changes BEFORE upserting, or change detection logic to check last_synced_hash

## Symptoms

expected: On first run of sync-commissie-work-history.js, it should sync (add) commissie work history entries for members who have functions/committees
actual: Output shows "Member MFDP80E: 0 added, 0 removed, 2 unchanged" - records are treated as unchanged even on first run
errors: No errors, just unexpected "unchanged" behavior
reproduction: Run `node sync-commissie-work-history.js --verbose` for the first time
started: First time running this script

## Eliminated

## Evidence

- timestamp: 2026-01-28T10:05:00Z
  checked: upsertCommissieWorkHistory function (lines 1839-1878)
  found: Inserts records with source_hash but last_synced_hash is NOT set (no column in INSERT)
  implication: Fresh records should have last_synced_hash = NULL, which is correct

- timestamp: 2026-01-28T10:06:00Z
  checked: getCommissieWorkHistoryNeedingSync function (lines 1885-1904)
  found: Query checks "last_synced_hash IS NULL OR last_synced_hash != source_hash"
  implication: Fresh records (last_synced_hash IS NULL) SHOULD be returned as needing sync

- timestamp: 2026-01-28T10:07:00Z
  checked: detectCommissieChanges function (lines 73-83)
  found: Gets trackedHistory from getMemberCommissieWorkHistory, compares commissie_name sets
  implication: If upsertCommissieWorkHistory populates the table BEFORE detectCommissieChanges runs, records appear as "unchanged" not "added"

- timestamp: 2026-01-28T10:10:00Z
  checked: runSync flow (lines 254-340)
  found:
    1. Line 304-306: upsertCommissieWorkHistory(db, workHistoryRecords) - populates tracking table
    2. Line 309: getCommissieWorkHistoryNeedingSync(db, force) - correctly returns records with last_synced_hash IS NULL
    3. Line 333: syncCommissieWorkHistoryForMember calls detectCommissieChanges (line 106)
    4. detectCommissieChanges (line 74): getMemberCommissieWorkHistory gets ALL tracked records (no filter for unsynced)
  implication: ROOT CAUSE CONFIRMED - detectCommissieChanges sees records that were just inserted, treats them as "unchanged" not "added"

## Resolution

root_cause: detectCommissieChanges() compares currentCommissies against ALL tracked records from stadion_commissie_work_history, but the tracking table is populated by upsertCommissieWorkHistory() BEFORE detectCommissieChanges() runs. On first run, this means freshly-inserted records appear as "tracked" even though they haven't been synced to WordPress. The function should only consider records as "tracked" if they have been actually synced (i.e., last_synced_hash IS NOT NULL OR stadion_work_history_id IS NOT NULL).

fix: Modified detectCommissieChanges() to only consider records as "synced" if they have stadion_work_history_id !== null. Records freshly inserted by upsertCommissieWorkHistory() won't have this set, so they'll be treated as "added" not "unchanged".

verification: |
  Code logic verified:
  1. upsertCommissieWorkHistory() inserts records WITHOUT stadion_work_history_id (NULL by default)
  2. stadion_work_history_id is only set by updateCommissieWorkHistorySyncState() AFTER successful WordPress sync
  3. detectCommissieChanges() now filters trackedHistory to only include records where stadion_work_history_id !== null
  4. Result: Fresh records (stadion_work_history_id = NULL) are now correctly treated as "added" instead of "unchanged"

  Cannot test live locally per CLAUDE.md (sync must run on server only).
files_changed:
  - submit-stadion-commissie-work-history.js: modified detectCommissieChanges() to filter for synced records only (lines 75-87)
