# Phase 19: Photo API Optimization - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace browser-based photo download (`download-photos-from-sportlink.js`) with direct HTTP fetch using `Photo.Url` from MemberHeader API. Use `Photo.PhotoDate` for smarter change detection. Maintain existing photo upload and deletion flows to Stadion.

</domain>

<decisions>
## Implementation Decisions

### Change detection behavior
- Re-download photo if PhotoDate OR URL changed (not just date)
- Store both PhotoDate and URL for comparison
- First run after migration: download all photos (treat missing stored data as "changed")
- Support `--force` flag to bypass change detection when needed

### Logging & reporting
- Email reports show summary counts: total photos, downloaded, skipped (unchanged), skipped (no photo), errors
- Distinguish "no photo" members from "photo unchanged" with separate counts
- Skipped photos logged in verbose mode only (cleaner normal logs)
- Photo errors grouped at end of report in dedicated section

### Migration approach
- Hard cutover: replace browser method entirely, no parallel running
- Delete `download-photos-from-sportlink.js` immediately (git has history)
- Merge photo download into people sync pipeline (eliminate separate `sync-photos.js`)
- Check all members with photos each people sync run (not just data-changed members)

### Error handling
- Retry 2-3 times on fetch failure (404, 500, timeout), then skip and continue
- Failed downloads marked as attempted; retry only when PhotoDate/URL changes
- Invalid/empty image data treated as error (logged, not uploaded)
- Photo errors are non-blocking (sync exits 0 if other operations succeed)

### Claude's Discretion
- Exact retry timing and backoff strategy
- HTTP fetch implementation details (timeout values, headers)
- Temp file handling during download
- Order of operations within people sync

</decisions>

<specifics>
## Specific Ideas

- Photo sync merges into hourly people sync — no more separate daily photo run
- Summary in email: "Photos: 245 total, 12 downloaded, 220 unchanged, 8 no photo, 5 errors"
- Errors section at bottom lists member names/IDs for failed downloads

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-photo-api-optimization*
*Context gathered: 2026-01-28*
