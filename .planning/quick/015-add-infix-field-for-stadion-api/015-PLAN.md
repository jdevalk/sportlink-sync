---
phase: quick
plan: 015
type: execute
wave: 1
depends_on: []
files_modified:
  - prepare-stadion-members.js
autonomous: true

must_haves:
  truths:
    - "Infix (tussenvoegsel) is sent as a separate ACF field to Stadion"
    - "last_name no longer contains the infix prefix"
    - "Members without an infix still sync correctly with empty infix field omitted"
  artifacts:
    - path: "prepare-stadion-members.js"
      provides: "buildName returns infix separately; preparePerson adds infix to ACF"
      contains: "acf.infix"
  key_links:
    - from: "prepare-stadion-members.js"
      to: "submit-stadion-sync.js"
      via: "data.acf object passed through unchanged"
      pattern: "acf\\.infix"
---

<objective>
Add separate `infix` (tussenvoegsel) field support to the Stadion sync pipeline.

Purpose: Stadion's API now accepts `infix` as a separate ACF field instead of expecting it merged into `last_name`. The title is auto-generated server-side from `first_name`, `infix`, and `last_name`.

Output: Updated `prepare-stadion-members.js` where `buildName()` returns infix separately and `preparePerson()` includes it in the ACF payload.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@prepare-stadion-members.js
@submit-stadion-sync.js (lines 460-490 for parent sync context - no changes needed there)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update buildName and preparePerson to handle infix separately</name>
  <files>prepare-stadion-members.js</files>
  <action>
  In `buildName()` (lines 33-43):
  1. Update the JSDoc return type to include `infix`: `@returns {{first_name: string, infix: string, last_name: string}}`
  2. Update the JSDoc description from "merging Dutch tussenvoegsel into last name" to "separating Dutch tussenvoegsel (infix) as its own field"
  3. Return `infix` as a separate field: `return { first_name: firstName, infix: infix, last_name: lastName };`
  4. Remove the `fullLastName` merge line (`const fullLastName = [infix, lastName].filter(Boolean).join(' ');`)
  5. Use `lastName` directly instead of `fullLastName` in the return

  In `preparePerson()` (lines 135-213):
  1. After `last_name: name.last_name` on line 142, add `infix` to the ACF object - but ONLY if the infix is non-empty (follow the same pattern as other optional fields like `gender` and `birthYear`)
  2. Add: `if (name.infix) acf.infix = name.infix;` after the initial ACF object construction (after line 146, near the other optional field checks)

  Do NOT change anything in `submit-stadion-sync.js` - the member sync path sends the full `data` object from `preparePerson`, so `infix` flows through automatically. The parent sync path (lines 467-477) handles non-Sportlink parent names and does not need infix.
  </action>
  <verify>
  Run: `node -e "const {preparePerson} = require('./prepare-stadion-members'); const r = preparePerson({PublicPersonId:'TEST1', FirstName:'Jan', Infix:'van de', LastName:'Berg', Email:'test@example.com'}); console.log(JSON.stringify(r.data.acf, null, 2));"` and confirm:
  - `first_name` is "Jan"
  - `infix` is "van de"
  - `last_name` is "Berg" (NOT "van de Berg")

  Also test without infix:
  `node -e "const {preparePerson} = require('./prepare-stadion-members'); const r = preparePerson({PublicPersonId:'TEST2', FirstName:'Piet', LastName:'Bakker', Email:'test@example.com'}); console.log(JSON.stringify(r.data.acf, null, 2));"` and confirm:
  - `first_name` is "Piet"
  - `last_name` is "Bakker"
  - `infix` key is NOT present in the output (omitted when empty)
  </verify>
  <done>
  - `buildName()` returns `{first_name, infix, last_name}` with infix as a separate field
  - `preparePerson()` includes `infix` in ACF when non-empty, omits it when empty
  - `last_name` no longer contains the tussenvoegsel prefix
  - No changes to submit-stadion-sync.js or any other files
  </done>
</task>

</tasks>

<verification>
1. Run verify commands from Task 1 to confirm correct field separation
2. Run `node prepare-stadion-members.js --verbose` to confirm no errors with real data (reads from local SQLite, does not sync)
</verification>

<success_criteria>
- Infix is a separate ACF field in the prepared member data
- last_name contains only the actual last name without tussenvoegsel
- Empty infix values are omitted from the ACF payload (not sent as empty string)
- Existing pipeline (submit-stadion-sync.js) requires zero changes
</success_criteria>

<output>
After completion, create `.planning/quick/015-add-infix-field-for-stadion-api/015-SUMMARY.md`
</output>
