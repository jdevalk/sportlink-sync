---
phase: 07-parent-sync
plan: 03
subsystem: api
tags: [wordpress, rest-api, relationships, parent-sync, stadion]

# Dependency graph
requires:
  - phase: 07-02
    provides: Parent preparation with email deduplication and child tracking
  - phase: 06-03
    provides: Member sync infrastructure and Stadion API client
provides:
  - Parent sync to Stadion with email matching
  - Bidirectional parent-child relationship linking
  - Hash-based change detection for parents
  - Orphan parent cleanup
  - npm scripts for parent-only sync
affects: [sync-all, automation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bidirectional relationship linking (parent.children and child.parents arrays)"
    - "Email-only matching for parents (no KNVB ID available)"
    - "Relationship preservation on update (merge existing with new links)"

key-files:
  created: []
  modified:
    - submit-stadion-sync.js
    - package.json

key-decisions:
  - "Parents matched by email only (no KNVB ID available for parents)"
  - "Bidirectional linking updates both parent.children and child.parents fields"
  - "Use getAllTrackedMembers() not getMembersNeedingSync() for relationship mapping"
  - "Preserve existing relationships on update (merge with new children)"
  - "1 second rate limit for child parent link updates (faster than 2s for main sync)"

patterns-established:
  - "Parent sync after member sync in same database transaction"
  - "Build KNVB ID to Stadion ID mapping from all tracked members for relationship linking"
  - "CLI flags --parents-only and --skip-parents for granular control"

# Metrics
duration: 3min
completed: 2026-01-25
---

# Phase 07 Plan 03: Stadion Parent Sync Summary

**Parent sync to Stadion with email matching, bidirectional relationship linking to children, hash-based change detection, and orphan cleanup**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-25T20:18:51Z
- **Completed:** 2026-01-25T20:21:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Parents sync to Stadion as separate person records matched by email
- Bidirectional parent-child relationships (parent.children and child.parents arrays)
- Hash-based change detection skips unchanged parents
- Orphan parent deletion when no longer in Sportlink
- npm scripts for parent-only sync operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Add parent sync functions to submit-stadion-sync.js** - `81a24ad` (feat)
2. **Task 2: Add npm scripts for parent sync** - `50354f0` (feat)

## Files Created/Modified

- `submit-stadion-sync.js` - Extended with parent sync functions (findExistingParent, syncParent, syncParents, deleteOrphanParents, updateChildrenParentLinks) and updated runSync to include parent sync
- `package.json` - Added sync-stadion-parents and sync-stadion-parents-verbose scripts

## What Was Built

### 1. Parent Matching by Email

Added `findExistingParent()` function that matches parents by email only:
- Search by email using WordPress REST API search endpoint
- Client-side filtering of ACF contact_info field for exact email match
- Fallback to recent persons scan if search doesn't find match
- No KNVB ID matching (parents are not members)

### 2. Parent Sync with Relationship Linking

Created `syncParent()` function that:
- Resolves child KNVB IDs to Stadion post IDs using mapping
- Creates or updates parent person record
- Populates parent.children array with child Stadion post IDs
- Merges existing children with new ones (preserves manual links)
- Calls updateChildrenParentLinks for bidirectional linking

### 3. Bidirectional Relationship Linking

Added `updateChildrenParentLinks()` function:
- Fetches each child person record
- Updates child.parents array to include parent Stadion post ID
- Preserves existing parent links (multiple parents supported)
- 1 second rate limit between child updates

### 4. Orphan Parent Cleanup

Implemented `deleteOrphanParents()` function:
- Detects parents in database not in current Sportlink data
- Deletes from Stadion via DELETE endpoint
- Removes from tracking database
- 2 second rate limit between deletions

### 5. Parent Sync Orchestration

Created `syncParents()` function that:
- Runs runPrepareParents to get parent data
- Upserts parents to tracking database
- Gets parents needing sync (hash-based change detection)
- Syncs each parent with relationship linking
- Deletes orphan parents
- Returns detailed result with counts

### 6. Integration with Member Sync

Updated `runSync()` to:
- Accept includeMembers and includeParents options
- Build KNVB ID to Stadion ID mapping from ALL tracked members
- Run parent sync after member sync in same database transaction
- Support CLI flags --parents-only and --skip-parents

### 7. npm Scripts

Added convenience scripts:
- `npm run sync-stadion-parents` - Parent-only sync
- `npm run sync-stadion-parents-verbose` - Parent-only sync with verbose logging

## Decisions Made

**1. Parents matched by email only**
- Parents have no KNVB ID in Sportlink
- Email is the only stable identifier
- Uses same client-side ACF filtering as member email fallback

**2. Bidirectional relationship linking**
- Parents have children array (Stadion post IDs)
- Children have parents array (Stadion post IDs)
- Both directions updated for data integrity

**3. Use getAllTrackedMembers() for relationship mapping**
- Need ALL synced members, not just those needing sync
- Includes members from previous runs for existing parent-child links
- Critical for correct relationship linking

**4. Preserve existing relationships on update**
- Merge new children with existing children array
- Don't overwrite manual links added in Stadion UI
- Array deduplication via Set

**5. 1 second rate limit for child parent link updates**
- Faster than main sync 2s rate limit
- Child updates are small (just adding parent ID)
- Balance between speed and API courtesy

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Parent sync pipeline complete. Ready for:
- Integration with sync-all orchestrator
- Automated daily sync including parents
- Production deployment

No blockers or concerns.

---
*Phase: 07-parent-sync*
*Completed: 2026-01-25*
