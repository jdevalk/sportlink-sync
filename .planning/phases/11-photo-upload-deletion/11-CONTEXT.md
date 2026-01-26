# Phase 11: Photo Upload and Deletion - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync downloaded member photos to Stadion WordPress and handle photo removal from both local storage and Stadion. Photos have already been downloaded in Phase 10. This phase uploads them to Stadion and handles deletions when photos are removed in Sportlink.

</domain>

<decisions>
## Implementation Decisions

### Upload behavior
- Always overwrite existing Stadion photo with new Sportlink photo (no date comparison)
- Log failures and continue — don't retry, don't fail fast
- Separate pass: download all photos first (Phase 10), then upload all to Stadion in Phase 11
- If member not found in Stadion: this is a data integrity error — member sync should have created them. Log as error, don't create member in photo sync.

### Claude's Discretion
- Deletion behavior (how to handle local and Stadion deletion when photo removed in Sportlink)
- Error handling details (what to log, how to surface in reports)
- Logging/reporting content (what statistics to capture for email report)
- API interaction patterns (batch vs sequential uploads)

</decisions>

<specifics>
## Specific Ideas

- Photo upload is a separate pass from download — fits existing pipeline pattern where each step is independent
- Member must exist in Stadion before photo upload (created by Phase 6/7) — photo sync doesn't create members

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-photo-upload-deletion*
*Context gathered: 2026-01-26*
