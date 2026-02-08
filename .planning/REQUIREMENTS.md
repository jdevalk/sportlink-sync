# Requirements: Rondo Sync v3.0 Web Dashboard

**Defined:** 2026-02-08
**Core Value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention.

## v3.0 Requirements

Requirements for the web dashboard milestone. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: Node.js upgraded from 18 to 22 LTS on the production server
- [x] **INFRA-02**: All SQLite databases use WAL journal mode with busy_timeout for concurrent access
- [x] **INFRA-03**: Dashboard database (`dashboard.sqlite`) created with run tracking schema
- [ ] **INFRA-04**: Web server runs as non-root user with minimal permissions

### Run Tracking

- [x] **TRACK-01**: Each pipeline run records start time, end time, duration, and outcome (success/failure) to dashboard database
- [x] **TRACK-02**: Per-step statistics (created, updated, skipped, failed counts) are persisted per run
- [x] **TRACK-03**: Individual sync errors are stored with member identifier, step, error message, and timestamp
- [x] **TRACK-04**: All 6 pipelines (people, nikki, teams, functions, discipline, freescout) are instrumented with run tracking
- [x] **TRACK-05**: Run tracking adds minimal code to each pipeline (thin wrapper, not restructuring)

### Authentication

- [ ] **AUTH-01**: Users log in with individual username and password
- [ ] **AUTH-02**: Passwords are hashed with Argon2id
- [ ] **AUTH-03**: Sessions persist across browser refresh via secure cookies
- [ ] **AUTH-04**: All dashboard routes require authentication (no public pages except login)
- [ ] **AUTH-05**: CLI tool exists to create/manage user accounts

### Web Server

- [ ] **WEB-01**: Fastify web server serves the dashboard on the production server
- [ ] **WEB-02**: Nginx reverse proxy handles TLS termination
- [ ] **WEB-03**: Web server managed by systemd with automatic restart on crash
- [ ] **WEB-04**: Web server binds to localhost only (not exposed directly)

### Dashboard UI

- [ ] **DASH-01**: Pipeline overview page shows traffic-light status (green/yellow/red) for all 6 pipelines
- [ ] **DASH-02**: Each pipeline shows last run time, outcome, and key counts
- [ ] **DASH-03**: Overdue pipelines are flagged (missed expected schedule)
- [ ] **DASH-04**: Run history page per pipeline with paginated list of past runs
- [ ] **DASH-05**: Run detail view shows per-step breakdown with counts
- [ ] **DASH-06**: Error browser lists all errors with filtering by pipeline and date range
- [ ] **DASH-07**: Error drill-down shows individual member failures with error details
- [ ] **DASH-08**: Dashboard layout is responsive (usable on phone)
- [ ] **DASH-09**: Dashboard uses server-rendered HTML (no SPA framework, no build step)

### Email Migration

- [ ] **EMAIL-01**: Email reports sent only when errors occur (replace always-send)
- [ ] **EMAIL-02**: Error emails include a link to the relevant run detail in the dashboard

### Multi-Club Readiness

- [x] **MULTI-01**: Dashboard database schema includes `club_slug` column for future multi-club support
- [ ] **MULTI-02**: Code architecture supports adding clubs without restructuring (database-per-club model)

## v3.1+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dashboard Enhancements

- **ENHANCE-01**: Duration trend chart showing performance over time per pipeline
- **ENHANCE-02**: Per-member error history (all errors for a specific member across runs)
- **ENHANCE-03**: Database statistics page (record counts from all sync databases)
- **ENHANCE-04**: Log file viewer (read log files from dashboard instead of SSH)
- **ENHANCE-05**: Cron schedule visualization (timeline of scheduled runs)

### Advanced Operations

- **OPS-01**: Manual trigger button for pipeline runs from the dashboard
- **OPS-02**: Live run progress indicator during active sync
- **OPS-03**: Run diff view comparing two runs' outputs
- **OPS-04**: Role-based permissions (admin vs viewer)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time auto-refresh (<60s) | Pipelines run 4x/day max; 60-second polling is sufficient |
| Full log streaming via WebSocket | Over-engineered for internal tool with 3-10 users |
| Member data CRUD | That is WordPress/Sportlink's job, not the dashboard |
| Pipeline configuration UI | Too dangerous; SSH for config changes |
| GraphQL API | Dashboard is the only consumer; REST routes sufficient |
| React/SPA frontend | Massive overhead for read-only dashboard; server-rendered HTML is sufficient |
| Docker/containerization | Single-server deployment; adds complexity for no benefit |
| Redis for sessions | SQLite handles the scale (3-10 users) |
| TypeScript migration | Would split codebase; project is pure JavaScript |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 34 | Complete |
| INFRA-02 | Phase 34 | Complete |
| INFRA-03 | Phase 34 | Complete |
| INFRA-04 | Phase 36 | Pending |
| TRACK-01 | Phase 35 | Complete |
| TRACK-02 | Phase 35 | Complete |
| TRACK-03 | Phase 35 | Complete |
| TRACK-04 | Phase 35 | Complete |
| TRACK-05 | Phase 35 | Complete |
| AUTH-01 | Phase 36 | Pending |
| AUTH-02 | Phase 36 | Pending |
| AUTH-03 | Phase 36 | Pending |
| AUTH-04 | Phase 36 | Pending |
| AUTH-05 | Phase 36 | Pending |
| WEB-01 | Phase 36 | Pending |
| WEB-02 | Phase 36 | Pending |
| WEB-03 | Phase 36 | Pending |
| WEB-04 | Phase 36 | Pending |
| DASH-01 | Phase 37 | Pending |
| DASH-02 | Phase 37 | Pending |
| DASH-03 | Phase 37 | Pending |
| DASH-04 | Phase 37 | Pending |
| DASH-05 | Phase 37 | Pending |
| DASH-06 | Phase 37 | Pending |
| DASH-07 | Phase 37 | Pending |
| DASH-08 | Phase 37 | Pending |
| DASH-09 | Phase 37 | Pending |
| EMAIL-01 | Phase 38 | Pending |
| EMAIL-02 | Phase 38 | Pending |
| MULTI-01 | Phase 34 | Complete |
| MULTI-02 | Phase 39 | Pending |

**Coverage:**
- v3.0 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-08*
*Last updated: 2026-02-08 after initial definition*
