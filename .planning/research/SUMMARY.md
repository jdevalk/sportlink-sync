# Project Research Summary

**Project:** Rondo Sync Web Dashboard (v3.0)
**Domain:** Operations monitoring dashboard for an existing Node.js CLI/cron sync tool
**Researched:** 2026-02-08
**Confidence:** HIGH

## Executive Summary

Rondo Sync is a Node.js CLI tool that synchronizes sports club member data from Sportlink to four downstream systems (WordPress/Rondo Club, Laposta, FreeScout, Nikki) via 6 cron-scheduled pipelines. The system currently reports via email and log files. The dashboard adds visual, at-a-glance monitoring with error drill-down, replacing the "check your email or SSH in" workflow with a browser-based operations view.

The most important architectural insight is that **the data the dashboard needs already exists**. Every pipeline already computes structured `stats` objects with per-step counts and error arrays -- they just serialize them to text and discard them. The primary engineering challenge is not building a dashboard UI, but building a thin instrumentation layer (`run-tracker`) that intercepts these stats objects and persists them to a new `dashboard.sqlite` database. Once structured data is captured, the dashboard itself is straightforward server-rendered HTML. The recommended stack -- Fastify v5, EJS templates, htmx for interactivity -- requires no build tooling, no frontend framework, and adds only 9 npm packages. This is appropriate for a read-only internal tool serving 3-10 users.

The key risks are infrastructure-level, not application-level. The existing SQLite databases use default rollback journal mode with no WAL and no busy_timeout -- adding a persistent web server reader alongside cron-triggered writers will cause `SQLITE_BUSY` errors without a WAL migration. The server currently has no open HTTP ports and runs everything as root; exposing it via HTTP requires a reverse proxy with TLS, a non-root web server user, and credential separation (the web server needs read-only database access, not Sportlink/Laposta API keys). These infrastructure changes must happen before any dashboard code is deployed.

## Key Findings

### Recommended Stack

The stack stays close to the existing codebase: Node.js (upgraded from 18 to 22 LTS), SQLite via better-sqlite3, no build tooling. The web layer is a Fastify server rendering EJS templates with htmx for interactive elements (filtering, pagination, polling). Authentication uses server-side sessions with Argon2id password hashing, stored in SQLite.

**Core technologies:**
- **Node.js 22 LTS**: Prerequisite upgrade -- Node.js 18 is EOL (April 2025); Fastify v5 requires Node.js 20+
- **Fastify v5**: Web framework -- plugin architecture matches the existing modular codebase; 2-3x faster than Express; built-in schema validation
- **EJS v4**: Template engine -- actively maintained (Jan 2026), zero learning curve, native Fastify support via @fastify/view
- **htmx v2**: Interactivity -- 14KB vendored file for partial page updates, no build step, no client-side state
- **Argon2id + @fastify/session**: Auth -- server-side sessions in SQLite; NIST-recommended password hashing; session store reuses better-sqlite3
- **Custom minimal CSS**: No framework -- internal tool for a handful of users; ~200-300 lines of hand-written CSS is sufficient

**What NOT to add:** TypeScript (split codebase), Webpack/Vite (no build step needed), Docker (single-server deployment), Redis (SQLite handles the scale), React SPA (massive overhead for read-only dashboard), ORM (existing raw SQL patterns work).

### Expected Features

**Must have (table stakes):**
- Pipeline overview page -- traffic-light status for all 6 pipelines at a glance
- Run history per pipeline -- when, how long, success/fail, record counts
- Run detail view -- per-step breakdown (same data currently in email reports)
- Error list with drill-down -- browse errors by pipeline, member, system
- Overdue pipeline detection -- flag pipelines that missed their cron schedule
- Per-user authentication -- individual accounts, not shared password
- Responsive layout -- operator checks status from phone

