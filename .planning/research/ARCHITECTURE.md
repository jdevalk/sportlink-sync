# Architecture: Web Dashboard for Rondo Sync

**Domain:** Adding a web dashboard to an existing Node.js CLI sync tool
**Researched:** 2026-02-08
**Confidence:** HIGH (patterns verified against existing codebase, technology choices based on current docs)

## Executive Summary

The existing rondo-sync architecture is a CLI-driven ETL pipeline using cron scheduling, with SQLite state databases and text-based log output. Adding a web dashboard requires three fundamental changes: (1) capturing structured run data during pipeline execution, (2) serving that data through a web server, and (3) keeping the web server and cron-driven CLI processes from conflicting on database access.

The good news: the existing codebase is architecturally well-suited for this addition. Every pipeline already collects structured `stats` objects with per-step counts and errors. The logger already writes to both stdout and file simultaneously. SQLite with WAL mode supports concurrent read/write from multiple processes. The module/CLI hybrid pattern means pipelines can be invoked programmatically by a web server without shelling out.

The recommended approach is a **thin instrumentation layer** that captures the stats objects pipelines already produce, stores them in a new `dashboard.sqlite` database, and serves them through a lightweight Fastify web server. This avoids rewriting pipelines and keeps the existing cron+CLI flow intact.

For multi-club readiness, the architecture should use a **database-per-club** isolation model (each club gets its own set of SQLite files and .env config), which maps naturally to the existing pattern of per-domain SQLite databases.

## Current Architecture (As-Is)

### System Overview

```
 cron (crontab)
   |
   v
 sync.sh {pipeline}          <-- bash wrapper: flock locking, .env loading, log routing
   |
   v
 pipelines/sync-{type}.js    <-- Node.js orchestrator: calls steps, collects stats
   |
   +---> steps/download-*    <-- data extraction (Playwright browser automation)
   +---> steps/prepare-*     <-- data transformation
   +---> steps/submit-*      <-- data submission (REST APIs)
   |
   v
 printSummary(stats)          <-- text output to logger
   |
   v
 send-email.js                <-- reads log file, sends via Postmark
```

### Key Characteristics

| Aspect | Current State |
|--------|---------------|
| **Invocation** | Cron calls bash wrapper, which calls Node.js |
| **Locking** | Per-pipeline flock in sync.sh |
| **Output** | Unstructured text to stdout + log file |
| **Stats** | Structured JS objects built in-memory, then formatted as text |
| **Error records** | Collected in `stats.*.errors[]` arrays with member-level detail |
| **Run history** | Only `sportlink_runs` table in laposta.sqlite (raw download data) |
| **Databases** | 4 SQLite files, all in `data/` directory |
| **Configuration** | Single `.env` file per installation |

### The Stats Object Opportunity

Every pipeline already builds a structured stats object during execution. For example, `sync-people.js` produces:

```javascript
stats = {
  completedAt: '2026-02-08 14:00:00',
  duration: '2m 30s',
  downloaded: 1069,
  prepared: 1050,
  excluded: 19,
  synced: 45,
  added: 2,
  updated: 43,
  errors: [{ knvb_id: 'KNVB123', message: '...', system: 'laposta' }],
  rondoClub: { total: 1069, synced: 45, created: 2, updated: 43, skipped: 1024, errors: [] },
  photos: { downloaded: 3, uploaded: 2, deleted: 1, skipped: 0, errors: [] },
  reverseSync: { synced: 0, failed: 0, errors: [], results: [] }
}
```

This is the **single most important architectural insight**: the structured data the dashboard needs is already computed by every pipeline. It is currently serialized to text and thrown away. The dashboard architecture's primary job is to intercept and persist this data.

## Proposed Architecture (To-Be)

### High-Level Component View

```
 cron (crontab)           operator browser
   |                          |
   v                          v
 sync.sh {pipeline}      Fastify web server (port 3000)
   |                          |
   v                          |
 pipelines/sync-{type}.js     |
   |                          |
   +---> run-tracker.js  <----+    <-- NEW: persists stats, serves history
   |         |                |
   |         v                |
   |    dashboard.sqlite <----+    <-- NEW: run history + error records
   |
   +---> steps/*  (unchanged)
   |
   +---> data/*.sqlite  (unchanged, existing sync state DBs)
```

