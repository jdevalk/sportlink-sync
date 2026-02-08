# Roadmap: Rondo Sync v3.0 Web Dashboard

## Overview

Transform Rondo Sync from a CLI-only cron tool into a web-monitored system with a browser-based dashboard for pipeline status, run history, and error investigation. The journey starts with infrastructure prerequisites (Node.js upgrade, WAL mode), adds structured run data capture, stands up an authenticated web server, builds the dashboard UI, and finishes by migrating email reports to error-only alerts. A future multi-club phase is deferred until a second club is onboarded.

## Phases

**Phase Numbering:**
- Continues from v2.3 (phases 1-33 shipped). This milestone starts at Phase 34.
- Integer phases (34, 35, 36): Planned milestone work
- Decimal phases (35.1, 35.2): Urgent insertions if needed (marked with INSERTED)

- [ ] **Phase 34: Infrastructure Foundation** - Node.js 22 upgrade, WAL mode on all databases, dashboard database schema
- [ ] **Phase 35: Run Tracking** - Persist pipeline stats to dashboard database, instrument all 6 pipelines
- [ ] **Phase 36: Web Server and Authentication** - Fastify server with nginx/TLS, systemd service, per-user login
- [ ] **Phase 37: Dashboard UI** - Pipeline overview, run history, run detail, and error browser views
- [ ] **Phase 38: Email Migration** - Switch email reports to error-only alerts with dashboard links
- [ ] **Phase 39: Multi-Club Readiness** - Database-per-club layout and config registry (deferred until second club)

## Phase Details

### Phase 34: Infrastructure Foundation
**Goal**: Production server is ready for concurrent database access from both cron pipelines and a long-running web server
**Depends on**: Nothing (first phase of milestone)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, MULTI-01
**Research**: Skip (standard operations)
**Success Criteria** (what must be TRUE):
  1. `node --version` on the production server reports v22.x
  2. Every existing SQLite database opens in WAL journal mode with a busy_timeout configured
  3. `dashboard.sqlite` exists with `runs`, `run_steps`, and `run_errors` tables, all including a `club_slug` column
  4. All existing cron pipelines continue to run successfully after the upgrade (no regressions)
**Plans**: TBD

Plans:
- [ ] 34-01: Node.js 22 upgrade, WAL migration, and dashboard database schema

### Phase 35: Run Tracking
**Goal**: Every pipeline run produces structured, queryable data in the dashboard database
**Depends on**: Phase 34
**Requirements**: TRACK-01, TRACK-02, TRACK-03, TRACK-04, TRACK-05
**Research**: Skip (extends existing patterns)
**Success Criteria** (what must be TRUE):
  1. After any pipeline runs, `dashboard.sqlite` contains a row in `runs` with start time, end time, duration, and outcome
  2. Each run has per-step rows in `run_steps` with created/updated/skipped/failed counts
  3. Individual sync errors are stored in `run_errors` with member identifier, step name, error message, and timestamp
  4. All 6 pipelines (people, nikki, teams, functions, discipline, freescout) write run data without modifying their core sync logic
  5. Run tracking code is a thin wrapper (`lib/run-tracker.js`), not a restructuring of pipeline internals
**Plans**: TBD

Plans:
- [ ] 35-01: Run tracker library and pipeline instrumentation

### Phase 36: Web Server and Authentication
**Goal**: An authenticated web server is running on the production server, accessible via HTTPS, managed by systemd
**Depends on**: Phase 35
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, WEB-01, WEB-02, WEB-03, WEB-04, INFRA-04
**Research**: NEEDS RESEARCH (nginx/TLS setup on this server, session store compatibility with Fastify v5, firewall rules)
**Success Criteria** (what must be TRUE):
  1. A user can navigate to the dashboard URL in a browser and see a login page over HTTPS
  2. A user can log in with their individual username and password, and their session persists across browser refreshes
  3. All dashboard routes redirect unauthenticated visitors to the login page
  4. The web server process restarts automatically after a crash or server reboot (systemd)
  5. The web server runs as a non-root user that cannot read Sportlink/Laposta API credentials
**Plans**: TBD

Plans:
- [ ] 36-01: Fastify server, authentication, and deployment infrastructure

### Phase 37: Dashboard UI
**Goal**: Operators can monitor all pipeline activity and investigate errors from their browser instead of SSH
**Depends on**: Phase 36
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DASH-09
**Research**: Skip (standard Fastify + EJS + htmx patterns)
**Success Criteria** (what must be TRUE):
  1. The pipeline overview page shows traffic-light status (green/yellow/red) for all 6 pipelines with last run time and key counts
  2. Overdue pipelines (missed their expected cron schedule) are visually flagged
  3. A user can click into a pipeline to see paginated run history, then click a run to see per-step breakdown with counts
  4. The error browser lists all errors with filtering by pipeline and date range, and drill-down shows individual member failures with error details
  5. All pages are usable on a phone screen (responsive layout)
**Plans**: TBD

Plans:
- [ ] 37-01: Pipeline overview and run history pages
- [ ] 37-02: Error browser and responsive polish

### Phase 38: Email Migration
**Goal**: Email reports only fire on errors and link directly to the dashboard for details
**Depends on**: Phase 37
**Requirements**: EMAIL-01, EMAIL-02
**Research**: Skip (modification of existing email code)
**Success Criteria** (what must be TRUE):
  1. A successful pipeline run sends no email
  2. A pipeline run with errors sends an email containing a clickable link to the run detail page in the dashboard
**Plans**: TBD

Plans:
- [ ] 38-01: Error-only email reports with dashboard links

### Phase 39: Multi-Club Readiness
**Goal**: The system supports adding a second club without restructuring code or databases
**Depends on**: Phase 34 (schema ready), independent of other phases
**Requirements**: MULTI-02
**Status**: Deferred until a second club is onboarded
**Research**: Needs research when activated (environment isolation, per-club cron management)
**Success Criteria** (what must be TRUE):
  1. Each club has its own directory with isolated SQLite databases and `.env` file
  2. A club can be added by creating a config entry and directory without modifying existing code
**Plans**: TBD

Plans:
- [ ] 39-01: Database-per-club layout and config registry

## Progress

**Execution Order:**
Phases execute in numeric order: 34 -> 35 -> 36 -> 37 -> 38
Phase 39 is deferred (not in active execution order).

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 34. Infrastructure Foundation | 0/1 | Not started | - |
| 35. Run Tracking | 0/1 | Not started | - |
| 36. Web Server and Authentication | 0/1 | Not started | - |
| 37. Dashboard UI | 0/2 | Not started | - |
| 38. Email Migration | 0/1 | Not started | - |
| 39. Multi-Club Readiness | 0/1 | Deferred | - |

---
*Roadmap created: 2026-02-08*
*Milestone: v3.0 Web Dashboard*