**Should have (differentiators):**
- Duration trend chart -- spot performance degradation over time
- Per-member error history -- all errors for a specific member across runs
- Database statistics page -- record counts from all 4 sync databases
- Log file viewer -- read log files from dashboard instead of SSH
- Scheduled overview -- visual cron schedule timeline

**Defer to post-MVP:**
- Manual trigger button -- significant security implications (web server triggering Playwright)
- Live run progress -- requires WebSocket/SSE infrastructure
- Run diff view -- comparing two runs' outputs
- Complex role-based permissions -- start with single role, add roles when user base grows

**Anti-features (do not build):**
- Real-time auto-refresh at 5-second intervals (pipelines run 4x/day max; 60-second polling is sufficient)
- Full log streaming via WebSocket
- CRUD for member data (that is WordPress/Sportlink's job)
- Pipeline configuration UI (too dangerous; SSH for config changes)
- GraphQL API (dashboard is the only consumer)

### Architecture Approach

The architecture adds three new components to the existing system without modifying the cron/CLI flow. A **run tracker** (`lib/run-tracker.js`) captures pipeline stats into a new `dashboard.sqlite` database. A **Fastify web server** (`server/`) reads from that database and serves the dashboard UI. The two processes (web server and cron-triggered pipelines) are completely separate, sharing only database files via SQLite WAL mode. Pipeline modifications are minimal: 3-4 lines per pipeline to call `tracker.startRun()` and `tracker.completeRun()`.

**Major components:**
1. **Run Tracker** (`lib/run-tracker.js`) -- intercepts pipeline stats objects and persists them to dashboard.sqlite with structured run/step/error records
2. **Dashboard Database** (`data/dashboard.sqlite`) -- new database with `runs`, `run_steps`, and `run_errors` tables; includes `club_slug` column for future multi-club support
3. **Fastify Web Server** (`server/`) -- long-running process managed by systemd; serves HTML dashboard and reads from all SQLite databases (read-only)
4. **Nginx Reverse Proxy** -- TLS termination, rate limiting; Node.js binds to localhost:3000 only

**Multi-club readiness:** Database-per-club isolation model. Each club gets its own directory with its own set of SQLite files and `.env`. The dashboard database includes a `club_slug` column from day one. Code is shared; data is isolated. This is an additive change later -- not built now, but the schema and directory design accommodate it.

### Critical Pitfalls

1. **SQLite SQLITE_BUSY errors** -- All 5 existing `openDb()` functions use default rollback journal mode with no WAL and no busy_timeout. A web server reader alongside sync writers will cause lock conflicts. **Fix:** Enable `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` on all databases before deploying the web server. This is a non-breaking, backward-compatible change.

2. **Credential exposure via HTTP** -- The server holds credentials for 6 external systems in `.env` and currently has no open HTTP ports. **Fix:** Nginx reverse proxy with TLS, bind Node.js to localhost only, run web server as non-root user, create separate `.env.web` with only the variables the dashboard needs (session secret, no API keys).

3. **Web server process management** -- No process manager exists on the server; cron is the only scheduler. A web server that crashes or the server reboots leaves the dashboard down silently. **Fix:** systemd service with `Restart=always`, `MemoryMax=512M`, and a health check endpoint.

4. **Authentication bolt-on syndrome** -- Rushing weak auth (basic auth over HTTP, shared password, JWT in localStorage) is worse than SSH-only access. **Fix:** Server-side sessions with HttpOnly/Secure/SameSite cookies, Argon2id-hashed passwords in a users table, rate-limited login endpoint, HTTPS required.

5. **Monolith coupling** -- Bolting dashboard routes directly into the sync codebase pulls in Playwright and sync dependencies. **Fix:** Separate `server/` directory; only `lib/*-db.js` modules are shared between sync and dashboard.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Infrastructure Foundation
**Rationale:** Every subsequent phase depends on WAL mode, Node.js 22, and correct database paths. These are prerequisites, not features. Doing them first means every later phase builds on stable ground.
**Delivers:** Node.js 22 upgrade, WAL mode on all databases, dashboard.sqlite schema, absolute database paths, server memory profiling
**Addresses:** No user-facing features (pure foundation)
**Avoids:** Pitfall 1 (SQLITE_BUSY), Pitfall 13 (database path differences)

### Phase 2: Run Tracking
**Rationale:** Without structured run data in the database, there is nothing to display. The pipelines already compute the data -- this phase just persists it. Start with one pipeline (people) as proof of concept, then extend to all 6.
**Delivers:** `lib/run-tracker.js`, all 6 pipelines instrumented, `sync_runs` and `sync_run_errors` populated after each cron run
**Addresses:** Data capture (FEATURES.md critical path item 1 and 2)
**Avoids:** Pitfall 10 (monolith coupling -- run-tracker is a clean lib/ module)

### Phase 3: Web Server and Authentication
**Rationale:** The web server and auth must exist before any UI is accessible. Auth before deployment, not after. This phase also sets up nginx, TLS, systemd, and the non-root user.
**Delivers:** Fastify server, nginx reverse proxy with TLS, systemd service, login system with individual user accounts, session management
**Addresses:** Authentication (table stakes), process management
**Avoids:** Pitfall 2 (credential exposure), Pitfall 3 (process dies unnoticed), Pitfall 5 (weak auth)
**Uses:** Fastify v5, @fastify/session, @fastify/cookie, argon2, fastify-session-better-sqlite3-store

### Phase 4: Dashboard UI
**Rationale:** With data flowing and auth in place, build the actual dashboard views. Server-rendered HTML with htmx -- no build step, fast iteration.
**Delivers:** Pipeline overview page, run history page, run detail page, error browser with drill-down, overdue detection
**Addresses:** All table-stakes features from FEATURES.md
**Avoids:** Pitfall 7 (stale data -- show sync-in-progress banner via lock file detection), Pitfall 11 (overengineering -- server-rendered HTML, not React SPA)
**Uses:** EJS v4, htmx v2, @fastify/view, @fastify/static

### Phase 5: Email Migration and Polish
**Rationale:** Once the dashboard is validated by actual usage, switch email from "always send" to "errors only." Add the differentiator features that make the dashboard a complete operations tool.
**Delivers:** Error-only email reports, duration trend charts, database statistics page, log file viewer, deployment script
**Addresses:** Email report toggle, differentiator features from FEATURES.md
**Avoids:** Pitfall 9 (deploy breaks running sync -- deployment script checks for running processes)

### Phase 6: Multi-Club Readiness (Future)
**Rationale:** Only build when a second club is onboarded. The schema is ready (club_slug column exists from Phase 1); this phase adds the directory structure, per-club config, and dashboard filtering.
**Delivers:** Database-per-club directory layout, club config registry, `sync.sh --club` flag, dashboard club filter
**Avoids:** Pitfall 4 (tenant isolation failure -- physical database separation, not shared tables)

### Phase Ordering Rationale

- **Infrastructure before code** because WAL mode and Node.js 22 are prerequisites that affect everything downstream. Deploying a web server on Node.js 18 with default journal mode will cause failures immediately.
- **Run tracking before UI** because the dashboard has nothing to display without persisted run data. Starting tracking early also accumulates historical data that makes the dashboard useful from day one.
- **Auth before UI** because the dashboard exposes operational data about club members. No route should be accessible without authentication.
- **UI as a single phase** because all dashboard views share the same templates, CSS, and htmx patterns. Building them together ensures consistent design.
- **Email migration after validation** because operators need to trust the dashboard before losing their email reports.
- **Multi-club deferred** because it is zero-value until a second club exists. The schema is ready; the implementation can wait.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Web Server + Auth):** Nginx configuration on this specific server, TLS/Let's Encrypt setup, systemd service configuration alongside existing crontab, and whether the server firewall needs adjustment for port 443. Also: validate that `fastify-session-better-sqlite3-store` works correctly with Fastify v5 (community package, MEDIUM confidence).
- **Phase 6 (Multi-Club):** Environment isolation strategy (separate processes per club vs. AsyncLocalStorage), cron management for multiple clubs, and how `process.env` globals interact with per-club credentials.