### New Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Run Tracker** | Captures pipeline stats into dashboard.sqlite | `lib/run-tracker.js` |
| **Dashboard DB** | Stores run history, step results, errors | `data/dashboard.sqlite` |
| **Web Server** | Serves dashboard UI and API | `server/index.js` |
| **API Routes** | REST endpoints for run data | `server/routes/` |
| **UI Templates** | Server-rendered dashboard views | `server/views/` |

### Modified Components

| Component | Change | Why |
|-----------|--------|-----|
| **Each pipeline** | Add 3-4 lines to persist stats via run-tracker | Minimal change to capture data |
| **Logger** | Optional: emit structured events alongside text | Enables real-time dashboard updates |
| **sync.sh** | No changes needed | Pipelines handle their own tracking |

### Components NOT Modified

| Component | Why Unchanged |
|-----------|---------------|
| **steps/** | Steps return results to pipelines; tracking happens at pipeline level |
| **lib/*-db.js** | Existing sync state databases remain independent |
| **lib/*-client.js** | API clients are unaffected |
| **config/** | Field mappings are sync-specific, not dashboard-relevant |
| **tools/** | Maintenance scripts remain CLI-only |

## Integration Points

### 1. Run Tracker (lib/run-tracker.js)

The run tracker is the central integration point. It provides a simple API for pipelines to record their execution.

**Pattern: Wrap existing pipeline return values.**

Each pipeline already returns `{ success, stats }`. The run tracker intercepts this result and persists it:

```javascript
// lib/run-tracker.js
const Database = require('better-sqlite3');

function createRunTracker(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');  // Critical for concurrent access
  initSchema(db);

  return {
    startRun(pipeline, trigger) {
      // Insert run record, return run ID
    },
    recordStepResult(runId, stepName, result) {
      // Insert step-level stats
    },
    completeRun(runId, stats) {
      // Update run with final stats + errors
    },
    getRecentRuns(pipeline, limit) {
      // Query for dashboard display
    }
  };
}
```

**Integration into pipelines is minimal** -- approximately 3-4 lines per pipeline:

```javascript
// Before (current):
async function runPeopleSync(options = {}) {
  const stats = { /* ... */ };
  // ... all existing pipeline logic ...
  return { success, stats };
}

// After (with tracking):
async function runPeopleSync(options = {}) {
  const tracker = getRunTracker();  // singleton
  const runId = tracker.startRun('people', options.trigger || 'cron');
  const stats = { /* ... */ };
  // ... all existing pipeline logic unchanged ...
  tracker.completeRun(runId, stats);
  return { success, stats };
}
```

### 2. Dashboard Database (data/dashboard.sqlite)

A new database dedicated to dashboard data. Separated from sync databases to avoid any interference with sync operations.

**Schema:**

```sql
-- Pipeline runs
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  pipeline TEXT NOT NULL,           -- 'people', 'teams', 'functions', etc.
  trigger TEXT NOT NULL,            -- 'cron', 'manual', 'web'
  status TEXT NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed'
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  stats_json TEXT,                  -- Full stats object as JSON
  success INTEGER,                  -- 1 = success, 0 = failure
  error_message TEXT                -- Top-level error if fatal
);

CREATE INDEX idx_runs_pipeline ON runs(pipeline, started_at DESC);
CREATE INDEX idx_runs_status ON runs(status);

-- Per-step results within a run
CREATE TABLE run_steps (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  step_name TEXT NOT NULL,          -- 'download', 'prepare', 'submit-laposta', etc.
  status TEXT NOT NULL,             -- 'completed', 'failed', 'skipped'
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  stats_json TEXT,                  -- Step-specific stats
  UNIQUE(run_id, step_name)
);

