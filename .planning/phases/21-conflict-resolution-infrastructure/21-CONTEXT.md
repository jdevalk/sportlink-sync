# Phase 21: Conflict Resolution Infrastructure - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect conflicts between Sportlink and Stadion field-level edits, then resolve using last-edit-wins logic. Infrastructure only — actual reverse sync happens in later phases.

</domain>

<decisions>
## Implementation Decisions

### Grace Period Behavior
- 5-second tolerance window for clock drift between systems
- Within grace period: Sportlink wins (forward sync takes precedence)
- Near-ties handled silently — no special logging or reporting
- Normal forward sync behavior when timestamps are within tolerance

### NULL Timestamp Handling
- When timestamps are NULL (no tracked history): current value wins
- Whichever system currently has the value keeps it until both sides have timestamps
- No waiting for both sides to have timestamps before syncing

### Claude's Discretion
- Exact comparison logic implementation
- Database schema for resolution tracking (if needed beyond existing columns)
- Conflict notification email format and content
- Audit trail structure for resolved conflicts
- Edge case handling for rapid successive edits

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for last-edit-wins conflict resolution.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-conflict-resolution-infrastructure*
*Context gathered: 2026-01-29*
