# Phase 20: Foundation (Database & Origin Tracking) - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Database schema supports bidirectional timestamp tracking and origin attribution to prevent infinite sync loops. This phase modifies the SQLite schema to track when each system last modified each field, enabling conflict resolution in later phases.

</domain>

<decisions>
## Implementation Decisions

### Timestamp tracking design
- Per-field timestamps, not per-record — each syncable field has its own modification timestamps
- Two timestamps per field: `stadion_modified` and `sportlink_modified` (named by source system)
- Fields that need tracking: contact fields (email, email2, mobile, phone) plus free fields (datum-vog, freescout-id, financiele-blokkade)
- Storage: new columns directly in `stadion_members` table (e.g., `email_stadion_modified`, `email_sportlink_modified`)

### Claude's Discretion
- Origin attribution approach — how to mark edits as user vs sync-initiated
- Migration script implementation — exact SQL and backfill strategy
- UTC normalization and clock drift handling — technical implementation details

</decisions>

<specifics>
## Specific Ideas

- Naming convention uses system names (`stadion_modified`, `sportlink_modified`) rather than direction names (`forward_modified`, `reverse_modified`) for clarity when reading data

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-foundation*
*Context gathered: 2026-01-29*