Phases with standard patterns (skip phase research):
- **Phase 1 (Infrastructure):** Node.js upgrade and SQLite WAL mode are well-documented, straightforward operations.
- **Phase 2 (Run Tracking):** Inserting records into SQLite after pipeline completion is a trivial extension of existing patterns.
- **Phase 4 (Dashboard UI):** Fastify + EJS + htmx for server-rendered dashboards is a well-established pattern with extensive documentation and examples.
- **Phase 5 (Polish):** Conditional email sending and static statistics pages are simple modifications to existing code.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified on npm with recent publication dates. Fastify v5, EJS v4, htmx v2 are actively maintained. Only MEDIUM-confidence item is the community session store package. |
| Features | HIGH | Feature landscape derived from direct codebase analysis of all 6 pipeline stats objects. Every data point the dashboard needs already exists in code. |
| Architecture | HIGH | Run-tracker pattern verified against existing pipeline return values. WAL mode concurrent access is well-documented SQLite behavior. Two-process model is standard. |
| Pitfalls | HIGH | All critical pitfalls verified against actual codebase: inspected all 5 `openDb()` functions (no WAL), confirmed server runs as root, confirmed no process manager exists. |

**Overall confidence:** HIGH

### Gaps to Address

- **Server firewall rules:** Unknown whether port 443 is currently open or blocked. Needs verification on the server before Phase 3.
- **Server RAM:** Unknown total RAM and current usage during peak sync. Memory profiling needed in Phase 1 to set appropriate systemd MemoryMax.
- **Nginx availability:** Unknown whether nginx is already installed on the server or needs installation. Check in Phase 3.
- **Session store compatibility:** The `fastify-session-better-sqlite3-store` package (v2.1.2) is community-maintained. Needs a quick integration test during Phase 3 to confirm it works with Fastify v5 and the project's better-sqlite3 version.
- **Domain/DNS for TLS:** A hostname (e.g., `dashboard.rondoclub.nl`) is needed for Let's Encrypt TLS certificates. Alternatively, use IP-based access with a self-signed cert, but this causes browser warnings.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all pipeline files, database modules, sync.sh, logger, and send-email.js
- [Fastify v5 documentation](https://fastify.dev/) -- framework capabilities, plugin ecosystem, Node.js 20+ requirement
- [SQLite WAL mode documentation](https://sqlite.org/wal.html) -- concurrent read/write guarantees
- [Node.js 18 EOL announcement](https://nodejs.org/en/blog/announcements/node-18-eol-support) -- EOL April 30, 2025
- npm registry -- verified publication dates and versions for all recommended packages
- Existing project documentation: `docs/database-schema.md`, `docs/sync-architecture.md`, `docs/operations.md`

### Secondary (MEDIUM confidence)
- [Fastify vs Express comparison (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) -- performance and feature comparison
- [htmx SSR best practices](https://htmx.org/essays/10-tips-for-ssr-hda-apps/) -- server-rendered HTML patterns
- [Argon2 vs bcrypt comparison](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/) -- password hashing algorithm selection
- [Database-per-Tenant SQLite pattern](https://medium.com/@dmitry.s.mamonov/database-per-tenant-consider-sqlite-9239113c936c) -- multi-club isolation model
- Pipeline monitoring best practices from Prefect, Cronitor, Azure Data Factory, and Google Cloud documentation

### Tertiary (LOW confidence)
- [fastify-session-better-sqlite3-store](https://www.npmjs.com/package/fastify-session-better-sqlite3-store) -- community package, v2.1.2, needs integration validation

---
*Research completed: 2026-02-08*
*Ready for roadmap: yes*
