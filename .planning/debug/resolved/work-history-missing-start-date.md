---
status: resolved
trigger: "Commissie work history sync doesn't include relation_start date as the begin date"
created: 2026-01-28T10:00:00Z
updated: 2026-01-28T10:05:00Z
---

## Current Focus

hypothesis: CONFIRMED - The buildWorkHistoryEntry function was blanking start_date when isBackfill=true
test: Code review and fix applied
expecting: start_date will now be sent for all commissie work history entries
next_action: N/A - fix complete

## Symptoms

expected: When syncing commissie work history to Stadion, the `relation_start` date from sportlink_member_committees should be sent as the begin/start date of the work_history entry
actual: The start date is not being synced - work history entries are created without a begin date
errors: None - it's a missing feature
reproduction: Run sync-commissie-work-history.js and check resulting work_history in Stadion - no start dates
started: Never implemented - needs to be added

## Eliminated

## Evidence

- timestamp: 2026-01-28T10:00:00Z
  checked: submit-stadion-commissie-work-history.js lines 55-63 (buildWorkHistoryEntry function)
  found: The function explicitly sets start_date to empty string when isBackfill is true. Code: `start_date: isBackfill ? '' : convertDateForACF(startDate)`
  implication: The isBackfill logic is the gate controlling whether start_date is sent

- timestamp: 2026-01-28T10:01:00Z
  checked: submit-stadion-commissie-work-history.js lines 166-175 (where buildWorkHistoryEntry is called)
  found: isBackfill is determined by checking if member has any commissie work history with last_synced_at set. Code on line 167: `const isBackfill = !getMemberCommissieWorkHistory(db, knvb_id).some(h => h.last_synced_at)`
  implication: For initial sync (no prior synced history), isBackfill=true, which blanks out the start_date

- timestamp: 2026-01-28T10:02:00Z
  checked: Stadion API docs (api-leden-crud.md) for work_history field format
  found: work_history entries support start_date field in Y-m-d format (e.g., "2020-08-01")
  implication: The API accepts start_date, it just needs to be sent

- timestamp: 2026-01-28T10:03:00Z
  checked: lib/stadion-db.js - sportlink_member_committees table schema (lines 183-196)
  found: Table has relation_start column that stores the start date
  implication: Source data is available, just not being used correctly

## Resolution

root_cause: The buildWorkHistoryEntry function intentionally blanked start_date when isBackfill=true (line 59: `start_date: isBackfill ? '' : convertDateForACF(startDate)`). This was likely a design choice to avoid setting arbitrary historical dates during initial data migration, but it also prevented legitimate start dates from being synced. The isBackfill check should NOT suppress the start_date - the start date from Sportlink is valid data that should always be synced.

fix:
1. Removed the isBackfill parameter from buildWorkHistoryEntry function
2. Changed start_date assignment to always use convertDateForACF(startDate)
3. Removed the isBackfill calculation and parameter from the call site
4. Updated JSDoc to reflect the parameter change

verification: Syntax check passed (node --check). Full verification requires running on server with production data.

files_changed:
- submit-stadion-commissie-work-history.js (lines 45-62, 165-171)
