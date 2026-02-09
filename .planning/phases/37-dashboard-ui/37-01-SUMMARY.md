---
phase: 37-dashboard-ui
plan: 01
subsystem: ui
tags: [fastify, ejs, dashboard, sqlite, web]

# Dependency graph
requires:
  - phase: 36-web-server-and-authentication
    provides: Fastify web server with authentication and EJS templates
  - phase: 35-run-tracking
    provides: Dashboard database with runs, run_steps, and run_errors tables
provides:
  - Pipeline overview page with traffic-light status cards
  - Run history page with paginated run list per pipeline
  - Run detail page with per-step breakdown and counts
  - Dashboard queries module for reading dashboard database
  - Shared EJS layout partials with navigation and logout
affects: [37-02-error-browser, 38-email-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - EJS partials for shared layout (head/foot)
    - Helper functions for time formatting (formatRelativeTime, formatDuration)
    - Responsive CSS Grid for pipeline cards (3/2/1 columns)

key-files:
  created:
    - lib/dashboard-queries.js
    - views/partials/head.ejs
    - views/partials/foot.ejs
    - views/overview.ejs
    - views/run-history.ejs
    - views/run-detail.ejs
  modified:
    - lib/web-server.js
    - public/style.css

key-decisions:
  - "EJS partials pattern (include head/foot) instead of layout inheritance"
  - "formatRelativeTime and formatDuration helpers passed to all views"
  - "Overdue detection based on cron schedule × 1.5 grace period"
  - "20 runs per page for pagination"

patterns-established:
  - "Dashboard queries module with lazy database connection (open once, reuse)"
  - "Helper functions for formatting passed as locals to EJS templates"
  - "KNOWN_PIPELINES map for display names and validation"

# Metrics
duration: 3min
completed: 2026-02-09
---

# Phase 37 Plan 01: Dashboard Queries and Overview Summary

**Pipeline overview with traffic-light status cards, paginated run history tables, and per-step drill-down using server-rendered EJS templates**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-09T09:56:16Z
- **Completed:** 2026-02-09T09:59:37Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Dashboard overview shows all 6 pipelines with traffic-light status indicators (green/yellow/red/gray)
- Overdue pipelines flagged with orange badge based on cron schedule
- Run history page shows paginated list of runs per pipeline with outcome, counts, and duration
- Run detail page shows per-step breakdown with counts and link to error browser
- Shared layout with navigation (Overview, Errors) and logout button

## Task Commits

Each task was committed atomically:

1. **Task 1: Dashboard queries module and pipeline overview page** - `9dd22c4` (feat)
2. **Task 2: Run history and run detail pages** - `535c9d6` (feat)

## Files Created/Modified
- `lib/dashboard-queries.js` - Query functions for pipeline overview, run history, run detail
- `views/partials/head.ejs` - Shared layout header with navigation
- `views/partials/foot.ejs` - Shared layout footer
- `views/overview.ejs` - Pipeline overview grid with traffic-light cards
- `views/run-history.ejs` - Paginated run history table for a pipeline
- `views/run-detail.ejs` - Run detail with per-step breakdown
- `lib/web-server.js` - Added routes (GET /, GET /pipeline/:name, GET /run/:id) with helpers
- `public/style.css` - Added pipeline grid, data tables, pagination, breadcrumbs, run summary styles

## Decisions Made

**EJS partials pattern:** Used include('partials/head') and include('partials/foot') instead of layout inheritance, since @fastify/view doesn't natively support layouts. Simple and explicit.

**Overdue detection:** Each pipeline has a configured hours threshold (people: 4h, nikki: 25h, freescout: 25h, teams: 192h, functions: 4h, discipline: 192h). Pipeline is overdue if last run was more than threshold hours ago, or never run.

**Lazy database connection:** dashboard-queries.js opens database connection on first query and reuses it, closed via closeDb() in server onClose hook. Avoids opening multiple connections.

**Helper functions as locals:** formatRelativeTime and formatDuration passed to EJS views as locals, enabling consistent formatting across all templates.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Pipeline overview, run history, and run detail pages complete
- Ready for Phase 37-02 (Error Browser)
- Error browser will add /errors route with filtering by pipeline and date range
- Error detail will show individual member failures with stack traces

---
*Phase: 37-dashboard-ui*
*Completed: 2026-02-09*
