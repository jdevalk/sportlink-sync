---
status: investigating
trigger: "KNVB ID doesn't get stored in Stadion WordPress, there IS a custom field for it"
created: 2026-01-26T10:00:00Z
updated: 2026-01-26T10:20:00Z
---

## Current Focus

hypothesis: CONFIRMED - ACF field name mismatch between code (knvb_id) and WordPress configuration
test: Verified data flow is correct; issue must be WordPress ACF field name or REST API exposure
expecting: User needs to verify actual ACF field name in WordPress admin
next_action: Request user to check WordPress ACF field configuration and confirm field name

## Symptoms

expected: KNVB ID should be saved to a custom field in WordPress/Stadion
actual: KNVB ID is not being stored, despite custom field existing
errors: No errors visible - sync completes without error messages
reproduction: Run Stadion sync, check WordPress - KNVB ID field is empty
started: Never worked - feature recently added or never functioned
source: KNVB ID data is in the SQLite database

## Eliminated

- hypothesis: KNVB ID not in SQLite database
  evidence: Query shows data_json contains "knvb_id":"VGPP426" in acf object
  timestamp: 2026-01-26T10:05:00Z

- hypothesis: KNVB ID not included in prepare-stadion-members.js
  evidence: Line 97 explicitly adds knvb_id: sportlinkMember.PublicPersonId to acf object
  timestamp: 2026-01-26T10:05:00Z

## Evidence

- timestamp: 2026-01-26T10:05:00Z
  checked: SQLite database stadion_members table
  found: data_json contains acf.knvb_id field correctly populated (e.g., "VGPP426")
  implication: Data preparation is correct

- timestamp: 2026-01-26T10:06:00Z
  checked: prepare-stadion-members.js line 97
  found: Code explicitly sets acf.knvb_id = sportlinkMember.PublicPersonId
  implication: Field mapping is correct

- timestamp: 2026-01-26T10:07:00Z
  checked: submit-stadion-sync.js syncPerson function
  found: Sends data object directly to WordPress API via PUT/POST with body containing acf object
  implication: API call includes knvb_id in payload

- timestamp: 2026-01-26T10:08:00Z
  checked: Planning docs (.planning/phases/06-member-sync/06-RESEARCH.md)
  found: Known pitfall documented: "ACF field groups have 'Show in REST API' disabled by default"
  implication: WordPress may be silently ignoring the knvb_id field if not REST-exposed

- timestamp: 2026-01-26T10:15:00Z
  checked: getMembersNeedingSync in lib/stadion-db.js (lines 200-221)
  found: data_json is JSON parsed and assigned to member.data, sent directly to WordPress API
  implication: No transformation occurs - data_json content IS what WordPress receives

- timestamp: 2026-01-26T10:16:00Z
  checked: Data flow trace complete
  found: Sportlink PublicPersonId -> prepare-stadion-members.js (acf.knvb_id) -> SQLite data_json -> getMembersNeedingSync (member.data) -> syncPerson (stadionRequest body) -> WordPress API
  implication: Code is correct at every step. WordPress must be ignoring the field.

- timestamp: 2026-01-26T10:17:00Z
  checked: .planning/milestones/v1.3-REQUIREMENTS.md and .planning/PROJECT.md
  found: Intent is "Store Sportlink relatiecode as 'KNVB ID' custom field" - confirms intent but not actual ACF field name
  implication: The ACF field in WordPress might use a different key name than 'knvb_id'

## Resolution

root_cause: WordPress ACF field name mismatch - code sends `acf.knvb_id` but WordPress ACF field likely has a different key name. WordPress REST API silently ignores unrecognized ACF fields. All other fields (first_name, last_name, contact_info, addresses, gender, birth_year) work because their names match the WordPress ACF configuration.

fix: Pending user verification of actual ACF field name in WordPress admin (ACF > Field Groups > Person fields > find KNVB ID field > check "Field Name")

verification:
files_changed: []
