# Phase 23: Contact Fields Reverse Sync - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Push contact field corrections (email, email2, mobile, phone) from Stadion to Sportlink via browser automation on the /general page. This phase covers the automation mechanics — change detection is already complete in Phase 22. Free fields and financial toggle are Phase 24.

</domain>

<decisions>
## Implementation Decisions

### Operator notifications
- Report detail level controlled by setting (environment variable or config)
- Default: summary only ("5 members updated, 1 failed")
- Optional: field-level detail showing old→new values per member (for testing/debugging)
- Failures included in regular post-sync summary email, no immediate alerts
- No email sent when nothing to sync (no-op runs are silent)
- Reverse sync results added as section in existing sync report email (combined, not separate)

### Claude's Discretion
- Batch processing approach (all at once vs sequential with delays)
- Verification method for confirming Sportlink saved values
- Retry logic and exponential backoff parameters
- Partial success handling (if some fields save but others fail)
- Exact format of the reverse sync section in combined email

</decisions>

<specifics>
## Specific Ideas

- Setting for report verbosity allows toggling to field-level detail during testing without code changes

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-contact-fields-reverse-sync*
*Context gathered: 2026-01-29*
