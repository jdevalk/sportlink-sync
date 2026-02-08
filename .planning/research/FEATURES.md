# Feature Landscape: Sync Monitoring Dashboard

**Domain:** Pipeline monitoring / operations dashboard for a Node.js sync tool
**Researched:** 2026-02-08
**Confidence:** HIGH (based on analysis of existing codebase data structures + industry patterns from Prefect, Cronitor, Azure Data Factory, and similar tools)

## Executive Summary

The Rondo Sync tool currently runs 6 pipelines on cron, each producing structured stats objects (counts for created/updated/skipped/errors) and plain-text log files. The operator monitors the system via email reports sent after each run. A dashboard adds visual, at-a-glance monitoring with drill-down capability -- replacing "check your email" with "open the dashboard."

The core challenge is not visualization but **data capture**: the system currently writes stats to stdout/log files but does not persist structured run data to a database. The first requirement is a `sync_runs` table that captures what each pipeline already computes. Everything else builds on that.

## Table Stakes

Features users expect from any sync/pipeline monitoring dashboard. Missing any of these makes the dashboard feel incomplete -- the operator would still need to check emails or SSH into the server.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|-------------|-------|
| **Pipeline overview page** | At-a-glance status of all 6 pipelines: last run time, success/fail, record counts | Low | `sync_runs` table | Traffic-light indicators (green/yellow/red) per pipeline. Yellow = ran with errors, red = failed or overdue. |
| **Run history per pipeline** | See when each pipeline ran, how long it took, what it did | Low | `sync_runs` table | Paginated list of runs with timestamp, duration, status, summary counts. Filter by pipeline type. |
| **Run detail view** | Click a run to see full breakdown: per-step counts, which records changed | Medium | `sync_runs` + `sync_run_errors` tables | Shows the same data currently in email reports: downloaded X, created Y, updated Z, skipped W. |
| **Error list with drill-down** | Browse errors across runs, see which member/record failed and why | Medium | `sync_run_errors` table | Errors currently exist as arrays in pipeline stats (knvb_id + message + system). Must persist these. |
| **Overdue pipeline detection** | Flag pipelines that should have run but haven't | Low | `sync_runs` table + schedule config | Compare last run time against expected schedule. People pipeline expected every 3 hours, teams weekly, etc. |
| **Authentication** | Protect the dashboard with login | Low | Session/cookie or token | Single operator use case. Simple username/password is sufficient. |
| **Responsive layout** | Usable on phone when operator is not at desk | Low | CSS | Operator checks sync status from phone. Dashboard must be mobile-friendly. |

## Differentiators

Features that elevate the dashboard from "basic status page" to "operations tool." Not expected in an MVP, but valued.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|-------------|-------|
| **Duration trend chart** | Spot performance degradation over time (e.g., Sportlink getting slower) | Medium | Run history data | Line chart of duration per pipeline over last 30 days. Useful for capacity planning. |
| **Manual trigger button** | Run a pipeline from the dashboard instead of SSH | High | Server-side execution, websocket for progress | Replaces `ssh root@server "scripts/sync.sh people"`. Needs careful security (auth + CSRF). |
| **Live run progress** | See pipeline steps completing in real-time during a run | High | WebSocket or SSE | Currently pipelines log to stdout. Would need to push step completion events. |
| **Per-member error history** | "Show me all errors for KNVB123456 across all runs" | Medium | `sync_run_errors` table indexed by knvb_id | Useful for diagnosing persistent member issues (bad email, missing data). |
| **Database statistics page** | Show record counts from all 4 SQLite databases | Low | Direct SQLite queries | Members: X, Parents: Y, Teams: Z, Commissies: W. Quick health check. |
| **Comparison: email vs dashboard** | Side-by-side of email report and dashboard view for same run | Low | Existing email HTML + run data | Builds confidence during migration from email to dashboard. |
| **Email report toggle** | Disable email reports once dashboard is trusted | Low | Config change | Reduces email noise. Keep emails for errors only. |
| **Run diff view** | Compare two runs: "What changed between today's sync and yesterday's?" | Medium | Two runs from `sync_runs` | Shows delta: new members, removed members, changed fields. |
| **Log file viewer** | Read log files from the dashboard instead of SSH | Low | File system access | Serve log files (already stored in `logs/cron/`). Syntax highlighting optional. |
| **Scheduled overview** | Visual timeline of when each pipeline runs (cron schedule visualization) | Low | Static config from `install-cron.sh` | Shows daily/weekly schedule. Helps operator understand timing. |

## Anti-Features

