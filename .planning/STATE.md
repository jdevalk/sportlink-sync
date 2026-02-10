# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention
**Current focus:** Phase 41 - Database Migration

## Current Position

Phase: 41 of 43 (Database Migration)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-10 — Roadmap created for v3.2 milestone

Progress: [████████████████████████████████████████░░░░] 93% (40 of 43 phases complete)

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
Recent decisions affecting v3.2:

- WAL mode + busy_timeout: Concurrent cron + web server access (critical for safe migration)
- CREATE+INSERT+DROP pattern: Avoid ALTER TABLE RENAME bugs seen in dashboard-db migration
- Stadion-to-Rondo rename: Reflect product name change across entire codebase

### Pending Todos

8 pending (see /gsd:check-todos for full list):
- fetch-invoice-addresses-from-sportlink
- review-deleted-member-handling
- rename-project-to-rondo (in progress as v3.2)
- document-and-simplify-adding-sync-targets
- detect-stale-parent-email-addresses
- rename-stadion-references-to-rondo-in-database-structure (in progress as v3.2)
- improve-freescout-integration-with-rondo-club

### Active Debug Sessions

1 active:
- download-functions-no-api-response.md

### Blockers/Concerns

**Critical for Phase 41:**
- Migration must use CREATE+INSERT+DROP pattern (NOT ALTER TABLE RENAME) to avoid concurrent access bugs
- Server runs continuous cron syncs - migration must be non-disruptive
- Testing on production server required (no local sync allowed)

**Known from PROJECT.md:**
- INFRA-04 partial: web server runs as root (no sportlink user on server) — accepted for now
- Phase 39 (Multi-Club Readiness) deferred until second club onboards

## Session Continuity

Last session: 2026-02-10
Stopped at: Roadmap created for v3.2 Stadion-to-Rondo Rename milestone
Resume file: None - ready to start Phase 41 planning
