# Phase 12: Pipeline Integration - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate photo sync into the daily sync-all pipeline with email reporting. The photo download (Phase 10) and upload/deletion (Phase 11) functionality is complete. This phase connects those pieces into the automated workflow.

</domain>

<decisions>
## Implementation Decisions

### Email Report Format
- Photo stats integrated into existing report (not a separate section)
- Show counts only: downloaded, uploaded, deleted
- Always mention photos even with zero activity ("Photos: 0 changes")
- Errors shown as count + summary: "2 errors: network timeout (1), invalid format (1)"
- Include coverage stat: "Photos: 45 of 120 members have photos"

### Failure Isolation
- Photo sync failures do not block member sync — pipeline continues
- Best effort for individual photos: sync what we can, log failures, continue
- Photo errors DO affect overall exit code (non-zero if photo errors)
- Photo download and upload stages are independent — upload runs even if download failed

### Execution Order
- Photo sync runs AFTER member sync (ensures person records exist in Stadion)
- Two separate steps: download phase, then upload/delete phase
- Try to reuse Sportlink session between member download and photo download
- Add separate npm scripts for photo-only sync (npm run sync-photos)

### Photo Sync Triggering
- Photo sync runs every time with sync-all (not conditional on changes)
- Report includes photo coverage (X of Y members have photos)

### Claude's Discretion
- Whether to add --no-photos skip flag to sync-all
- Retry behavior alignment with existing cron patterns
- Session reuse implementation details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches that match existing pipeline patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-pipeline-integration*
*Context gathered: 2026-01-26*
