# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention
**Current focus:** v3.2 Stadion-to-Rondo Rename milestone complete

## Current Position

Phase: 43 of 43 (Documentation) — COMPLETE
Plan: 2 of 2 in current phase (all plans complete)
Status: Phase 43 complete, verified (passed). Milestone v3.2 complete.
Last activity: 2026-02-11 — Phase 43 executed and verified

Progress: [████████████████████████████████████████████] 100% (43 of 43 phases complete, v3.2 milestone shipped)

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
- [Phase 42-02]: Use rondoClub camelCase for function parameters, rondo_club_id for DB columns
- [Phase 42-03]: Completed codebase-wide stadion→rondo_club rename (17 files: pipelines, tools, lib)
- [Phase 43-01]: Completed documentation stadion→rondo_club rename (15 files: docs/, CLAUDE.md, package.json)
- [Phase 43-02]: Renamed all stadion references in developer docs site (13 files, 184 occurrences)

### Critical Deployment Note

**Phase 41 + 42 MUST be deployed atomically.** Migration runs automatically on openDb() and renames all tables. Phase 42 complete: all code references updated (steps/, pipelines/, tools/, lib/). Only lib/rondo-club-db.js and lib/discipline-db.js retain stadion references (migration code).

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
Stopped at: v3.2 Stadion-to-Rondo Rename milestone complete (all 3 phases: 41, 42, 43)
Resume file: Milestone complete — ready for /gsd:complete-milestone
