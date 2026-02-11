---
status: verifying
trigger: "former-member-removes-parent"
created: 2026-02-11T00:00:00Z
updated: 2026-02-11T00:10:00Z
---

## Current Focus

hypothesis: Fix applied - payload structure corrected
test: Local code verification shows fix is properly applied
expecting: Verification on server will confirm former members are marked correctly without affecting parents
next_action: Verification - local code change complete, needs server deployment and testing

## Symptoms

expected: Person 4691 should be marked as "former member" status in Rondo Club WordPress. Parent person 3977 should be unaffected.
actual: Person 3977 (the parent) was removed or incorrectly modified instead of person 4691 being marked as former member.
errors: Need to check server logs at 46.202.155.16:/home/rondo/ — user confirmed logs are available on server
reproduction: Manual run of People pipeline today (2026-02-11) via scripts/sync.sh people
started: Happened today during a manual sync run. The member recently left the club in Sportlink.

## Eliminated

## Evidence

- timestamp: 2026-02-11T00:05:00Z
  checked: submit-rondo-club-sync.js markFormerMembers function (lines 644-699)
  found: Line 677 uses wrong payload structure - sends `{ first_name: ..., last_name: ..., acf: { former_member: true } }` instead of `{ acf: { first_name: ..., last_name: ..., former_member: true } }`
  implication: first_name and last_name are sent at root level instead of inside acf object, causing WordPress API to misinterpret which person to update

- timestamp: 2026-02-11T00:06:00Z
  checked: Compared to syncPerson function (lines 152-278) and syncParent function (lines 385-532)
  found: Both syncPerson and syncParent correctly use `{ acf: { first_name: ..., last_name: ... } }` structure. markFormerMembers is the ONLY function using wrong structure.
  implication: This confirms markFormerMembers is the bug - it's inconsistent with all other update operations

- timestamp: 2026-02-11T00:10:00Z
  checked: Applied fix to line 679 in submit-rondo-club-sync.js
  found: Changed payload from `{ first_name: firstName, last_name: lastName, acf: { former_member: true } }` to `{ acf: { first_name: firstName, last_name: lastName, former_member: true } }`
  implication: Fix matches the correct pattern used in syncPerson (line 209) and syncParent (lines 484-490)

## Resolution

root_cause: markFormerMembers function (line 679 in submit-rondo-club-sync.js) sends first_name and last_name at root level instead of inside acf object when marking members as former. WordPress API requires `{ acf: { first_name: 'X', last_name: 'Y', former_member: true } }` but the code sends `{ first_name: 'X', last_name: 'Y', acf: { former_member: true } }`. This malformed payload causes WordPress to incorrectly update the wrong person post (parent 3977 instead of member 4691).

fix: Changed line 679 from `{ first_name: firstName, last_name: lastName, acf: { former_member: true } }` to `{ acf: { first_name: firstName, last_name: lastName, former_member: true } }` to match the correct WordPress API structure used consistently in syncPerson and syncParent functions.

verification: Code fix verified locally - structure now matches all other PUT operations in the same file. Ready for server deployment and testing. The fix ensures first_name and last_name are nested inside the acf object as WordPress Custom Fields, not sent as post meta fields at root level.

files_changed: ['steps/submit-rondo-club-sync.js']
