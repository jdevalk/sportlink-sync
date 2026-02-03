---
phase: quick
plan: 012
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/nikki-db.js
autonomous: true

must_haves:
  truths:
    - "Multiple Nikki rows for the same member and year are stored (not overwritten)"
    - "Saldo values are summed per KNVB ID per year when retrieved for Stadion sync"
    - "Existing per-year ACF field structure (_nikki_YYYY_saldo) remains unchanged"
  artifacts:
    - path: "lib/nikki-db.js"
      provides: "Updated schema and aggregation logic"
      contains: "SUM(saldo)"
  key_links:
    - from: "lib/nikki-db.js"
      to: "sync-nikki-to-stadion.js"
      via: "getContributionsGroupedByMember() return structure"
      pattern: "getContributionsGroupedByMember"
---

<objective>
Sum saldo per KNVB ID in Nikki sync

Purpose: A member can have multiple Nikki contribution entries for the same year (different nikki_ids). Currently, the UNIQUE(knvb_id, year) constraint causes later entries to overwrite earlier ones. Instead, we should store all entries and sum the saldo values when retrieving data for Stadion sync.

Output: Updated nikki-db.js with multi-entry storage and aggregated retrieval
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/nikki-db.js
@sync-nikki-to-stadion.js
@download-nikki-contributions.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update nikki-db.js schema and retrieval to support multiple entries per member per year</name>
  <files>lib/nikki-db.js</files>
  <action>
Modify the nikki-db.js module to:

1. **Change UNIQUE constraint** in `initDb()`:
   - Current: `UNIQUE(knvb_id, year)` - overwrites when same member/year appears
   - New: `UNIQUE(knvb_id, year, nikki_id)` - allows multiple entries per member per year

2. **Add migration** in `initDb()`:
   - After existing migration for hoofdsom column, add try/catch block to recreate table with new constraint
   - Migration pattern: Check if old constraint exists by attempting an insert that would violate new but not old
   - If migration needed: Create temp table, copy data, drop old table, rename temp

3. **Update `getContributionsGroupedByMember()`**:
   - Change the SQL query to aggregate by (knvb_id, year) using GROUP BY
   - SUM the saldo values: `SUM(saldo) as saldo`
   - SUM the hoofdsom values: `SUM(hoofdsom) as hoofdsom`
   - Keep one nikki_id per group (use MAX or GROUP_CONCAT if needed for reference)
   - Keep one status per group (use MAX for alphabetically latest, which tends to be worst status)
   - Return structure must remain: Map<knvb_id, [{ year, nikki_id, saldo, hoofdsom, status }]>

4. **Update `getContributionsByKnvbId()`** (same aggregation pattern):
   - Apply same GROUP BY and SUM pattern for consistency

5. **Update `getContributionsByYear()`** (same aggregation pattern):
   - Apply same GROUP BY and SUM pattern for consistency

6. **Update `getMembersWithOutstandingBalance()`**:
   - Use subquery or CTE to first aggregate by (knvb_id, year), then filter where aggregated saldo > 0

The key insight: Store granular data (all rows), aggregate on retrieval (SUM per year).
  </action>
  <verify>
    - Run `node -e "const db = require('./lib/nikki-db'); const d = db.openDb(); console.log('Schema OK'); d.close()"` - should not error
    - Run `node show-nikki-contributions.js --verbose 2>&1 | head -20` - should show contribution data
    - The getContributionsGroupedByMember function should return aggregated values
  </verify>
  <done>
    - Schema allows multiple nikki_id entries per (knvb_id, year)
    - Retrieval functions aggregate saldo/hoofdsom with SUM
    - Existing sync-nikki-to-stadion.js works without modification
  </done>
</task>

</tasks>

<verification>
- Database schema accepts multiple nikki_ids per member per year
- Aggregation queries return summed saldo values
- Stadion sync still receives correct data structure
</verification>

<success_criteria>
- `node sync-nikki-to-stadion.js --dry-run --verbose` runs without errors
- If a member has 2 Nikki entries for same year with saldo 50 and 30, the aggregated saldo is 80
- No changes needed to sync-nikki-to-stadion.js or download-nikki-contributions.js
</success_criteria>

<output>
After completion, create `.planning/quick/012-sum-nikki-saldo-per-knvb-id/012-SUMMARY.md`
</output>
