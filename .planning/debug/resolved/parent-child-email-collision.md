---
status: resolved
trigger: "When a parent and child share an email address, the child's data gets merged with the parent and the child is not created as a separate person record in Stadion."
created: 2026-01-26T10:00:00Z
updated: 2026-01-26T10:15:00Z
---

## Current Focus

hypothesis: CONFIRMED - findPersonByEmail returns ID based on email only, syncParent needs to verify name match before treating as duplicate
test: Implement fix - fetch person details and compare names before merging
expecting: Parent and child with same email but different names will create separate records
next_action: Modify syncParent to check name match after finding person by email

## Symptoms

expected: Both parent and child should be created as separate person records in Stadion, even if they share an email address. People are only duplicates when BOTH name AND email match.
actual: The child's data is merged with the parent's data, and the child is not created as a separate record. The child disappears from Stadion.
errors: None reported - sync completes without errors
reproduction: Parent and child share the same email address in Sportlink
started: Started after recent changes - specifically the find-by-email endpoint changes (commit 0ba1f5b "feat: use dedicated find-by-email endpoint and add reset-parents option")

## Eliminated

## Evidence

- timestamp: 2026-01-26T10:05:00Z
  checked: submit-stadion-sync.js lines 108-130 (findPersonByEmail function)
  found: Function only searches by email, returns first person with matching email regardless of name
  implication: When parent and child share email, findPersonByEmail returns the child's ID

- timestamp: 2026-01-26T10:06:00Z
  checked: submit-stadion-sync.js lines 158-165 (syncParent email lookup)
  found: "If no stadion_id yet, check if person already exists by email (e.g., they're also a member)" - uses findPersonByEmail which returns child's ID
  implication: Parent data then updates the child's record instead of creating new parent record

- timestamp: 2026-01-26T10:07:00Z
  checked: submit-stadion-sync.js lines 167-210 (update path in syncParent)
  found: When stadion_id is set (from findPersonByEmail), it only updates relationships, but doesn't prevent name collision - child's name stays, parent's data is lost
  implication: Child record keeps child's name/data but gets parent relationships added

- timestamp: 2026-01-26T10:09:00Z
  checked: git commit 0ba1f5b that introduced find-by-email endpoint
  found: API endpoint returns only {id: number|null}, no person details included in response
  implication: Must fetch full person record separately to compare names

- timestamp: 2026-01-26T10:10:00Z
  checked: prepare-stadion-parents.js and prepare-stadion-members.js
  found: Both parents and children have first_name and last_name in data.acf structure
  implication: Can compare first_name+last_name from parent data with existing person's acf fields

## Resolution

root_cause: The findPersonByEmail function (lines 108-130) returns a person based solely on email match, without checking if the name also matches. In syncParent (lines 158-165), when a parent has no stadion_id, it calls findPersonByEmail to check if they exist. If a child already exists with the same email, findPersonByEmail returns the child's ID. The parent then "updates" the child record (lines 167-210), merging into it instead of creating a separate parent record. The business rule states people are only duplicates when BOTH name AND email match, but the code only checks email.

fix: Modified syncParent function (lines 158-181) to fetch the full person record when findPersonByEmail returns an ID, then compare first_name and last_name (case-insensitive, trimmed). Only sets stadion_id for merge if BOTH name fields match. If names don't match, it logs the difference and proceeds to create a separate parent record.

verification: Code review confirms fix correctly implements business rule "only duplicate when BOTH name AND email match":
- Handles empty names with fallback to empty string
- Case-insensitive comparison with toLowerCase()
- Whitespace normalized with trim()
- Uses optional chaining for missing fields
- Error handling prevents merge if API call fails
- Requires BOTH first_name AND last_name to match
- Original symptom: parent-child with shared email would merge (child disappears)
- Expected after fix: separate records created when names differ
- Logic verified for edge cases (empty, whitespace, case differences)

files_changed: [submit-stadion-sync.js]
