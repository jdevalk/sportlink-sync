---
phase: quick-22
plan: 01
subsystem: photo-download
tags: [photos, error-handling, state-machine]
dependency_graph:
  requires: []
  provides:
    - permanent-404-photo-handling
    - error-photo-state
  affects:
    - photo-download-pipeline
    - photo-state-machine
tech_stack:
  added: []
  patterns:
    - permanent-error-detection
    - graceful-404-handling
key_files:
  created: []
  modified:
    - lib/rondo-club-db.js
    - lib/photo-utils.js
    - steps/download-photos-from-api.js
decisions:
  - Use 'error' photo state for permanent 404s (distinguishes from transient failures)
  - Detect 404 + "Not Found" body as permanent error pattern
  - Count permanent 404s as 'skipped' not 'failed' (not part of error totals)
  - PersonImageDate changes reset 'error' back to 'pending_download' (auto-retry on new photo)
metrics:
  duration_minutes: 1
  tasks_completed: 2
  files_modified: 3
  commits: 2
  completed_date: 2026-02-09
---

# Quick Task 22: Handle 404 Photo Downloads as Permanent Errors

**One-liner:** Permanent 404 photo URLs marked as 'error' state, excluded from retries and failure counts, auto-reset on PersonImageDate changes

## Overview

Many Sportlink members have PersonImageDate set but their photo URL returns 404 "Not Found". These will never succeed and were being retried on every sync run, cluttering logs with repeated failures. This task introduces an 'error' photo state to mark these as permanent failures, exclude them from future download attempts, and not count them in error metrics.

## What Was Built

### Database Migration
- Added 'error' state to photo_state CHECK constraint via table rebuild migration
- Handles existing databases with old constraint by detecting and migrating automatically
- Updated upsertMembers ON CONFLICT to include 'error' in photo removal transition

### Permanent Error Detection
- Modified `downloadPhotoFromUrl` in photo-utils.js to detect 404 + "Not Found" body pattern
- Returns `{ success: false, permanent_error: true }` for this specific case
- Other HTTP errors continue to return generic `{ success: false }`

### Download Step Handling
- Added 'skipped' counter for permanent 404s (separate from 'failed' counter)
- Permanent errors set photo_state to 'error' instead of leaving in 'pending_download'
- Updated summary log: "Photos: X downloaded, Y unavailable, Z failed (N total)"
- Permanent 404s do NOT affect success flag or appear in errors array

### Auto-Retry Mechanism
- When PersonImageDate changes via upsertMembers, photo_state transitions from 'error' to 'pending_download'
- This allows automatic retry if member uploads a new photo
- getMembersNeedingPhotoDownload excludes 'error' state (only selects 'pending_download')

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Add 'error' photo state to database and update photo-utils to detect permanent 404s | 6e5f2fb | Complete |
| 2 | Handle permanent 404 errors in download step without counting as failures | 2cfb401 | Complete |

## Deviations from Plan

None - plan executed exactly as written.

## Technical Details

### State Machine Changes

**Before:**
```
no_photo → pending_download → downloaded → pending_upload → synced
                ↑                                              ↓
                └───────────── pending_delete ←───────────────┘
```

**After:**
```
no_photo → pending_download → downloaded → pending_upload → synced
                ↑ ↓                                            ↓
                error        (PersonImageDate change resets)   ↓
                                pending_delete ←───────────────┘
```

### Migration Strategy

The CHECK constraint migration uses SQLite's table rebuild pattern:
1. Test if 'error' is already allowed via dummy UPDATE
2. If not, extract current schema from sqlite_master
3. Replace CHECK constraint regex with expanded version
4. Create new table, copy data, drop old, rename new, recreate indexes
5. All within a transaction with foreign_keys=OFF for safety

### Detection Pattern

```javascript
if (response.status === 404) {
  const body = await response.text();
  if (body === 'Not Found\n' || body === 'Not Found') {
    return { success: false, permanent_error: true };
  }
}
```

This specifically targets the Sportlink CDN pattern where invalid photo URLs return exactly "Not Found" as body text.

## Verification

All verification checks passed:

1. **Database migration:** `openDb()` accepts 'error' state in CHECK constraint ✓
2. **Photo utils:** `downloadPhotoFromUrl` returns permanent_error flag for 404 + "Not Found" ✓
3. **Download step:** Members with permanent 404 get photo_state='error' and are counted as skipped ✓
4. **Re-download trigger:** PersonImageDate changes reset 'error' to 'pending_download' via upsertMembers ✓
5. **Script loading:** All modified scripts load without syntax errors ✓

## Impact

**Before:**
- 264 members with invalid photos retried every sync run
- Failed counts included permanent 404s
- Logs cluttered with repeated download errors

**After:**
- Permanent 404s marked once as 'error' state
- Excluded from future sync runs (unless photo changes)
- Summary shows "unavailable" count separately from actual failures
- Success flag unaffected by permanent 404s

**Expected outcome on first sync after deploy:**
- Many members transition from 'pending_download' to 'error'
- Subsequent runs show 0 or few photo downloads (only new photos)
- "unavailable" count reflects reality of Sportlink data quality

## Files Modified

### lib/rondo-club-db.js
- Added migration block to expand photo_state CHECK constraint (lines 254-282)
- Updated upsertMembers photo removal CASE to include 'error' state (line 553)

### lib/photo-utils.js
- Added 404 "Not Found" detection in downloadPhotoFromUrl (lines 60-66)
- Returns permanent_error flag for specific pattern

### steps/download-photos-from-api.js
- Added 'skipped' counter to result object (line 26)
- Added permanent_error handling before success check (lines 106-109)
- Updated summary log format to show downloaded/unavailable/failed (line 131)

## Self-Check

Verifying all claimed files exist and commits are valid:

```bash
✓ lib/rondo-club-db.js exists
✓ lib/photo-utils.js exists
✓ steps/download-photos-from-api.js exists
✓ Commit 6e5f2fb exists (Task 1)
✓ Commit 2cfb401 exists (Task 2)
```

## Self-Check: PASSED

All files exist, all commits verified, all verification tests passed.
