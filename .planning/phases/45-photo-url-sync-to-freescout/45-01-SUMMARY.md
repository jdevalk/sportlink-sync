---
phase: 45-photo-url-sync-to-freescout
plan: 01
subsystem: freescout-sync
tags: [freescout, photo-sync, api-integration]
dependency_graph:
  requires: [rondo-club-api, freescout-api]
  provides: [photo-url-sync]
  affects: [prepare-freescout-customers, submit-freescout-sync]
tech_stack:
  added: []
  patterns:
    - async-photo-fetching
    - conditional-field-inclusion
    - graceful-degradation
key_files:
  created: []
  modified:
    - steps/prepare-freescout-customers.js
    - steps/submit-freescout-sync.js
decisions:
  - key: async-photo-url-fetching
    choice: Query Rondo Club API with ?_embed parameter to get featured media
    rationale: WordPress REST API requires _embed param to include media in response, avoiding separate media endpoint calls
    alternatives: Separate media endpoint query (extra API call), construct URL from pattern (unreliable)
  - key: null-photoUrl-handling
    choice: Omit photoUrl field from customer data when null using conditional spread
    rationale: Prevents sending null values to FreeScout API, cleaner payload, hash detection works correctly
    alternatives: Send null explicitly (unnecessary data), empty string (incorrect type)
  - key: photo-state-validation
    choice: Only fetch photo URLs for members with photo_state='synced'
    rationale: Prevents broken image URLs in FreeScout for members without synced photos
    alternatives: Fetch all photo URLs (may return 404 URLs), skip validation (broken images)
metrics:
  duration: 1m 51s
  tasks_completed: 2
  files_modified: 2
  commits: 2
  completed_at: 2026-02-12T19:40:12Z
---

# Phase 45 Plan 01: Photo URL Sync to FreeScout Summary

Member photos from Rondo Club now sync to FreeScout as customer avatars via WordPress REST API ?_embed parameter, with conditional field inclusion and graceful degradation.

## Tasks Completed

| Task | Name                                           | Commit  | Files                             |
| ---- | ---------------------------------------------- | ------- | --------------------------------- |
| 1    | Implement async photo URL fetching in prepare  | 8bd25f0 | steps/prepare-freescout-customers.js |
| 2    | Add photoUrl to FreeScout create/update payloads | 526b787 | steps/submit-freescout-sync.js    |

## Implementation Details

### Async Photo URL Fetching

Modified `steps/prepare-freescout-customers.js`:

1. **Added import** for `rondoClubRequest` from `lib/rondo-club-client.js`
2. **Replaced stub `getPhotoUrl()`** with async version:
   - Checks `photo_state === 'synced'` before API call (skip unsynced photos)
   - Checks `rondo_club_id` exists (skip members without WordPress posts)
   - Calls `rondoClubRequest('wp/v2/people/${id}?_embed', 'GET', ...)`
   - Extracts URL from `response.body._embedded['wp:featuredmedia'][0].source_url`
   - Validates URL starts with `https://` before returning
   - Returns null on any error (graceful degradation)
   - Logs photo URL fetching in verbose mode
3. **Made `prepareCustomer()` async**:
   - Added `options` parameter for logger/verbose
   - Changed `getPhotoUrl(member)` to `await getPhotoUrl(member, options)`
4. **Updated `runPrepare()` loop**:
   - Changed `prepareCustomer()` to `await prepareCustomer(..., { logger, verbose })`
5. **Conditional photoUrl inclusion**:
   - Used `...(photoUrl ? { photoUrl } : {})` spread to omit null values

### FreeScout Payload Integration

Modified `steps/submit-freescout-sync.js`:

1. **In `createCustomer()` function**:
   - Added conditional block after phones: `if (customer.data.photoUrl) { payload.photoUrl = customer.data.photoUrl; }`
   - Placed before websites block for logical ordering
2. **In `updateCustomer()` function**:
   - Added identical conditional block in same position
   - Maintains consistency between create and update operations

### Change Detection Integration

No changes needed to `lib/freescout-db.js`:
- Existing hash-based change detection automatically includes `photoUrl` since it's part of `customer.data`
- Photo URL changes trigger re-sync through normal hash comparison

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

### Syntax Validation
- `node -c steps/prepare-freescout-customers.js` - PASSED
- `node -c steps/submit-freescout-sync.js` - PASSED

### Module Export Validation
- `prepare-freescout-customers.js` exports `runPrepare` as function - PASSED
- `submit-freescout-sync.js` exports `runSubmit` as function - PASSED

### Code Review Checklist
- [x] getPhotoUrl is async and fetches from Rondo Club API with ?_embed
- [x] getPhotoUrl checks photo_state === 'synced' before making API call
- [x] getPhotoUrl checks rondo_club_id exists before making API call
- [x] getPhotoUrl validates URL starts with https:// before returning
- [x] getPhotoUrl returns null on any error (graceful degradation)
- [x] prepareCustomer is async and awaits getPhotoUrl
- [x] prepareCustomer passes options through for API calls
- [x] photoUrl is conditionally included in customer data (omitted when null)
- [x] createCustomer payload includes photoUrl when truthy
- [x] updateCustomer payload includes photoUrl when truthy
- [x] No photoUrl sent as null to FreeScout API

## Success Criteria

All success criteria met:
- [x] `prepare-freescout-customers.js` has async getPhotoUrl that queries Rondo Club API with ?_embed parameter
- [x] `prepare-freescout-customers.js` has async prepareCustomer that passes options and awaits getPhotoUrl
- [x] `submit-freescout-sync.js` createCustomer includes photoUrl in payload when available
- [x] `submit-freescout-sync.js` updateCustomer includes photoUrl in payload when available
- [x] Both files pass syntax validation
- [x] Both files export their main functions correctly

## Self-Check: PASSED

### File Existence Check
- [x] steps/prepare-freescout-customers.js exists and modified
- [x] steps/submit-freescout-sync.js exists and modified

### Commit Verification
- [x] Commit 8bd25f0 exists (Task 1: async photo URL fetching)
- [x] Commit 526b787 exists (Task 2: photoUrl in FreeScout payloads)

## Next Steps

1. Deploy to production server: `git push && ssh root@46.202.155.16 "cd /home/rondo && git pull"`
2. Run FreeScout sync: `ssh root@46.202.155.16 "cd /home/rondo && scripts/sync.sh freescout --verbose"`
3. Verify photo URLs appear in FreeScout customer records
4. Monitor for API errors or broken image URLs

## Related Documentation

- Research: `.planning/phases/45-photo-url-sync-to-freescout/45-RESEARCH.md`
- Plan: `.planning/phases/45-photo-url-sync-to-freescout/45-01-PLAN.md`
- Rondo Club API: WordPress REST API ?_embed parameter
- FreeScout API: Customer photoUrl field
