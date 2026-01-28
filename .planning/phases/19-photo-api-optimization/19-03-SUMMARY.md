---
phase: 19-photo-api-optimization
plan: 03
subsystem: photo-sync
tags: [photo-sync, people-pipeline, cron, integration]
outcome: success
completed: 2026-01-28

depends_on:
  - 19-01
  - 19-02

provides:
  - Integrated photo sync in people pipeline
  - Hourly photo sync instead of daily
  - Backwards-compatible photos alias

affects:
  - sync-people.js (integrated photo steps)
  - scripts/sync.sh (photos alias)
  - scripts/install-cron.sh (4 jobs instead of 5)

tech_stack:
  patterns:
    - Module pipeline integration
    - Backwards-compatible aliasing

key_files:
  modified:
    - sync-people.js
    - scripts/sync.sh
    - scripts/install-cron.sh

metrics:
  duration: 2m
  tasks_completed: 3
  tasks_total: 3
---

# Phase 19 Plan 03: Pipeline Integration Summary

Photo download and upload integrated into hourly people sync pipeline.

## What Changed

### sync-people.js
- Added imports for `runPhotoDownload` and `runPhotoSync`
- Added `stats.photos` tracking (downloaded, uploaded, deleted, skipped, errors)
- Added Step 6: Photo Download (API-based) after birthday sync
- Added Step 7: Photo Upload/Delete to Stadion
- Added PHOTO SYNC section to summary report
- Included photo errors in overall error tracking and success condition

### scripts/sync.sh
- `photos` argument now runs `sync-people.js` instead of `sync-photos.js`
- Maintains backwards compatibility for existing scripts/cron
- Outputs info message indicating photo sync is integrated

### scripts/install-cron.sh
- Reduced from 5 to 4 cron jobs
- Removed separate daily photo sync (was 6:00 AM)
- Updated intro text: "four sync schedules"
- Updated people sync description: "members, parents, birthdays, photos"

## Commits

| Hash | Description |
|------|-------------|
| 10d9788 | feat(19-03): integrate photo sync into people pipeline |
| 55451c3 | feat(19-03): alias photos to people sync in sync.sh |
| a290973 | feat(19-03): remove separate photo cron job from install script |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All syntax checks passed:
- `node -c sync-people.js` - OK
- `bash -n scripts/sync.sh` - OK
- `bash -n scripts/install-cron.sh` - OK

Key patterns verified:
- sync-people.js imports both runPhotoDownload and runPhotoSync
- Photo summary section added to printSummary
- sync.sh photos case maps to sync-people.js
- install-cron.sh has 4 cron entries (people, nikki, teams, functions)

## Phase 19 Impact

With this plan complete, Phase 19 (Photo API Optimization) is now finished:

1. **Plan 01:** Schema migration for photo_url/photo_date in stadion_members
2. **Plan 02:** HTTP fetch for photo download (replaces browser automation)
3. **Plan 03:** Pipeline integration, cron updates

**Net result:**
- Photos now sync hourly instead of daily
- No more browser automation for photo download (uses direct HTTP fetch)
- Photo change detection uses photo_date from MemberHeader API
- Simpler cron configuration (4 jobs instead of 5)
