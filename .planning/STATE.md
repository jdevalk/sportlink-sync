# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention.
**Current focus:** v3.0 Web Dashboard -- Phase 38: Email Migration (complete)

## Current Position

Phase: 38 of 38 (Email Migration) -- fifth of 5 active phases
Plan: 1 of 1 in current phase
Status: Phase complete
Last activity: 2026-02-09 -- Completed 38-01-PLAN.md

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 14.7 min
- Total execution time: 103 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 34-infrastructure-foundation | 1 | 8 min | 8 min |
| 35-run-tracking | 1 | 67 min | 67 min |
| 36-web-server-and-authentication | 2 | 15 min | 7.5 min |
| 37-dashboard-ui | 2 | 11 min | 5.5 min |
| 38-email-migration | 1 | 2 min | 2 min |

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
| 37 | EJS partials pattern (include head/foot) | @fastify/view doesn't support layout inheritance natively |
| 37 | Overdue detection based on cron schedule | Each pipeline has threshold (people/functions: 4h, nikki/freescout: 25h, teams/discipline: 192h) |
| 37 | Lazy database connection in queries module | Open once, reuse, close on server shutdown via onClose hook |
| 37 | Helper functions as EJS locals | formatRelativeTime and formatDuration passed to all views for consistent formatting |
| 37 | Dynamic WHERE clause for error filtering | Builds conditions based on pipeline, date range, run ID filters |
| 37 | Progressive disclosure for stack traces | HTML details/summary keeps page clean, traces accessible on click |
| 38 | Alert-only emails replace success reports | Dashboard is source of truth, emails only for failures/overdue |
| 38 | Periodic overdue checks in web server | 30-min interval with 4-hour cooldown prevents spam |

### Pending Todos

7 pending:
- [fetch-invoice-addresses-from-sportlink](./todos/pending/2026-02-04-fetch-invoice-addresses-from-sportlink.md) - Fetch invoice addresses and email from Sportlink financial tab
- [review-deleted-member-handling](./todos/pending/2026-02-06-review-deleted-member-handling.md) - Review how deleted members are handled across all downstream systems
- [adapt-birthday-sync-to-acf-field](./todos/pending/2026-02-06-adapt-birthday-sync-to-acf-field.md) - Adapt birthday sync to new Stadion ACF field model (**completed in v2.3**)
- [rename-project-to-rondo](./todos/pending/2026-02-06-rename-project-to-rondo.md) - Rename project from Rondo Sync to Rondo Sync (Stadion -> Rondo Club)
- [document-and-simplify-adding-sync-targets](./todos/pending/2026-02-06-document-and-simplify-adding-sync-targets.md) - Document and simplify adding custom sync targets
- [detect-stale-parent-email-addresses](./todos/pending/2026-02-06-detect-stale-parent-email-addresses.md) - Detect and flag stale parent email addresses
- [create-dedicated-service-user-for-web-server](./todos/pending/2026-02-09-create-dedicated-service-user-for-web-server.md) - Create dedicated service user for web server (security hardening)

### Active Debug Sessions

1 active:
- download-functions-no-api-response.md

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-09
Stopped at: Completed 38-01-PLAN.md (Phase 38: Email Migration)
Resume file: None
Next steps: v3.0 Web Dashboard milestone complete
