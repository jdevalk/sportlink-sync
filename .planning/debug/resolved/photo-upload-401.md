---
status: resolved
trigger: "photo-upload-401: HTTP 401 errors on photo downloads from Sportlink"
created: 2026-02-09T12:00:00Z
updated: 2026-02-09T13:00:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED
test: Deployed to server, ran photo download step
expecting: Expired URLs detected and cleared, zero errors
next_action: Archive

## Symptoms

expected: Photo download step should successfully download member photos from Sportlink CDN
actual: HTTP 401 errors for 754 out of 756 pending downloads. Only 2 with fresh URLs succeed.
errors: HTTP 401 from binaries.sportlink.com on expired signed URLs
reproduction: Run scripts/sync.sh people - photo download step fails for members with expired URLs
started: Ongoing since the full functions sync on Feb 8 generated URLs that expired before photo download ran

## Eliminated

- hypothesis: WordPress upload auth issue (RONDO_APP_PASSWORD)
  evidence: Errors are [photo-download] not [photo-upload]. Upload of 15 successfully downloaded photos worked fine (15/15).
  timestamp: 2026-02-09T12:10:00Z

- hypothesis: Rondo Club API endpoint issue
  evidence: All 401s come from binaries.sportlink.com (Sportlink CDN), not from Rondo Club WordPress
  timestamp: 2026-02-09T12:10:00Z

## Evidence

- timestamp: 2026-02-09T12:05:00Z
  checked: Server logs sync-people-2026-02-09.log
  found: Errors are all [photo-download] not [photo-upload]. 769 pending, 15 downloaded OK, 754 failed with HTTP 401.
  implication: The issue is in downloading FROM Sportlink, not uploading TO Rondo Club

- timestamp: 2026-02-09T12:15:00Z
  checked: Photo URLs in stadion_members table (rondo-sync.sqlite)
  found: URLs contain expires= parameter. Failed URLs: expires=1770526842 (Feb 8 05:00 UTC). Successful URLs: expires=1770647554 (Feb 9 14:32 UTC, still valid).
  implication: Sportlink CDN uses time-limited signed URLs that become invalid after expiry

- timestamp: 2026-02-09T12:20:00Z
  checked: Cron schedule and functions pipeline logs
  found: Full functions sync ran Feb 8 01:00-02:59 UTC. URLs valid ~4 hours. People pipeline at 07:00+ UTC. URLs already expired.
  implication: 4-hour URL validity window is too short for the gap between functions sync and people sync

- timestamp: 2026-02-09T12:25:00Z
  checked: Upsert logic in rondo-club-db.js and prepare-rondo-club-members.js
  found: People pipeline reads photo_url from sportlink_member_free_fields, passes to upsertMembers. If URL unchanged, state stays pending_download with expired URL.
  implication: Daily functions sync only processes recently-changed members. Unchanged members keep expired URLs indefinitely.

- timestamp: 2026-02-09T12:30:00Z
  checked: SQL count of expired vs valid URLs for pending_download members
  found: 754 expired, 2 valid out of 756 total pending_download
  implication: Confirms the vast majority of pending downloads have expired URLs

- timestamp: 2026-02-09T12:45:00Z
  checked: Traced upsert logic for edge case: what happens when photo_url is cleared but functions sync hasn't run yet
  found: Member stays in pending_download with photo_url=NULL. getMembersNeedingPhotoDownload skips it (requires photo_url IS NOT NULL). Next functions sync provides fresh URL, upsert detects NULL->new URL change and re-enables download.
  implication: Fix is safe; no regression in the upsert flow

- timestamp: 2026-02-09T12:55:00Z
  checked: Production verification after deploy
  found: Photo download step correctly detected all 754 expired URLs, cleared them with zero errors. Database shows 0 pending_download members with non-null photo_url. All 754 expired URLs cleared from both stadion_members and sportlink_member_free_fields.
  implication: Fix works correctly in production

## Resolution

root_cause: Sportlink CDN photo URLs are time-limited signed URLs (~4 hour expiry). The functions pipeline captures these URLs but the photo download runs in the people pipeline hours later. For the 754 members whose photos haven't changed recently, the daily functions sync doesn't refresh their URLs (only processes recently-changed members). The weekly full functions sync generates URLs that expire before the first people pipeline of the day runs. Members get stuck in pending_download permanently with expired URLs, generating hundreds of 401 errors on every people sync run.
fix: |
  Three changes:
  1. download-photos-from-api.js: Added isUrlExpired() to detect expired signed URLs before download attempt. Expired URLs and HTTP 401/403 responses clear the stale URL via clearExpiredPhotoUrl() instead of recording an error. No-retry logic for 401/403. Added expired counter to result stats.
  2. lib/rondo-club-db.js: Added clearExpiredPhotoUrl() function that NULLs photo_url in both stadion_members and sportlink_member_free_fields while keeping photo_state as pending_download. This prevents the people pipeline from re-populating the expired URL and allows the next functions sync to provide a fresh one.
  3. pipelines/sync-people.js: Added expired counter to stats and summary display.
verification: |
  Deployed to production server (46.202.155.16). Ran photo download step:
  - All 754 expired URLs detected and cleared (zero errors)
  - Database: 0 pending_download members with non-null photo_url (previously 754)
  - Expired URLs cleared from both stadion_members and sportlink_member_free_fields
  - Members remain in pending_download state, ready for fresh URLs from next functions sync
files_changed:
  - steps/download-photos-from-api.js
  - lib/rondo-club-db.js
  - pipelines/sync-people.js
