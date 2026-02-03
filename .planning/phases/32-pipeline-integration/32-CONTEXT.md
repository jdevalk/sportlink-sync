# Phase 32: Pipeline Integration - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate discipline case sync into the existing automation infrastructure. Add CLI command (`scripts/sync.sh discipline`), configure cron scheduling, and include discipline statistics in email reports.

</domain>

<decisions>
## Implementation Decisions

### Sync frequency
- Weekly sync on Monday nights (late night, 11 PM - 1 AM range)
- Monday chosen because weekend matches are processed by Sportlink by then
- Independent command: `scripts/sync.sh discipline` as standalone
- Own cron entry, not bundled with other syncs

### Claude's Discretion
- Exact time within the 11 PM - 1 AM window
- Email report format and statistics to include
- Error handling and retry behavior (follow existing patterns)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing sync pipeline patterns (sync-teams.js, sync-functions.js).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 32-pipeline-integration*
*Context gathered: 2026-02-03*
