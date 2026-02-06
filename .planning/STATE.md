# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention.
**Current focus:** v2.3 Birthday Field Migration - Phase 33

## Current Position

Phase: 33 of 33 (Birthday Field Migration)
Plan: 1 of 4 complete
Status: In progress
Last activity: 2026-02-06 — Completed 33-01-PLAN.md (Add birthdate ACF field)

Progress: [██░░░░░░░░] 25%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.3]: All 4 birthday migration requirements in single phase (tightly coupled, no natural split)
- [v2.3]: Birthdate field uses Y-m-d format matching Stadion ACF date field convention
- [33-01]: No separate birthdate counter in email report - birthdate is just another ACF field covered by existing person sync stats

### Pending Todos

6 pending:
- [fetch-invoice-addresses-from-sportlink](./todos/pending/2026-02-04-fetch-invoice-addresses-from-sportlink.md) - Fetch invoice addresses and email from Sportlink financial tab
- [review-deleted-member-handling](./todos/pending/2026-02-06-review-deleted-member-handling.md) - Review how deleted members are handled across all downstream systems
- [adapt-birthday-sync-to-acf-field](./todos/pending/2026-02-06-adapt-birthday-sync-to-acf-field.md) - Adapt birthday sync to new Stadion ACF field model (**in milestone v2.3**)
- [rename-project-to-rondo](./todos/pending/2026-02-06-rename-project-to-rondo.md) - Rename project from Sportlink Sync to Rondo Sync (Stadion -> Rondo Club)
- [document-and-simplify-adding-sync-targets](./todos/pending/2026-02-06-document-and-simplify-adding-sync-targets.md) - Document and simplify adding custom sync targets
- [detect-stale-parent-email-addresses](./todos/pending/2026-02-06-detect-stale-parent-email-addresses.md) - Detect and flag stale parent email addresses

### Active Debug Sessions

2 active:
- birthday-sync-404-errors.md (likely resolved by v2.3 migration)
- download-functions-no-api-response.md

### Blockers/Concerns

- **Production testing needed (33-01):** Must verify birthdate field appears in Stadion after next sync and email report has correct format
- **Unused code (33-02):** steps/sync-important-dates.js still exists but is now unused - will be removed in Phase 33-02

## Session Continuity

Last session: 2026-02-06
Stopped at: Completed 33-01-PLAN.md execution (Add birthdate ACF field)
Resume file: None
Next steps: Continue to 33-02 (Remove unused birthday sync code) or test 33-01 on production
