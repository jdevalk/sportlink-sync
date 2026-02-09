---
phase: quick-18
plan: 01
subsystem: dashboard
tags: [dashboard, monitoring, outcomes, ux]
dependency_graph:
  requires: []
  provides: [3-way-outcome-tracking]
  affects: [dashboard-ui, run-tracking]
tech_stack:
  added: []
  patterns: [3-way-outcome-state]
key_files:
  created: []
  modified:
    - lib/dashboard-db.js
    - lib/run-tracker.js
    - lib/dashboard-queries.js
    - public/style.css
    - pipelines/sync-people.js
    - pipelines/sync-nikki.js
    - pipelines/sync-functions.js
    - pipelines/sync-teams.js
    - pipelines/sync-freescout.js
    - pipelines/sync-discipline.js
    - pipelines/sync-all.js
decisions:
  - Amber/yellow color for partial status (Bootstrap warning yellow: #ffc107)
  - Backward compatibility: RunTracker.endRun() accepts boolean (true → 'success', false → 'failure')
  - Migration strategy: test for 'partial' support, migrate existing databases once per process
  - Pipeline return values unchanged (backward compat with email reports and exit codes)
metrics:
  duration: 6
  completed: 2026-02-09T15:17:07Z
---

# Quick Task 18: Distinguish Partial Errors from Pipeline Failures

**One-liner:** 3-way outcome tracking (success/partial/failure) distinguishes runs with item-level errors from critical pipeline failures on dashboard

## Implementation Summary

Added a 'partial' outcome state to distinguish pipeline runs that completed successfully but encountered some individual item errors (e.g., photo upload failures) from both zero-error successes and critical pipeline failures (e.g., Sportlink download crash).

### Key Changes

**1. Database Schema (lib/dashboard-db.js)**
- Updated `runs` table CHECK constraint: `outcome IN ('success', 'failure', 'running', 'partial')`
- Updated `run_steps` table CHECK constraint: `outcome IN ('success', 'failure', 'skipped', 'partial')`
- Added migration logic for existing databases:
  - Tests if 'partial' is already supported (idempotent)
  - Only migrates if table exists and doesn't support 'partial'
  - Uses process-level guard to prevent concurrent migrations
  - Recreates tables with new CHECK constraints, preserving data

**2. RunTracker API (lib/run-tracker.js)**
- Changed `endRun(success, stats)` → `endRun(outcome, stats)`
- Accepts string outcome: `'success'`, `'partial'`, or `'failure'`
- Backward compatibility: accepts boolean `true` (→ 'success') and `false` (→ 'failure')
- Updated JSDoc to document new signature

**3. Dashboard Queries (lib/dashboard-queries.js)**
- Updated "last completed run" query to include 'partial' in `outcome IN ('success', 'failure', 'partial')`
- Ensures partial runs count as completed for previous duration and overdue calculations

**4. Dashboard Styles (public/style.css)**
- `.status-partial`: amber/yellow background (#ffc107) for pipeline overview cards
- `.outcome-partial`: amber text color (#e0a800, font-weight: 600) for run history table
- `.outcome-badge.outcome-partial`: yellow badge (background: #fff3cd, color: #856404) for run detail page

**5. Pipeline Logic (all 7 pipelines)**
- Replaced binary `const success = ...` with 3-way outcome computation:
  - `'success'`: zero errors across all steps
  - `'partial'`: some errors occurred, pipeline ran to completion
  - `'failure'`: early abort from critical step failure or uncaught fatal error
- Updated early abort paths to explicitly use `'failure'`
- Updated outer catch blocks to use `'failure'`
- Pipeline return values unchanged: `return { success: totalErrors === 0, stats }` (backward compat)

**Affected Pipelines:**
- sync-people.js: checks `stats.errors + stats.rondoClub.errors + stats.photos.errors`
- sync-nikki.js: checks `stats.download.errors + stats.rondoClub.errors` (number type)
- sync-functions.js: checks `stats.download.errors + stats.commissies.errors + stats.workHistory.errors`
- sync-teams.js: checks `stats.download.errors + stats.teams.errors + stats.workHistory.errors`
- sync-freescout.js: checks `stats.errors`
- sync-discipline.js: checks `stats.download.errors + stats.sync.errors`
- sync-all.js: checks 12 error arrays (full sync)

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

### Migration Strategy
The migration logic handles three scenarios:
1. **Fresh database**: CREATE TABLE includes 'partial' from the start (no migration needed)
2. **Existing database without 'partial'**: Migrates tables to add 'partial' to CHECK constraints
3. **Already migrated database**: Test passes, no migration runs (idempotent)

The process-level `migrationChecked` guard prevents concurrent migrations when multiple connections are opened in the same Node.js process (e.g., during tests).

### Backward Compatibility
- RunTracker.endRun() accepts both strings and booleans (mapped: true → 'success', false → 'failure')
- Pipeline return values keep `success` as boolean for email reports and cron monitoring
- Exit codes unchanged (process.exitCode = 1 on any errors)

### Dashboard UX Impact
Before: Red "failure" for both Sportlink crashes AND 2 photo upload failures
After:
- Green "success": 300 members synced, 0 errors
- Amber "partial": 300 members synced, 2 photo upload failures
- Red "failure": Sportlink download crashed, no members synced

## Verification

Self-check performed:
- ✓ `node lib/dashboard-db.js` succeeds (schema migration on fresh database)
- ✓ `node lib/run-tracker.js` self-test passes (backward compat with boolean)
- ✓ No remaining `endRun(true,` or `endRun(false,` calls in pipelines (all migrated to string outcomes)
- ✓ 'partial' referenced in all 4 infrastructure files (dashboard-db, run-tracker, dashboard-queries, style.css)
- ✓ CSS contains `.status-partial`, `.outcome-partial`, and `.outcome-badge.outcome-partial` rules

## Commits

| Commit | Description |
|--------|-------------|
| 8422349 | feat(quick-18): add partial outcome state to dashboard |
| a0d66db | feat(quick-18): update all pipelines to use 3-way outcome |

## Impact

- **Operators**: Can now distinguish "needs attention" (partial) from "broken" (failure) at a glance
- **Monitoring**: More granular status tracking enables better alerting (e.g., alert on failure, log partial)
- **Historical data**: Preserved through migration, existing runs remain accessible
- **Future work**: Could extend to step-level 'partial' outcomes for even finer granularity

## Self-Check: PASSED

All claims verified:
- ✓ All modified files exist
- ✓ Commit 8422349 (Task 1) exists
- ✓ Commit a0d66db (Task 2) exists
- ✓ Database schema migration works on fresh and existing databases
- ✓ RunTracker self-test passes with backward compatibility
- ✓ All pipelines migrated to string outcomes
- ✓ CSS styles include partial status indicators