Features to explicitly NOT build. Common mistakes when building internal dashboards.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Real-time auto-refresh** | Pipelines run on cron (4x daily max). No benefit to polling every 5 seconds. Wastes resources. | Manual refresh button + optional 60-second auto-refresh toggle. |
| **Full log streaming** | Log files can be 50-500KB. Streaming them to the browser is wasteful and complex (WebSocket). | Show structured summary from `sync_runs`. Offer log file download link. |
| **CRUD for member data** | The dashboard monitors sync; it does not replace WordPress or Sportlink for data management. | Link to WordPress admin and Sportlink for data edits. |
| **Pipeline configuration UI** | Changing cron schedules, field mappings, or environment variables from the dashboard. Too dangerous. | Configuration stays in `.env`, `config/field-mapping.json`, and `install-cron.sh`. SSH for changes. |
| **Multi-tenant / multi-club** | This tool serves one club. Adding multi-tenancy adds complexity with zero benefit. | Hardcode to single instance. |
| **Complex role-based permissions** | One or two operators use this. Building admin/viewer/editor roles is over-engineering. | Single login with full access. Add roles only if more users are added later. |
| **Notification center in dashboard** | Push notifications, in-app alerts, notification badges. Over-engineered for this use case. | Keep email reports for critical errors. Dashboard is pull-based. |
| **GraphQL API** | Adds complexity. The dashboard is the only consumer of the data. | Simple REST endpoints or server-rendered pages. |
| **SPA with client-side routing** | For a simple dashboard with 4-5 pages, a full SPA framework is over-engineering. | Server-rendered pages with minimal JavaScript for interactivity. Or a lightweight framework. |
| **External monitoring service** | Services like Cronitor/Healthchecks.io cost money and add external dependency for a single-club tool. | Self-hosted dashboard reading from local SQLite. |

## Feature Dependencies

```
[Data Layer - Must build first]
  sync_runs table (persist pipeline results)
  sync_run_errors table (persist per-record errors)
    |
    v
[API Layer]
  GET /api/pipelines (overview status)
  GET /api/pipelines/:type/runs (run history)
  GET /api/runs/:id (run detail with errors)
  GET /api/errors (cross-pipeline error list)
    |
    v
[Auth Layer]
  Login page + session management
    |
    v
[UI Layer]
  Pipeline overview page
  Run history page (per pipeline)
  Run detail page
  Error browser page
```

### Critical Path

1. **Data capture must come first.** Without a `sync_runs` table, there is nothing to display. Each pipeline already computes stats objects -- they just need to be written to SQLite after the run completes.

2. **Error persistence must come with data capture.** The error arrays in pipeline stats contain knvb_id, message, and system. These must be stored in `sync_run_errors` with a foreign key to `sync_runs`.

3. **API before UI.** The API endpoints are simple SELECT queries against `sync_runs` and `sync_run_errors`. Building these first allows testing with `curl` before any frontend work.

4. **Auth before deployment.** The dashboard exposes operational data. Even simple auth must exist before the dashboard is accessible externally.

## Existing Data Available for Dashboard

### Already Computed by Pipelines (Just Needs Persisting)

Each pipeline already returns a structured `stats` object. Here is what is available per pipeline:

**People pipeline (`sync-people.js`):**
- `completedAt`, `duration`
- `downloaded` (member count from Sportlink)
- `prepared`, `excluded` (Laposta preparation)
- `synced`, `added`, `updated` (Laposta submission)
- `rondoClub.total`, `.synced`, `.created`, `.updated`, `.skipped`
- `photos.downloaded`, `.uploaded`, `.deleted`, `.skipped`
- `reverseSync.synced`, `.failed`
- `errors[]` (array with knvb_id/email, message, system)
- `rondoClub.errors[]`, `photos.errors[]`, `reverseSync.errors[]`

**Teams pipeline (`sync-teams.js`):**
- `completedAt`, `duration`
- `download.teamCount`, `.memberCount`
- `teams.total`, `.synced`, `.created`, `.updated`, `.skipped`
- `workHistory.total`, `.synced`, `.created`, `.ended`, `.skipped`
- Errors per step

**Functions pipeline (`sync-functions.js`):**
- `completedAt`, `duration`
- `download.total`, `.functionsCount`, `.committeesCount`
- `commissies.total`, `.synced`, `.created`, `.updated`, `.skipped`, `.deleted`
- `workHistory.total`, `.synced`, `.created`, `.ended`, `.skipped`
- Errors per step

**Nikki pipeline (`sync-nikki.js`):**
- `completedAt`, `duration`
- `download.count`
- `rondoClub.updated`, `.skipped`, `.noRondoClubId`, `.errors`

