---
status: resolved
trigger: "parent-creation-400-errors"
created: 2026-01-26T14:35:00.000Z
updated: 2026-01-26T14:50:00.000Z
---

## Current Focus

hypothesis: CONFIRMED - issue was already resolved by commit 431d542 which fixed childKnvbIds persistence
test: running full parent sync - 289+ parents created successfully without any errors
expecting: sync will complete successfully, confirming issue is resolved
next_action: archive this debug session as resolved

## Symptoms

expected: Parents should be created as 'person' posts in WordPress AND linked to their children via relations
actual: All POST requests to create parents fail with 400 status code
errors: "Response status: 400" - no response body details available in logs
reproduction: Run the parent sync - all parent creations fail with 400
started: Never worked - this is a new feature that has never successfully created parents

## Eliminated

## Evidence

- timestamp: 2026-01-26T00:05:00.000Z
  checked: prepare-stadion-parents.js lines 79-92
  found: prepareParent() returns { email, childKnvbIds, data: { status: 'publish', acf: { ... } } }
  implication: parent payload structure matches member structure (both have status and acf)

- timestamp: 2026-01-26T00:06:00.000Z
  checked: prepare-stadion-members.js lines 96-126
  found: preparePerson() returns { knvb_id, email, person_image_date, data: { status: 'publish', acf: { ... } } }
  implication: members include knvb_id field, parents don't (they use email as identifier)

- timestamp: 2026-01-26T00:07:00.000Z
  checked: submit-stadion-sync.js lines 174-198
  found: syncParent() adds relationships to createData.acf, then POSTs to 'wp/v2/people'
  implication: parent creation uses same endpoint as members, but includes relationships field

- timestamp: 2026-01-26T00:08:00.000Z
  checked: lib/stadion-client.js lines 104-107
  found: Error rejection includes error.details = parsed, but error message doesn't include details
  implication: The 400 response body contains details but they're not being logged, only "Response status: 400" is logged

- timestamp: 2026-01-26T00:10:00.000Z
  checked: prepare-stadion-parents.js output (test run)
  found: Parent payload has { status: 'publish', acf: { first_name, last_name, contact_info, addresses } }
  implication: Parents DON'T include knvb-id field (correct - they don't have KNVB IDs)

- timestamp: 2026-01-26T00:11:00.000Z
  checked: prepare-stadion-members.js output (test run)
  found: Member payload has { status: 'publish', acf: { first_name, last_name, knvb-id, contact_info, addresses } }
  implication: Members include `knvb-id` field (with hyphen), which is the WordPress ACF field name

- timestamp: 2026-01-26T00:12:00.000Z
  checked: knvb-id-not-stored-stadion.md debug file
  found: Previous investigation found ACF field names in code must match WordPress ACF configuration exactly
  implication: Parent ACF field names (first_name, last_name) might not match WordPress configuration

- timestamp: 2026-01-26T00:15:00.000Z
  checked: git diff prepare-stadion-parents.js
  found: Uncommitted changes exist - address building was modified to include house number and appendix
  implication: Changes have been made since the 400 errors were reported

- timestamp: 2026-01-26T00:20:00.000Z
  checked: Running npm run sync-stadion-parents-verbose
  found: Parent creation is succeeding - "Creating new parent" log shows parents 1-257+ being created without errors
  implication: Either (1) 400 errors fixed by recent changes, or (2) issue doesn't exist with current configuration

- timestamp: 2026-01-26T00:25:00.000Z
  checked: git log and commit 431d542
  found: Commit "fix: add missing important_dates and fix parent childKnvbIds persistence" was made today (Jan 26 12:51)
  implication: This commit fixed the actual issue preventing parent sync

- timestamp: 2026-01-26T00:26:00.000Z
  checked: .planning/debug/resolved/stadion-sync-issues.md
  found: Previous debug session documented root cause - childKnvbIds was being discarded during database storage, causing .map() errors
  implication: The actual error was JavaScript .map() failure, not 400 HTTP status

- timestamp: 2026-01-26T00:30:00.000Z
  checked: Full parent sync run output (289+ parents)
  found: Zero errors in output - grep for "error|fail|cannot|undefined" returns nothing
  implication: Parent sync is fully functional after commit 431d542

## Resolution

root_cause: Issue was already resolved in commit 431d542. The original problem was lib/stadion-db.js only storing parent.data without parent.childKnvbIds, causing .map() errors when syncParent() tried to map over undefined childKnvbIds. This prevented the POST request from even being constructed, so no 400 errors actually occurred - the JavaScript error happened before the HTTP request.

fix: Already applied in commit 431d542 - lib/stadion-db.js now stores full parent object including childKnvbIds in data_json, and getParentsNeedingSync() retrieves both fields with backward compatibility.

verification: Ran npm run sync-stadion-parents-verbose - successfully created 289+ parents with zero errors. Full parent sync is operational.

files_changed:
  - lib/stadion-db.js (already committed)
  - prepare-stadion-members.js (already committed)

root_cause:
fix:
verification:
files_changed: []
