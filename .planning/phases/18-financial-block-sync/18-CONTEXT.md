# Phase 18: Financial Block Sync - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync financial transfer block status from Sportlink (captured in Phase 17) to Stadion WordPress. Update the `financiele-blokkade` ACF field and log status changes as activities on the Person.

</domain>

<decisions>
## Implementation Decisions

### Status display
- Use boolean true/false for the `financiele-blokkade` ACF field (user handles display formatting in Stadion)
- Treat missing/null data as "not blocked" (false)
- Visual styling in Stadion will be handled separately by the user

### Historical tracking
- Log status changes as activities on the Person in Stadion
- Activity text: "Financiële blokkade ingesteld" when blocked, "Financiële blokkade opgeheven" when unblocked
- Include date in activity (use sync date since API doesn't provide block date)
- Log initial state on first sync (if someone is blocked when first captured, log it)

### Edge case handling
- Log changes only when status differs from previous sync (natural rate limiting via periodic sync)
- If activity logging API fails, continue with field update anyway (field sync takes priority)
- Sync financial block status for both members AND parents
- Clean up tracking data when member is deleted from Stadion

### Claude's Discretion
- Error message formatting
- Retry logic details (if any)
- Hash computation implementation details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches consistent with existing sync patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-financial-block-sync*
*Context gathered: 2026-01-28*
