---
phase: quick
plan: 005
subsystem: sync
tags: [cron, functions, commissies, automation]
dependency-graph:
  requires: [download-functions-from-sportlink, submit-stadion-commissies, submit-stadion-commissie-work-history]
  provides: [sync-functions.js, weekly-functions-sync]
  affects: []
tech-stack:
  added: []
  patterns: [sync-orchestration]
key-files:
  created:
    - sync-functions.js
  modified:
    - scripts/sync.sh
    - scripts/install-cron.sh
decisions: []
metrics:
  duration: 5 minutes
  completed: 2026-01-28
---

# Quick Task 005: Add Functions Sync to Cron Summary

**One-liner:** Weekly automated sync of member functions and committee memberships to Stadion via new orchestration script

## What Was Built

Created `sync-functions.js` orchestration script that coordinates the complete functions sync pipeline:
1. Downloads member functions and committee memberships from Sportlink via browser automation
2. Syncs commissies (committees) to Stadion WordPress as custom post types
3. Syncs commissie work history to people records in Stadion

Integrated into the existing cron infrastructure alongside people, photos, and teams sync.

## Implementation Details

### sync-functions.js (272 lines)

Follows the established pattern from `sync-teams.js`:
- Uses `createSyncLogger` for consistent logging
- Three-step pipeline: download -> commissies -> work history
- Comprehensive summary output with statistics
- Error aggregation from all phases
- Supports `--verbose` and `--force` CLI flags
- Exports `runFunctionsSync()` for programmatic use

### scripts/sync.sh Updates

- Added `functions` to valid sync types
- Routes to `sync-functions.js`
- Updated usage message and documentation

### scripts/install-cron.sh Updates

- Four sync schedules now (was three)
- Functions sync runs weekly on Sundays at 7:00 AM Amsterdam time
- Scheduled one hour after teams sync (6:00 AM) to avoid overlapping Sportlink browser sessions

## Cron Schedule

| Sync Type | Frequency | Time | Script |
|-----------|-----------|------|--------|
| People | Hourly | :00 | sync-people.js |
| Photos | Daily | 6:00 AM | sync-photos.js |
| Teams | Weekly (Sunday) | 6:00 AM | sync-teams.js |
| Functions | Weekly (Sunday) | 7:00 AM | sync-functions.js |

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create sync-functions.js orchestration script | c6a9eb1 |
| 2 | Add functions sync type to sync.sh | 9d6ea8a |
| 3 | Add weekly functions sync to cron schedule | 8c782e4 |

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `node sync-functions.js --verbose` - syntax OK, would execute pipeline
- `sync.sh` shows `functions` in usage message
- `install-cron.sh` includes `0 7 * * 0 ... functions` entry
