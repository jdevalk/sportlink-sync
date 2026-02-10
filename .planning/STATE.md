# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention
**Current focus:** v3.2 Stadion-to-Rondo Rename

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-10 — Milestone v3.2 started

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

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

### Blockers/Concerns

- INFRA-04 partial: web server runs as root (no sportlink user on server) — accepted for now
- Phase 39 (Multi-Club Readiness) deferred until second club onboards

## Session Continuity

Last session: 2026-02-10
Stopped at: Defining v3.2 requirements
Resume file: None
