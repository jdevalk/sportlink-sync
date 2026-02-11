# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention
**Current focus:** Phase 41 - Database Migration

## Current Position

Phase: 41 of 43 (Database Migration)
Plan: 1 of 3 in current phase
Status: Executing phase plans
Last activity: 2026-02-11 — Completed 41-01: Database migration infrastructure

Progress: [████████████████████████████████████████░░░░] 93% (40 of 43 phases complete, 1 of 3 plans in Phase 41)

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
Recent decisions affecting v3.2:

- WAL mode + busy_timeout: Concurrent cron + web server access (critical for safe migration)
- CREATE+INSERT+DROP pattern: Avoid ALTER TABLE RENAME bugs seen in dashboard-db migration
- Stadion-to-Rondo rename: Reflect product name change across entire codebase
- [Phase 41-01]: Use CREATE+INSERT+DROP pattern for table migrations to avoid ALTER TABLE RENAME bugs
- [Phase 41-01]: Migration runs after pragmas but before initDb in openDb() for safety

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

Last session: 2026-02-11
Stopped at: Completed 41-01-PLAN.md: Database migration infrastructure
Resume file: Ready to execute 41-02-PLAN.md (SQL query layer updates)
