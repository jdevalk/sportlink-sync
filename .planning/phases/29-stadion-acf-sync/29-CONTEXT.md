# Phase 29: Stadion ACF Sync - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync individual per-year contribution fields from SQLite to Stadion person ACF fields. Members with contribution data get year-specific fields updated. This is data push only — no UI, no new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Field naming pattern
- Prefix: `_nikki_{year}` (underscore prefix for private ACF convention)
- Full 4-digit year: `_nikki_2025_total`, not `_nikki_25_total`
- Three suffixes per year: `_total`, `_saldo`, `_status`
- Example fields: `_nikki_2025_total`, `_nikki_2025_saldo`, `_nikki_2025_status`
- Dynamic field names — no ACF registration needed in Stadion

### Sync behavior
- Missing years: leave empty/null (don't set field if no data exists)
- Updates: always overwrite (latest Nikki data wins, no change detection)
- Batch scope: all available years in one PUT per member
- Old year cleanup: leave old fields in place (beyond 4-year window stays harmless)

### Claude's Discretion
- API batching strategy (parallel vs sequential member updates)
- Error logging format
- Progress reporting during sync

</decisions>

<specifics>
## Specific Ideas

No specific requirements — follow existing sync patterns from other Stadion sync scripts.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 29-stadion-acf-sync*
*Context gathered: 2026-02-01*
