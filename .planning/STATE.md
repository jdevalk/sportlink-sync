# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-09)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention

**Current focus:** Phase 40 - Former Member Import Tool

## Current Position

Phase: 40 of 40 (Former Member Import Tool)
Plan: 2 of 2
Status: Complete
Last activity: 2026-02-09 — Completed 40-02-PLAN.md

Progress: [██████████████████████████████] 100% (41/41 plans complete across all milestones)

## Performance Metrics

**Velocity (v3.1):**
- Total plans completed: 9
- Average duration: 12.0 min
- Total execution time: 109 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 34-infrastructure-foundation | 1 | 8 min | 8 min |
| 35-run-tracking | 1 | 67 min | 67 min |
| 36-web-server-and-authentication | 2 | 15 min | 7.5 min |
| 37-dashboard-ui | 2 | 11 min | 5.5 min |
| 38-email-migration | 1 | 2 min | 2 min |
| 40-former-member-import-tool | 2 | 4 min | 2 min |

## Accumulated Context

### Decisions

Recent decisions affecting v3.1 work:
- Phase 38: Error-only email alerts with dashboard as source of truth
- Phase 35: RunTracker safety wrapping prevents tracking failures from crashing pipelines
- Phase 34: WAL mode + busy_timeout for concurrent cron + web server database access
- v2.0: Per-field timestamp tracking for bidirectional sync with last-write-wins

Full decision log in PROJECT.md Key Decisions table.
- [Phase 40-former-member-import-tool]: Status filter toggle uses three fallback strategies for resilience to Sportlink UI changes
- [Phase 40-former-member-import-tool]: Former members cached to data/former-members.json for resume support after partial failure
- [Phase 40-former-member-import-tool]: Dry-run is default behavior (--import required to execute) following safe-by-default pattern
- [Phase 40-former-member-import-tool]: Photo steps integrated into import tool rather than separate script for atomic operation
- [Phase 40-former-member-import-tool]: --skip-photos flag allows member-only import for testing
- [Phase 40-former-member-import-tool]: Photo failures don't prevent member sync completion (non-critical steps)

### Pending Todos

8 pending:
- [fetch-invoice-addresses-from-sportlink](./todos/pending/2026-02-04-fetch-invoice-addresses-from-sportlink.md) - Fetch invoice addresses and email from Sportlink financial tab
- [review-deleted-member-handling](./todos/pending/2026-02-06-review-deleted-member-handling.md) - Review how deleted members are handled across all downstream systems
- [adapt-birthday-sync-to-acf-field](./todos/pending/2026-02-06-adapt-birthday-sync-to-acf-field.md) - Adapt birthday sync to new Stadion ACF field model (completed in v2.3)
- [rename-project-to-rondo](./todos/pending/2026-02-06-rename-project-to-rondo.md) - Rename project from Rondo Sync to Rondo Sync (Stadion -> Rondo Club)
- [document-and-simplify-adding-sync-targets](./todos/pending/2026-02-06-document-and-simplify-adding-sync-targets.md) - Document and simplify adding custom sync targets
- [detect-stale-parent-email-addresses](./todos/pending/2026-02-06-detect-stale-parent-email-addresses.md) - Detect and flag stale parent email addresses
- [rename-stadion-references-to-rondo-in-database-structure](./todos/pending/2026-02-09-rename-stadion-references-to-rondo-in-database-structure.md) - Rename stadion references to rondo in database structure
- [improve-freescout-integration-with-rondo-club](./todos/pending/2026-02-09-improve-freescout-integration-with-rondo-club.md) - Improve FreeScout integration: emails as activities in Rondo Club + photos from Rondo Club

### Active Debug Sessions

1 active:
- download-functions-no-api-response.md

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 23 | Disable Start button while pipeline is running: UI disabled state + 409 server guard | 2026-02-09 | d746305 | [23-disable-pipeline-start-button-while-pipe](./quick/23-disable-pipeline-start-button-while-pipe/) |
| 22 | Handle 404 photo downloads as permanent errors: 'error' state for unavailable photos, auto-retry on PersonImageDate change | 2026-02-09 | ee9a191 | [22-handle-404-photo-downloads-as-permanent-](./quick/22-handle-404-photo-downloads-as-permanent-/) |
| 21 | Add crash-resilient run tracking: Process-level handlers mark runs as failed on uncaught exceptions | 2026-02-09 | 959ccfb | [21-add-crash-resilient-run-tracking-that-ma](./quick/21-add-crash-resilient-run-tracking-that-ma/) |

### Blockers/Concerns

- INFRA-04 partial: web server runs as root (no sportlink user on server) — accepted for now
- Phase 39 (Multi-Club Readiness) deferred until second club onboards

## Session Continuity

Last session: 2026-02-09
Stopped at: Completed 40-02-PLAN.md
Resume file: None