**FreeScout pipeline (`sync-freescout.js`):**
- `completedAt`, `duration`
- `total`, `synced`, `created`, `updated`, `skipped`, `deleted`
- `errors[]`

**Discipline pipeline (`sync-discipline.js`):**
- `completedAt`, `duration`
- `download.caseCount`
- `sync.total`, `.synced`, `.created`, `.updated`, `.skipped`, `.linked`, `.skipped_no_person`
- Errors per step

### Already Available on Disk

- **Log files** in `logs/cron/sync-{type}-{date}.log` -- one per cron run
- **Log files** in `logs/sync-{type}-{date}.log` -- one per interactive run
- **SQLite databases** with record counts and last-sync timestamps
- **Lock files** `.sync-{type}.lock` -- indicate running syncs

### Not Currently Captured (Must Be Added)

- **Structured run results** -- stats objects are printed to stdout but not persisted to database
- **Per-run error records** -- error arrays are included in email but not stored queryably
- **Run start time** -- `startTime` exists in code as `Date.now()` but only used for duration calculation
- **Pipeline schedule config** -- cron schedule lives in `install-cron.sh` and is not queryable

## Proposed Data Model

### `sync_runs` Table

```sql
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline TEXT NOT NULL,          -- 'people', 'teams', 'functions', 'nikki', 'freescout', 'discipline'
  started_at TEXT NOT NULL,        -- ISO 8601 UTC
  completed_at TEXT NOT NULL,      -- ISO 8601 UTC
  duration_ms INTEGER NOT NULL,    -- milliseconds
  success INTEGER NOT NULL,        -- 1 = no errors, 0 = had errors
  stats_json TEXT NOT NULL,        -- Full stats object as JSON
  log_file TEXT,                   -- Path to log file (relative to project)
  trigger TEXT DEFAULT 'cron',     -- 'cron', 'manual', 'dashboard'
  error_count INTEGER DEFAULT 0,   -- Count of errors for quick filtering
  created INTEGER DEFAULT 0,       -- Quick access: records created
  updated INTEGER DEFAULT 0,       -- Quick access: records updated
  skipped INTEGER DEFAULT 0        -- Quick access: records skipped (unchanged)
);

CREATE INDEX idx_sync_runs_pipeline ON sync_runs(pipeline, started_at DESC);
CREATE INDEX idx_sync_runs_success ON sync_runs(success, started_at DESC);
```

### `sync_run_errors` Table

```sql
CREATE TABLE sync_run_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES sync_runs(id),
  identifier TEXT,                 -- knvb_id, email, team_name, dossier_id, etc.
  identifier_type TEXT,            -- 'knvb_id', 'email', 'team_name', 'dossier_id', 'system'
  message TEXT NOT NULL,           -- Error message
  system TEXT,                     -- 'laposta', 'rondoClub', 'photo-download', 'freescout', etc.
  step TEXT,                       -- Pipeline step that produced the error
  created_at TEXT NOT NULL         -- ISO 8601 UTC
);

CREATE INDEX idx_sync_run_errors_run ON sync_run_errors(run_id);
CREATE INDEX idx_sync_run_errors_identifier ON sync_run_errors(identifier);
```

## MVP Recommendation

For the first version of the dashboard, prioritize features that replace the current email-only workflow.

### Phase 1: Data Capture (Foundation -- No UI Yet)

1. **Create `sync_runs` and `sync_run_errors` tables** in a new `dashboard.sqlite` database
2. **Modify each pipeline** to persist its stats object after completion (one INSERT per run)
3. **Extract errors** from stats objects into `sync_run_errors` rows
4. **Verify** by running pipelines and inspecting the database

This phase has zero UI but is the prerequisite for everything else.

### Phase 2: Core Dashboard

5. **Pipeline overview page** -- all 6 pipelines with last-run status, time, counts
6. **Run history page** -- paginated list per pipeline with filtering
7. **Run detail page** -- full breakdown for a single run
8. **Error browser** -- list errors across runs, filter by pipeline/member
9. **Authentication** -- simple login page

### Phase 3: Polish

10. **Overdue detection** -- flag pipelines that missed their schedule
11. **Database statistics** -- record counts from all 4 SQLite databases
12. **Log file viewer** -- read and display log files from the dashboard
13. **Duration trend chart** -- performance over time

### Defer to Post-MVP

- **Manual trigger button** -- significant security implications, needs careful design
- **Live run progress** -- requires WebSocket infrastructure
- **Run diff view** -- nice but not critical for monitoring
- **Email report toggle** -- keep both channels initially

## UI Wireframe Concepts

### Pipeline Overview Page

