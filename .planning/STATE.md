# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention
**Current focus:** Phase 41 complete — ready for Phase 42

## Current Position

Phase: 42 of 43 (Code References) — IN PROGRESS
Plan: 1 of 3 in current phase (plan 42-01 complete)
Status: Plan 42-01 complete — step files renamed
Last activity: 2026-02-11 — Plan 42-01 executed (step files)

Progress: [████████████████████████████████████████░░░░] 95% (41 of 43 phases complete)

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
Recent decisions affecting v3.2:

- WAL mode + busy_timeout: Concurrent cron + web server access (critical for safe migration)
- CREATE+INSERT+DROP pattern: Avoid ALTER TABLE RENAME bugs seen in dashboard-db migration
- Stadion-to-Rondo rename: Reflect product name change across entire codebase
- [Phase 41-01]: Use CREATE+INSERT+DROP pattern for table migrations to avoid ALTER TABLE RENAME bugs
- [Phase 41-01]: Migration runs after pragmas but before initDb in openDb() for safety
- [Phase 41-02]: Migration bugs fixed via Rule 1 auto-fixes (incorrect table references, idempotency check)
- [Phase 41-03]: Use ALTER TABLE RENAME COLUMN for discipline_cases.stadion_id (safe for single-process discipline pipeline)

### Critical Deployment Note

**Phase 41 MUST be deployed atomically with Phase 42.** Migration runs automatically on openDb() and renames all tables. Plan 42-01 complete: steps/ files now use rondo_club naming. Plans 42-02 and 42-03 remain (pipelines/, tools/, lib/).

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

**Known from PROJECT.md:**
- INFRA-04 partial: web server runs as root (no sportlink user on server) — accepted for now
- Phase 39 (Multi-Club Readiness) deferred until second club onboards

## Session Continuity

Last session: 2026-02-11
Stopped at: Completed 42-01-PLAN.md (step files renamed to rondo_club)
Resume file: Ready for Phase 42 Plan 02 (pipelines and tools)