-- Individual errors from a run (member-level detail)
CREATE TABLE run_errors (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  step_name TEXT,
  identifier TEXT,                  -- knvb_id, email, or 'system'
  system TEXT,                      -- 'laposta', 'rondoClub', 'photo-upload', etc.
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_run_errors_run ON run_errors(run_id);
CREATE INDEX idx_run_errors_identifier ON run_errors(identifier);
```

**Why a separate database:**
- Sync databases (`rondo-sync.sqlite`, `laposta-sync.sqlite`, etc.) are critical to sync correctness. Dashboard data is read-heavy, append-only, and non-critical. Mixing them would add risk with no benefit.
- Separate database file means the dashboard can be backed up, migrated, or reset independently.
- Different access patterns: sync DBs are write-heavy during pipeline runs; dashboard DB is read-heavy from the web server.

### 3. Web Server (server/index.js)

A Fastify web server running as a long-lived process alongside the cron-triggered pipelines.

**Why Fastify over Express:**
- Built-in JSON schema validation (useful for API responses)
- Better performance for the read-heavy dashboard workload (2-3x Express throughput)
- First-class plugin system for clean separation of routes, static files, auth
- Active development with TypeScript support
- Existing project uses no web framework, so no migration cost -- this is a greenfield addition

**Server responsibilities:**
- Serve dashboard UI (server-rendered HTML)
- Provide REST API for run history, error details, pipeline status
- Read from dashboard.sqlite (read-only, never writes to sync databases)
- Optionally trigger pipeline runs via the existing module API

**Server does NOT:**
- Write to sync databases (rondo-sync.sqlite, laposta-sync.sqlite, etc.)
- Replace cron scheduling
- Modify pipeline behavior
- Require running on the same process as pipelines

### 4. SQLite Concurrent Access Strategy

The most critical technical concern: cron-triggered pipelines write to SQLite databases while the web server reads from them.

**Solution: WAL (Write-Ahead Logging) mode.**

SQLite in WAL mode allows:
- Multiple concurrent readers
- One writer at a time (with readers not blocked by the writer)
- This matches our access pattern exactly: pipelines write, web server reads

**Implementation:**

```javascript
// All database opens should set WAL mode
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');  // Wait up to 5s for locks
```

**Current state:** The existing codebase does NOT set WAL mode on any database. The default journal mode (DELETE) is fine for single-process access, but adding a web server reader requires WAL mode.

**Migration:** WAL mode is set per-database and persists across connections. A one-time `PRAGMA journal_mode = WAL` on each database file converts it. This is backward-compatible -- existing CLI scripts will work fine with WAL mode databases.

**Checkpoint management:** When the web server has a long-running read connection, WAL checkpoint (reclaiming disk space) can be delayed. The web server should periodically run `db.pragma('wal_checkpoint(PASSIVE)')` to prevent WAL file growth.

### 5. Process Architecture

**Recommended: Two separate processes.**

```
Process 1: Fastify web server (long-running, managed by PM2 or systemd)
  - Reads dashboard.sqlite
  - Reads sync databases (read-only, for member counts and stats)
  - Serves HTTP on port 3000

Process 2: Cron-triggered pipeline runs (short-lived, managed by crontab)
  - Writes to sync databases
  - Writes to dashboard.sqlite (run tracking)
  - Exits when pipeline completes
```

**Why two processes instead of one:**
- The web server must be always running; pipelines run periodically and exit
- Cron is battle-tested for scheduling; no need to replace it with in-process cron
- Process isolation means a pipeline crash cannot take down the dashboard
- Memory: Playwright (used by download steps) consumes significant memory; keeping it isolated from the web server prevents memory pressure

**Why NOT embed the web server in pipelines:**
- Pipelines are short-lived (run for 1-5 minutes, then exit)
- A web server needs to be always-on
- Pipelines use Playwright which consumes ~200-400MB RAM; the web server should stay lightweight

**Process management for the web server:**

Use PM2 or systemd to keep the Fastify server running:

```bash
# PM2 (simplest, already familiar Node.js tooling)
pm2 start server/index.js --name rondo-dashboard
pm2 save
pm2 startup

# Or systemd (more robust, OS-level)
# /etc/systemd/system/rondo-dashboard.service
```

Since the server only runs as a single instance on a single machine, PM2 with `instances: 1` is sufficient. No need for cluster mode.

## Data Flow

### Pipeline Run Data Flow

```
1. Cron triggers sync.sh people
2. sync.sh calls node pipelines/sync-people.js
3. Pipeline starts:
   a. run-tracker.startRun('people', 'cron') --> inserts into dashboard.sqlite
   b. Step 1: Download --> stats.downloaded = 1069
   c. Step 2: Prepare  --> stats.prepared = 1050
   d. Step 3: Submit   --> stats.synced = 45, stats.errors = [...]
   e. Step 4-7: ...    --> more stats populated
   f. run-tracker.completeRun(runId, stats) --> updates dashboard.sqlite
4. Pipeline exits
5. send-email.js sends log file report (unchanged)
```

### Dashboard View Data Flow

```
1. Operator opens browser to http://server:3000
2. Fastify serves dashboard HTML (server-rendered)
3. Page shows:
   a. Last run per pipeline (from runs table)
   b. Success/failure status
   c. Key stats (members synced, errors count)
4. Operator clicks a run for detail:
   a. API call: GET /api/runs/{id}
   b. Returns full stats_json + errors
5. Operator clicks an error:
   a. Shows member identifier, system, message
   b. Optionally links to member in sync DB for context
```

### Real-Time Updates (Phase 2 Enhancement)

For real-time dashboard updates during a running pipeline:

**Option A: Polling (simplest).**
Dashboard polls `GET /api/runs?status=running` every 5 seconds. Sufficient for a single-operator internal tool.

**Option B: Server-Sent Events (SSE).**
Pipeline writes progress to dashboard.sqlite. Web server watches for changes and pushes via SSE. More complex but provides true real-time feel.

**Recommendation:** Start with polling. SSE is a Phase 2 enhancement if the operator wants to watch runs in real-time.

## Multi-Club Architecture

### Current: Single Club

```
/home/sportlink/
  .env                    <-- single club credentials
  data/
    rondo-sync.sqlite     <-- single club state
    laposta-sync.sqlite
    nikki-sync.sqlite
    freescout-sync.sqlite
  logs/
  pipelines/
  steps/
  lib/
```

### Multi-Club: Database-Per-Club Model

The recommended approach is **database-per-club** isolation, which maps naturally to the existing architecture:

```
/home/sportlink/
  clubs/
    club-abc/
      .env                    <-- club ABC credentials
      data/
        rondo-sync.sqlite     <-- club ABC state
        laposta-sync.sqlite
        nikki-sync.sqlite
        freescout-sync.sqlite
        dashboard.sqlite
      logs/
      photos/
    club-xyz/
      .env                    <-- club XYZ credentials
      data/
        rondo-sync.sqlite     <-- club XYZ state
        ...
  server/                     <-- shared web server
  pipelines/                  <-- shared pipeline code
  steps/                      <-- shared step code
  lib/                        <-- shared libraries
  config/                     <-- shared field mappings (or per-club overrides)
```

**Why database-per-club:**
- **Complete isolation:** One club's data cannot leak to another's
- **Natural fit:** The existing code already uses `process.cwd()` to locate databases (see `DEFAULT_DB_PATH` in `rondo-club-db.js` and `laposta-db.js`). Changing the working directory per club already gives data isolation.
- **Independent operations:** One club can be synced, reset, or migrated without affecting others
- **Simple backup:** `cp -r clubs/club-abc/data/ backup/` backs up one club
- **No schema changes:** All existing database schemas work as-is

**Implementation steps for multi-club:**

1. **Club config registry:** A JSON file or simple table mapping club slugs to their data directories and .env paths
2. **Cron per club:** Each club gets its own crontab entries with a club identifier
3. **sync.sh accepts club:** `sync.sh --club abc people` sets the working directory before invoking the pipeline
4. **Web server reads all clubs:** Dashboard aggregates runs across clubs, filterable by club
5. **Environment isolation:** Each pipeline invocation loads the club-specific .env

**Critical consideration:** The existing `server-check.js` uses hostname validation (`os.hostname() === 'srv888452'`) to prevent local runs. Multi-club does not change this -- all clubs still run on the same production server.

### Multi-Club Readiness Without Building Multi-Club

The single-club architecture should be structured so that multi-club is an additive change, not a rewrite:

1. **Database paths as parameters:** Pass database paths rather than hardcoding. The existing `openDb(dbPath)` pattern already supports this.
2. **Club context object:** Create a config object with `{ slug, dataDir, envPath }` that can default to the current single-club setup.
3. **No global state:** The existing code mostly avoids global state (good), but `process.env` is effectively global. Multi-club requires either separate processes per club (simplest) or env-swapping per request.

**Recommendation:** For now, design the dashboard database schema with a `club_slug` column on the `runs` table. This is free (one column) and means the dashboard is multi-club ready from day one, even if only one club exists.

Updated schema:

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  club_slug TEXT NOT NULL DEFAULT 'default',  -- Multi-club ready
  pipeline TEXT NOT NULL,
  -- ... rest unchanged
);

CREATE INDEX idx_runs_club ON runs(club_slug, pipeline, started_at DESC);
```

## UI Approach

### Recommendation: Server-Rendered HTML with HTMX

For an internal operator dashboard viewed by 1-2 people, a full React/Vue SPA is overkill. Server-rendered HTML with HTMX provides:

- **No build step:** No webpack, no bundling, no transpiling. HTML templates rendered by Fastify.
- **Minimal JavaScript:** HTMX is 14KB gzipped. The dashboard needs no client-side state management.
- **Fast development:** HTML templates are simpler than React components for CRUD-style views.
- **Team fit:** The existing codebase is pure Node.js with no frontend build toolchain. Adding one for a dashboard would be a disproportionate complexity increase.

**Technology stack for the UI:**

| Component | Technology | Why |
|-----------|-----------|-----|
| **Server** | Fastify | Fast, plugin-based, JSON schema support |
| **Templating** | @fastify/view + EJS or Nunjucks | Server-side rendering, no build step |
| **Interactivity** | HTMX | Partial page updates without full reloads |
| **Styling** | Simple CSS or Pico CSS | Classless/minimal CSS framework, no build |
| **Static files** | @fastify/static | Serve CSS, HTMX lib |

### Dashboard Views

**1. Overview page (/):**
- Table of all pipelines with last run status, time, duration
- Color-coded: green (success), red (errors), yellow (running)
- Error count badges per pipeline

**2. Pipeline detail (/pipelines/{name}):**
- Run history table (paginated, most recent first)
- Stats chart (members synced over time -- simple bar chart)
- Current schedule (from cron)

**3. Run detail (/runs/{id}):**
- Full stats breakdown by step
- Error list with member identifiers
- Log file content (if available)
- Duration per step

**4. Errors view (/errors):**
- All errors across recent runs
- Filterable by pipeline, system, member
- Recurring error detection (same member failing across runs)

## Suggested Build Order

Build in phases that each deliver usable value:

### Phase 1: Run Tracking Foundation

**Goal:** Capture structured run data without any UI.

1. Create `data/dashboard.sqlite` with schema
2. Build `lib/run-tracker.js`
3. Integrate into one pipeline (people) as proof of concept
4. Verify data is captured correctly

**Value:** Historical run data starts accumulating. Can be queried with `sqlite3` CLI.

**Risk:** Low. Adds 3-4 lines to one pipeline file.

### Phase 2: Web Server + API

**Goal:** Serve run data via HTTP.

1. Set up Fastify server in `server/`
2. Build API routes: `GET /api/runs`, `GET /api/runs/:id`, `GET /api/errors`
3. Add PM2 config for process management
4. Configure WAL mode on all databases

**Value:** Run data accessible via HTTP, scriptable.

**Risk:** Low-medium. WAL mode migration needs testing on production.

### Phase 3: Dashboard UI

**Goal:** Visual dashboard for operators.

1. Add HTMX and templates
2. Build overview page
3. Build run detail page
4. Build error browser

**Value:** Operators can see sync status without SSH + reading log files.

**Risk:** Low. Purely additive, no existing code changes.

### Phase 4: All Pipelines Instrumented

**Goal:** All 8 pipelines tracked.

1. Add run-tracker to remaining 7 pipelines
2. Ensure consistent stats structure across pipelines
3. Add per-step tracking (not just final stats)

**Value:** Complete visibility into all sync operations.

**Risk:** Low. Same pattern repeated 7 times.

### Phase 5: Multi-Club Readiness

**Goal:** Architecture supports multiple clubs.

1. Add club context to run-tracker
2. Club config registry
3. Modify sync.sh for --club flag
4. Dashboard club filter

**Value:** Can onboard second club.

**Risk:** Medium. Requires careful env/database isolation testing.

## Anti-Patterns to Avoid

### 1. Do NOT embed the web server inside pipelines

Pipelines are short-lived processes that exit after completion. Embedding a web server would mean the server dies every time a pipeline finishes, or the pipeline would need to be kept alive artificially.

### 2. Do NOT parse log files for structured data

The existing log files are human-readable text. Parsing them to extract stats (regex on "Members synced: 45/1069") is fragile and loses the rich structure already available in the stats objects. Capture the stats objects directly.

### 3. Do NOT share database connections between web server and pipelines

Each process should open its own database connection. SQLite handles multi-process access through file-level locking. Sharing connections (via IPC, shared memory, etc.) adds complexity with no benefit.

### 4. Do NOT replace cron with in-process scheduling

The existing cron setup is battle-tested and well-documented. The flock-based locking in sync.sh prevents overlapping runs. Replacing this with `node-cron` or `fastify-cron` would lose the flock isolation and introduce new failure modes.

### 5. Do NOT read sync databases from the web server for real-time member data

The dashboard should read from `dashboard.sqlite` for run history and errors. Reading `rondo-sync.sqlite` for member counts or status is acceptable (read-only), but the web server should NEVER write to sync databases.

### 6. Do NOT add authentication before the dashboard has value

The server runs on an internal IP (`46.202.155.16`). Adding auth is important but should not gate the initial build. Use IP-based access control first (bind to localhost + reverse proxy, or firewall rules), add auth in a later phase.

## Technology Decisions

### New Dependencies Needed

| Package | Purpose | Version | Confidence |
|---------|---------|---------|------------|
| `fastify` | Web server | ^5.x | HIGH |
| `@fastify/static` | Serve CSS/JS assets | ^8.x | HIGH |
| `@fastify/view` | Server-side templates | ^10.x | HIGH |
| `ejs` or `nunjucks` | Template engine | latest | HIGH |
| `htmx.org` | Client-side interactivity | ^2.x | HIGH (vendored, not npm) |

### No New Dependencies Needed For

| Capability | Already Available |
|-----------|------------------|
| SQLite access | `better-sqlite3` (already in package.json) |
| Environment loading | `varlock` (already in package.json) |
| HTTP client (for API tests) | Node.js built-in `http` |
| Process management | PM2 (installed globally on server) |

## Confidence Assessment

| Area | Confidence | Reasoning |
|------|------------|-----------|
| Stats capture approach | HIGH | Verified: every pipeline already builds structured stats objects |
| SQLite concurrent access | HIGH | WAL mode is well-documented for this exact multi-process pattern |
| Fastify for web server | HIGH | Well-established, no competing concerns with existing stack |
| HTMX for dashboard UI | HIGH | Appropriate for internal single-operator CRUD dashboard |
| Multi-club database-per-club | MEDIUM | Pattern is sound, but env isolation needs careful implementation |
| PM2 for process management | MEDIUM | Standard approach, but needs testing alongside existing cron |
| Real-time SSE updates | LOW | Not researched in depth, deferred to later phase |

## Sources

- Existing codebase analysis: `pipelines/sync-people.js`, `pipelines/sync-all.js`, `lib/logger.js`, `lib/rondo-club-db.js`, `lib/laposta-db.js`, `scripts/sync.sh`, `lib/server-check.js`
- Existing documentation: `docs/database-schema.md`, `docs/sync-architecture.md`
- [better-sqlite3 concurrency documentation](https://wchargin.com/better-sqlite3/performance.html) -- WAL mode and checkpoint management
- [SQLite WAL mode documentation](https://sqlite.org/wal.html) -- concurrent read/write guarantees
- [Fastify official site](https://fastify.dev/) -- framework capabilities and plugin ecosystem
- [HTMX vs React comparison](https://dualite.dev/blog/htmx-vs-react) -- framework choice rationale
- [HTMX production comparison](https://medium.com/@the_atomic_architect/htmx-vs-react-6-months-production-cdf0468206b5) -- real-world admin dashboard rebuild
- [Fastify vs Express comparison](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) -- performance and features
- [Multi-tenant architecture guide](https://dev.to/rampa2510/guide-to-building-multi-tenant-architecture-in-nodejs-40og) -- database-per-tenant pattern
- [PM2 with cron jobs](https://greenydev.com/blog/pm2-cron-job-multiple-instances/) -- coexistence patterns
- [SQLite concurrent access patterns](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) -- multi-process strategies
- [better-sqlite3 multiprocess access](https://github.com/WiseLibs/better-sqlite3/issues/250) -- known considerations
