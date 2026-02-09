# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention.
**Current focus:** v3.0 Web Dashboard -- Phase 36: Web Server and Authentication

## Current Position

Phase: 36 of 38 (Web Server and Authentication) -- third of 5 active phases
Plan: 2 of 2 in current phase
Status: Phase complete
Last activity: 2026-02-09 -- Completed 36-02-PLAN.md

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 22.5 min
- Total execution time: 90 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 34-infrastructure-foundation | 1 | 8 min | 8 min |
| 35-run-tracking | 1 | 67 min | 67 min |
| 36-web-server-and-authentication | 2 | 15 min | 7.5 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

| Phase | Decision | Impact |
|-------|----------|--------|
| 34 | 5000ms busy_timeout for concurrent access | Enough time for writes without excessive blocking |
| 35 | RunTracker methods wrapped in _safe() | Tracking failures never crash pipelines |
| 35 | Per-run database connection | Each pipeline run gets its own connection, closed after endRun |
| 35 | sync-all delegates step tracking | 'all' pipeline tracks run-level, delegated pipelines track their own step details |
| 36 | SQLite session store for persistence | Sessions survive server restarts, no memory leak from default in-memory store |
| 36 | Argon2id for password hashing | OWASP recommended, memory-hard, resistant to GPU attacks |
| 36 | Pre-hashed passwords in users.json | Passwords never in plain text, even during setup |
| 36 | Rate limit login: 5/min per IP | Balance security (prevent brute force) and usability (allow typos) |
| 36 | Systemd service runs as root | No sportlink user on server; all existing services run as root |
| 36 | Cloudflare DNS proxy | DNS resolves to Cloudflare IPs, proxied to origin server |

### Pending Todos

6 pending:
- [fetch-invoice-addresses-from-sportlink](./todos/pending/2026-02-04-fetch-invoice-addresses-from-sportlink.md) - Fetch invoice addresses and email from Sportlink financial tab
- [review-deleted-member-handling](./todos/pending/2026-02-06-review-deleted-member-handling.md) - Review how deleted members are handled across all downstream systems
- [adapt-birthday-sync-to-acf-field](./todos/pending/2026-02-06-adapt-birthday-sync-to-acf-field.md) - Adapt birthday sync to new Stadion ACF field model (**completed in v2.3**)
- [rename-project-to-rondo](./todos/pending/2026-02-06-rename-project-to-rondo.md) - Rename project from Rondo Sync to Rondo Sync (Stadion -> Rondo Club)
- [document-and-simplify-adding-sync-targets](./todos/pending/2026-02-06-document-and-simplify-adding-sync-targets.md) - Document and simplify adding custom sync targets
- [detect-stale-parent-email-addresses](./todos/pending/2026-02-06-detect-stale-parent-email-addresses.md) - Detect and flag stale parent email addresses

### Active Debug Sessions

1 active:
- download-functions-no-api-response.md

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-09
Stopped at: Completed Phase 36 (Web Server and Authentication)
Resume file: None
Next steps: `/gsd:plan-phase 37` to plan Dashboard UI