```
+------------------------------------------------------------------+
|  Rondo Sync Dashboard                          [Refresh] [Logout] |
+------------------------------------------------------------------+
|                                                                    |
|  PIPELINE STATUS                                                   |
|                                                                    |
|  [GREEN] People     Last run: 14:03 (2m 34s)  1069 ok, 0 errors  |
|  [GREEN] Functions  Last run: 13:32 (8m 12s)  47 ok, 0 errors    |
|  [YELLOW] Nikki     Last run: 07:01 (1m 05s)  892 ok, 3 errors   |
|  [GREEN] FreeScout  Last run: 08:02 (45s)     502 ok, 0 errors   |
|  [GREEN] Teams      Last run: Sun 06:04 (3m)  38 ok, 0 errors    |
|  [RED]   Discipline Last run: 6 days ago       OVERDUE            |
|                                                                    |
+------------------------------------------------------------------+
```

### Run Detail Page

```
+------------------------------------------------------------------+
|  People Sync - Run #1247                                          |
|  2026-02-08 14:03:21 - Duration: 2m 34s - SUCCESS                |
+------------------------------------------------------------------+
|                                                                    |
|  SPORTLINK DOWNLOAD                                               |
|  Members downloaded: 1069                                         |
|                                                                    |
|  LAPOSTA SYNC                                                     |
|  Prepared: 1142 (73 excluded as duplicates)                       |
|  Synced: 12 (2 added, 10 updated)                                |
|                                                                    |
|  RONDO CLUB SYNC                                                  |
|  Synced: 8/1069 (0 created, 8 updated, 1061 skipped)             |
|                                                                    |
|  PHOTO SYNC                                                       |
|  No photo changes                                                 |
|                                                                    |
|  [View Log File]  [View Email Report]                             |
+------------------------------------------------------------------+
```

## Sources

**Pipeline Monitoring Best Practices:**
- [Data Pipeline Monitoring: Best Practices for Full Observability - Prefect](https://www.prefect.io/blog/data-pipeline-monitoring-best-practices) -- Consistency, timeliness, validity metrics; at-a-glance workflow status
- [10 Best Data Pipeline Monitoring Tools in 2026 - Integrate.io](https://www.integrate.io/blog/data-pipeline-monitoring-tools/) -- Tool comparison and feature expectations
- [The right metrics to monitor cloud data pipelines - Google Cloud](https://cloud.google.com/blog/products/management-tools/the-right-metrics-to-monitor-cloud-data-pipelines) -- Core metrics: throughput, latency, error rate, freshness

**Cron Job Monitoring Patterns:**
- [10 Best Cron Job Monitoring Tools in 2026 - Better Stack](https://betterstack.com/community/comparisons/cronjob-monitoring-tools/) -- Feature comparison across monitoring tools
- [Cronitor - Cron Job Monitoring](https://cronitor.io/cron-job-monitoring) -- Heartbeat monitoring, performance dashboards, alerting patterns
- [Healthchecks.io](https://healthchecks.io) -- Event logs, overdue detection, status badges

**Dashboard UI Patterns:**
- [How to monitor pipeline runs - Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/data-factory/monitor-pipeline-runs) -- Gantt views, error drill-down, run history filtering
- [Visually monitor Azure Data Factory](https://learn.microsoft.com/en-us/azure/data-factory/monitor-visually) -- Hierarchical navigation: dashboard -> pipeline -> activity level
- [ETL Monitoring Dashboard - Retool](https://retool.com/templates/etl-monitoring-dashboard) -- Template for ETL monitoring UI
- [ETL Monitoring Dashboard - Metabase](https://www.metabase.com/dashboards/etl-monitoring-dashboard) -- Dashboard design for ETL monitoring

**Error Drill-Down Patterns:**
- [Data Pipeline Monitoring: Key Concepts - Pantomath](https://www.pantomath.com/guide-data-observability/data-pipeline-monitoring) -- Health dashboards with drill-down
- [Data Pipeline Monitoring - 5 Strategies - Monte Carlo Data](https://www.montecarlodata.com/blog-data-pipeline-monitoring/) -- Data health dashboards with aggregate-to-detail navigation

**Existing System Analysis (HIGH confidence):**
- Direct code review of `pipelines/sync-people.js`, `sync-teams.js`, `sync-functions.js`, `sync-nikki.js`, `sync-freescout.js`, `sync-discipline.js` -- all stats objects documented above are verified from source code
- Direct review of `lib/logger.js`, `scripts/sync.sh`, `scripts/send-email.js` -- current reporting mechanism verified
- Direct review of `docs/database-schema.md`, `docs/sync-architecture.md`, `docs/operations.md` -- current operational patterns verified
