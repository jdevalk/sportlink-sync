# Phase 14: Work History Sync - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Link persons to their teams via work_history entries in Stadion. Track team assignments in SQLite and detect changes to update work history accordingly. Creating teams is Phase 13; pipeline integration is Phase 15.

</domain>

<decisions>
## Implementation Decisions

### Change Detection
- Verify team exists before creating work_history (use local SQLite cache, not REST calls)
- Track current team(s) per member in SQLite, compare on each sync
- When team changes: set end_date (day before today) on old entry, create new entry with today as start_date
- New work_history entries get today's date as start_date

### Edge Cases
- Members with no team (both UnionTeams and ClubTeams empty): skip work_history entirely
- Member had team but now has none: end existing work_history entry (set end_date)
- Members can be in multiple teams simultaneously
- Track each team separately — if member was in A+B and is now in A+C: end B's history, keep A unchanged, add C

### Historical Data
- Backfill work_history for all existing persons with teams
- Backfilled entries: leave start_date empty (signals "we don't know when they joined")
- New entries from tracked changes: use today's date as start_date
- Preserve manually created work_history entries in Stadion
- Track sync-created work_history IDs in SQLite (to distinguish from manual entries)

### Claude's Discretion
- SQLite schema for tracking work_history IDs and team assignments
- Error handling for partial failures
- Exact API field names for work_history in Stadion

</decisions>

<specifics>
## Specific Ideas

- Use existing SQLite team cache from Phase 13 to verify teams exist
- Follow the hash-based change detection pattern already established for members
- Clean history trail: old entries get end_date, new entries get start_date

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-work-history-sync*
*Context gathered: 2026-01-26*
