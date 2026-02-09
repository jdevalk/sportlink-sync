---
status: resolved
trigger: "birthday-sync-404-errors"
created: 2026-01-28T10:00:00Z
updated: 2026-01-28T08:30:00Z
---

## Current Focus

hypothesis: CONFIRMED - 127 parent records have stadion_id pointing to deleted WordPress persons, causing 404 errors during parent sync (NOT birthday sync)
test: Verified WordPress API returns 404 for sample parent stadion_ids (4942, 4945, 4950)
expecting: Fix needs to handle 404 gracefully and clear stale stadion_id so parents can be re-synced
next_action: Implement fix to detect 404 on parent GET and clear stadion_id + last_synced_hash

## Symptoms

expected: Birthday sync should work - important dates created/updated for all members with birthdates
actual: 127 members getting "Stadion API error (404)" - 0/1068 birthdays synced
errors: All 127 errors show same pattern: "email@domain.com [stadion]: Stadion API error (404)"
reproduction: Run the daily sync - birthday sync step fails for these members
started: Noticed in sync email from 2026-01-28

## Eliminated

## Evidence

- timestamp: 2026-01-28T08:01:00Z
  checked: Remote server logs /home/sportlink/logs/sync-people-2026-01-28.log
  found: 127 errors, all with email addresses (not KNVB IDs), pattern "email@domain.com [stadion]: Stadion API error (404)"
  implication: These are parent records, not member records (parents use email as identifier, members use KNVB ID)

- timestamp: 2026-01-28T08:05:00Z
  checked: Error output location in sync-people.js printSummary function
  found: ERRORS section at line 64-78 aggregates ALL errors (stadion.errors + birthdays.errors), printed AFTER "BIRTHDAY SYNC" header
  implication: The 127 errors are from parent sync (stats.stadion.errors), NOT birthday sync - just printed after the birthday header

- timestamp: 2026-01-28T08:10:00Z
  checked: submit-stadion-sync.js syncParent function (line 210-262)
  found: When updating existing parent (stadion_id exists), it does GET /wp/v2/people/{stadion_id} at line 221 to fetch existing data
  implication: If person was deleted from WordPress, this GET returns 404

- timestamp: 2026-01-28T08:12:00Z
  checked: Database on remote server - parent babyuil@hotmail.com
  found: Has stadion_id = 4942 in stadion_parents table
  implication: Parent record exists in local tracking DB with a stadion_id pointing to (likely deleted) WordPress person

- timestamp: 2026-01-28T08:15:00Z
  checked: WordPress API for person IDs 4942, 4945, 4950 (from failing parents)
  found: All three return "Stadion API error (404)" - persons do not exist in WordPress
  implication: ROOT CAUSE CONFIRMED - Parents have stale stadion_id references to deleted WordPress persons

## Resolution

root_cause: 127 parent records in stadion_parents table have stadion_id pointing to WordPress persons that were deleted. When parent sync tries to GET /wp/v2/people/{stadion_id} to fetch existing data for merging (line 221 in submit-stadion-sync.js), it gets 404 error. Error is caught and logged with parent email, appearing in ERRORS section after BIRTHDAY SYNC header (misleading location).
fix: Modified syncParent function in submit-stadion-sync.js to detect 404 errors when fetching existing person. When 404 is detected, it resets the parent's tracking state (stadion_id and last_synced_hash set to null) and falls through to CREATE path to recreate the parent as a fresh person record.
verification:
files_changed: ['submit-stadion-sync.js']
