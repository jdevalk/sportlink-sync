# Fix for Missing Functies Sync

## Root Cause
Commissie orphan detection used stale tracking data (fetched before sync) instead of fresh data (after sync updates tracking table). When tracking table was empty, getAllCommissies returned [], causing getOrphanCommissies to treat ALL commissies as orphans and delete them immediately after creation.

## Fix Applied
Changed `sync-functions.js` pipeline to pass `enableOrphanDetection: true` flag instead of `currentCommissieNames` array. Modified `submit-rondo-club-commissies.js` to fetch fresh commissie names from the tracking table AFTER sync completes and updates it, ensuring orphan detection uses current state.

## Files Changed
- pipelines/sync-functions.js: Lines 181-192
- steps/submit-rondo-club-commissies.js: Lines 120-128, 188-194

## Testing Plan
1. Deploy fix to sync server
2. Run sync-functions pipeline
3. Verify commissies are created and NOT deleted
4. Verify commissie work history syncs
5. Check person 757 on production for functies
