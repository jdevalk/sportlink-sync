---
phase: 24-update-freescout-sync-to-set-website-fie
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - steps/prepare-freescout-customers.js
  - steps/submit-freescout-sync.js
autonomous: true
must_haves:
  truths:
    - "FreeScout customers have a Sportlink member page URL as a website"
    - "FreeScout customers have a Rondo Club person page URL as a website"
    - "Website URLs update when customer data changes (hash-based change detection still works)"
  artifacts:
    - path: "steps/prepare-freescout-customers.js"
      provides: "Website URLs in prepared customer data"
      contains: "sportlink.com/member/member-details"
    - path: "steps/submit-freescout-sync.js"
      provides: "Websites payload sent to FreeScout API"
      contains: "websites"
  key_links:
    - from: "steps/prepare-freescout-customers.js"
      to: "steps/submit-freescout-sync.js"
      via: "customer.data.websites array"
      pattern: "websites"
---

<objective>
Add two website URLs to each FreeScout customer during sync:
1. Sportlink member page: `https://club.sportlink.com/member/member-details/{KNVB ID}/general`
2. Rondo Club person page: `https://{RONDO_URL}/people/{rondo_club_id}`

Purpose: Give helpdesk agents one-click access to member records in both Sportlink and Rondo Club directly from the FreeScout customer sidebar.

Output: Updated prepare and submit steps that include websites in the FreeScout customer payload.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@steps/prepare-freescout-customers.js
@steps/submit-freescout-sync.js
@lib/freescout-client.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add website URLs to prepared customer data</name>
  <files>steps/prepare-freescout-customers.js</files>
  <action>
In `prepareCustomer()`, add a `websites` array to the returned `data` object (alongside `firstName`, `lastName`, `phones`, `photoUrl`).

Build two website URLs:
1. Sportlink URL: `https://club.sportlink.com/member/member-details/${member.knvb_id}/general` -- always include this since every member has a KNVB ID.
2. Rondo Club URL: `${process.env.RONDO_URL}/people/${member.rondo_club_id}` -- only include this when `member.rondo_club_id` is truthy (some members may not yet have a WordPress post).

Read `RONDO_URL` from environment using `readEnv('RONDO_URL')` (import from `../lib/utils` which is already imported at the top of the file). Strip any trailing slash from RONDO_URL before constructing the URL.

The websites array should contain objects with a `value` property, matching the FreeScout API format:
```js
websites: [
  { value: 'https://club.sportlink.com/member/member-details/BHABC123/general' },
  { value: 'https://rondo.example.com/people/456' }
]
```

The `member.rondo_club_id` is already available -- it is queried in `runPrepare()` at line 254 and assigned to the member object at line 270.
  </action>
  <verify>Run `node steps/prepare-freescout-customers.js --verbose --json 2>/dev/null | head -50` on the server to confirm sample output includes `websites` in the data object. Alternatively, verify the code compiles: `node -e "require('./steps/prepare-freescout-customers.js')"`</verify>
  <done>The `prepareCustomer()` function returns a `data.websites` array with 1-2 URL entries per customer.</done>
</task>

<task type="auto">
  <name>Task 2: Send websites in FreeScout create and update payloads</name>
  <files>steps/submit-freescout-sync.js</files>
  <action>
In `createCustomer()` (line ~112), add `websites` to the payload:
```js
// Add websites if available
if (customer.data.websites && customer.data.websites.length > 0) {
  payload.websites = customer.data.websites;
}
```

In `updateCustomer()` (line ~138), add `websites` to the payload in the same way:
```js
// Add websites if available
if (customer.data.websites && customer.data.websites.length > 0) {
  payload.websites = customer.data.websites;
}
```

This follows the exact same pattern already used for `phones` in both functions.

The FreeScout REST API accepts `websites` as an array of `{ value: "url" }` objects on both POST /api/customers and PUT /api/customers/{id}.
  </action>
  <verify>Run `node -e "require('./steps/submit-freescout-sync.js')"` to confirm the module loads without errors. Then run a dry-run on the server: `node steps/submit-freescout-sync.js --dry-run --verbose 2>&1 | head -30` to confirm customers are prepared correctly with website data.</verify>
  <done>Both `createCustomer()` and `updateCustomer()` include websites in their FreeScout API payloads when available.</done>
</task>

</tasks>

<verification>
1. `node -e "require('./steps/prepare-freescout-customers.js')"` loads without error
2. `node -e "require('./steps/submit-freescout-sync.js')"` loads without error
3. On the server, `node steps/submit-freescout-sync.js --dry-run --verbose` shows customers being prepared with website data in the output
4. After deploying and running `scripts/sync.sh freescout --force`, spot-check a customer in FreeScout to confirm both website URLs appear
</verification>

<success_criteria>
- Every FreeScout customer has a Sportlink URL website entry
- Customers with a rondo_club_id also have a Rondo Club URL website entry
- Existing sync functionality (create, update, delete, change detection) continues to work
- The `--force` flag triggers re-sync of all customers (since the hash will change with the new websites data)
</success_criteria>

<output>
After completion, create `.planning/quick/24-update-freescout-sync-to-set-website-fie/24-SUMMARY.md`
</output>
