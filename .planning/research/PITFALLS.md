# Domain Pitfalls: Adding a Web Dashboard to an Existing CLI/Cron Sync System

**Domain:** Web dashboard for Node.js CLI sync tool on production server
**Researched:** 2026-02-08
**Context:** Server (46.202.155.16) currently runs only cron-triggered sync jobs via SSH. Adding a web dashboard means introducing a long-running HTTP process, public network exposure, and concurrent database access -- all on a server that holds production credentials for Sportlink, Laposta, WordPress, FreeScout, and Nikki.

## Executive Summary

Adding a web dashboard to this system introduces five categories of risk that do not exist in the current SSH-only, cron-only architecture:

1. **SQLite concurrent access** -- The existing database layer uses `better-sqlite3` in default rollback journal mode with no WAL, no busy_timeout, and no multi-process awareness. A web server reading while sync writes will cause `SQLITE_BUSY` errors or stale reads.
2. **Attack surface expansion** -- The server currently has no open HTTP/HTTPS ports. Opening port 443 exposes every credential in `.env` to network-based attacks.
3. **Process lifecycle mismatch** -- Cron jobs are transient (run and exit). A web server is persistent (must survive crashes, reboots, memory leaks). These require fundamentally different process management.
4. **Credential and data isolation** -- Multi-club means multiple `.env` files and multiple database sets on one server. Tenant boundary violations leak one club's member data to another.
5. **Authentication bolt-on syndrome** -- Rushing to add auth to an internal tool often produces weak implementations that are worse than no auth at all.

---

## Critical Pitfalls

Mistakes that cause data corruption, security breaches, or require architectural rewrites.

### Pitfall 1: SQLite SQLITE_BUSY Errors from Concurrent Access

**What goes wrong:**
The web dashboard opens a `better-sqlite3` connection to read sync status, member data, and logs. Simultaneously, a cron-triggered sync process opens the same database file to write updates. Without WAL mode, SQLite uses rollback journal mode where **readers block writers and writers block readers**. The web server gets `SQLITE_BUSY: database is locked` errors, or worse, the sync process fails mid-run because the web server holds a read lock.

**Why it happens in THIS codebase:**
Every `openDb()` function across all five database modules (`rondo-club-db.js`, `laposta-db.js`, `nikki-db.js`, `freescout-db.js`, `discipline-db.js`) does:
```javascript
function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  initDb(db);
  return db;
}
```
No `PRAGMA journal_mode = WAL` is set. No `busy_timeout` is configured. The default journal mode is `DELETE` (rollback), which uses exclusive locks for writes and shared locks for reads that are incompatible with concurrent processes.

Current sync processes never collide because `flock` in `sync.sh` prevents same-type overlap, and different sync types write to different tables. A persistent web server breaks this assumption completely.

**Consequences:**
- Web dashboard shows "database locked" errors during sync windows (8:00, 11:00, 14:00, 17:00 and other scheduled times)
- Sync process fails because web server holds read transaction open
- If web server uses long-running read transactions (e.g., generating a report), WAL checkpoint starvation causes the WAL file to grow without bound
- In worst case, sync process silently skips members because it cannot acquire write lock

**Warning signs:**
- Intermittent 500 errors in dashboard during sync windows
- Sync logs show "SQLITE_BUSY" errors that did not exist before
- `data/*.sqlite-wal` files growing to megabytes
- Dashboard works fine at night but breaks during business hours

**Prevention strategy:**

1. **Enable WAL mode on all databases before adding the web server.** This is a prerequisite, not an optimization. WAL allows concurrent readers and one writer without blocking.

   ```javascript
   function openDb(dbPath = DEFAULT_DB_PATH) {
     const db = new Database(dbPath);
     db.pragma('journal_mode = WAL');
     db.pragma('busy_timeout = 5000');  // Wait 5 seconds before SQLITE_BUSY
     initDb(db);
     return db;
   }
   ```

2. **Set `busy_timeout` to at least 5000ms.** Research shows that anything below 5 seconds leads to occasional `SQLITE_BUSY` errors under concurrent load. The sync processes already have 500ms-2s delays between API calls, so a 5-second timeout will not create bottlenecks.

3. **Keep web server read transactions short.** Do not hold open database connections across HTTP request lifecycles. Open, query, close within each request handler. Never stream query results while holding a read lock.

4. **Monitor WAL file size.** Add a health check endpoint that reports `*.sqlite-wal` file sizes. If a WAL file exceeds 10MB, checkpoint starvation is occurring.

**Which phase should address this:** Foundation/infrastructure phase. WAL mode must be enabled BEFORE the web server is deployed. This change is backward-compatible with existing sync processes and should be made first.

**Confidence:** HIGH -- verified by inspecting all five `openDb()` functions in the codebase. None set WAL mode or busy_timeout.

---

### Pitfall 2: Exposing Production Credentials via HTTP Attack Surface

**What goes wrong:**
The server at 46.202.155.16 currently has SSH as its only network entry point. The `.env` file contains credentials for six external systems:
- Sportlink (username, password, TOTP secret)
- Laposta (API key)
- WordPress/Rondo Club (URL, username, app password)
- FreeScout (API key, URL)
- Nikki (API key, URL)
- Postmark (API key, sender email)

Adding an HTTP/HTTPS server opens a new attack surface. A vulnerability in the web framework, a misconfigured route, or an unpatched Node.js version exposes all of these credentials.

**Why it happens:**
- Node.js web servers should never be directly exposed to the internet without a reverse proxy. Direct exposure means the Node.js process handles TLS termination, HTTP parsing, and request routing -- any bug in these layers is exploitable.
- The `.env` file is loaded into `process.env` at startup. Every dependency in `node_modules` has access to these environment variables. A supply-chain attack in any dependency can exfiltrate all credentials.
- Express (or similar) in development mode returns full stack traces in error responses, leaking file paths and internal structure.
- The server runs as root (`ssh root@46.202.155.16`), meaning the web server process likely runs as root too, giving any exploit full system access.

**Consequences:**
- Attacker gains Sportlink credentials (access to all member personal data for the entire club)
- Attacker gains Laposta API key (can send emails to all club members)
- Attacker gains WordPress app password (can modify/delete all club data)
- Complete member data breach (names, addresses, phone numbers, birthdates, financial data)

**Warning signs:**
- Port scan shows Node.js server responding directly on port 3000/8080
- No nginx/caddy reverse proxy in front of Node.js
- Web server process running as root
- TLS certificate errors or missing HTTPS
- `.env` file readable by non-root users

**Prevention strategy:**

1. **Never expose Node.js directly to the internet.** Use nginx or Caddy as a reverse proxy with TLS termination. Bind Node.js to `127.0.0.1:3000` (localhost only).

   ```nginx
   server {
       listen 443 ssl;
       server_name dashboard.rondoclub.nl;

       ssl_certificate /etc/letsencrypt/live/dashboard.rondoclub.nl/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/dashboard.rondoclub.nl/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

2. **Run the web server as a non-root user.** Create a dedicated `rondo-web` user with read-only access to the database files and no access to `.env` directly. Pass only the credentials the web server needs (e.g., a session secret) via a separate config file.

3. **Separate web server credentials from sync credentials.** The web server does NOT need Sportlink credentials, Laposta API keys, or Postmark tokens. It only needs read access to SQLite databases and its own session secret. Create a `.env.web` with only the minimum required variables.

4. **Implement Content Security Policy headers, rate limiting, and security headers** via the reverse proxy (Helmet.js for Express, or nginx config).

5. **Never serve the `.env` file or `data/` directory as static content.** Ensure the static file serving configuration explicitly excludes sensitive paths.

**Which phase should address this:** Infrastructure/foundation phase. The reverse proxy, TLS, and process isolation must be set up before any routes are exposed.

**Confidence:** HIGH -- verified server access is currently root-only via SSH, and `.env` contains all listed credentials.

---

### Pitfall 3: Web Server Process Dies and Nobody Notices

**What goes wrong:**
Cron jobs are fire-and-forget: they run, do their work, and exit. If one fails, the next scheduled run tries again. A web server must stay alive continuously. Without proper process management:
- Node.js crashes (unhandled rejection, OOM) and the dashboard goes down
- Server reboots and the web server does not restart
- Memory leaks slowly degrade performance over days/weeks until crash
- No alerting tells anyone the dashboard is down

**Why it happens in THIS system:**
The current system has no process manager. Cron jobs are scheduled via `crontab` and `sync.sh`, which is appropriate for transient processes. There is no systemd service, no PM2 configuration, no Docker container. Adding a web server by running `node server.js &` or adding it to crontab with `@reboot` is fragile.

**Consequences:**
- Dashboard unavailable for hours/days without anyone knowing
- If the web server process also triggers sync jobs (future feature), sync stops entirely
- Memory leak causes OOM killer to also kill sync processes sharing the server
- Zombie processes accumulate (if web server spawns child processes for reports)

**Warning signs:**
- Dashboard URL returns connection refused intermittently
- `ps aux | grep node` shows no web server process
- Server uptime is high but dashboard has been down for days
- Memory usage slowly climbs over weeks

**Prevention strategy:**

1. **Use systemd for the web server process.** Systemd provides automatic restart on crash, boot-time startup, logging integration, memory limits, and process isolation.

   ```ini
   [Unit]
   Description=Rondo Dashboard
   After=network.target

   [Service]
   Type=simple
   User=rondo-web
   WorkingDirectory=/home/sportlink
   ExecStart=/usr/bin/node /home/sportlink/dashboard/server.js
   Restart=always
   RestartSec=5
   MemoryMax=512M
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

2. **Do NOT use PM2 alongside cron.** PM2's built-in cron restart feature causes problems when you also have system cron jobs. The cron jobs and PM2 have different process models and can conflict. Use systemd for the web server and keep cron for sync jobs -- they serve different purposes.

3. **Add a health check endpoint** that monitoring can poll. Return sync status and database accessibility.

4. **Set memory limits** to prevent the web server from OOM-killing sync processes. The web server should be limited to 256-512MB. If it exceeds this, systemd restarts it cleanly.

5. **Separate log streams.** Web server logs should go to a different location than sync logs. Use systemd journal or a dedicated log file so web server crashes do not get lost in sync logs.

**Which phase should address this:** Infrastructure phase, before the web server goes to production.

**Confidence:** HIGH -- verified no systemd service or process manager exists on the server.

---

### Pitfall 4: Multi-Club Database Isolation Failure

**What goes wrong:**
When the system expands to support multiple clubs, each club needs:
- Its own set of SQLite databases (4 per club)
- Its own `.env` credentials (Sportlink, Laposta, WordPress per club)
- Its own sync schedule

A common mistake is using a shared database with a `club_id` column to separate data. This is dangerous with SQLite because:
- Single-writer contention: all clubs compete for the same write lock
- A bug in a WHERE clause leaks Club A's member data to Club B's admin
- Schema migrations must be backward-compatible with all clubs simultaneously
- One club's large sync can block all other clubs' dashboard access

**Why it happens:**
The "add a column" approach feels simpler than managing multiple database sets. Developers underestimate the risk of cross-tenant data leakage, especially in a system where queries are built dynamically from field mappings.

The current codebase uses hardcoded paths like:
```javascript
const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'rondo-sync.sqlite');
```

This works for single-club but provides no tenant isolation.

**Consequences:**
- Club A's admin sees Club B's member personal data (GDPR violation)
- One club's sync blocks another club's dashboard (SQLite write lock)
- Database migration failure corrupts all clubs' data at once
- Credential mix-up sends sync data to wrong WordPress instance

**Warning signs:**
- Queries that don't include `WHERE club_id = ?` anywhere
- Single `.env` file with credentials for multiple clubs
- All clubs' data in one SQLite file
- No automated tests for tenant isolation

**Prevention strategy:**

1. **Use database-per-tenant (per-club).** SQLite's file-based architecture makes this natural. Each club gets its own `data/{club_slug}/` directory with its own set of 4 databases. This provides physical isolation -- a query cannot accidentally cross tenant boundaries because the database connection itself is scoped.

   ```
   data/
     fc-example/
       rondo-sync.sqlite
       laposta-sync.sqlite
       nikki-sync.sqlite
       freescout-sync.sqlite
     sv-other-club/
       rondo-sync.sqlite
       ...
   ```

2. **Scope database connections per request.** Use middleware that determines the club from the authenticated session and opens only that club's databases. Never keep cross-club connections in a shared pool.

   ```javascript
   function getClubDb(clubSlug, dbName) {
     const dbPath = path.join(DATA_DIR, clubSlug, `${dbName}.sqlite`);
     const db = new Database(dbPath);
     db.pragma('journal_mode = WAL');
     db.pragma('busy_timeout = 5000');
     return db;
   }
   ```

3. **Store credentials per-club in separate config files**, not in a shared `.env`. Each club gets its own `config/{club_slug}.env` with its Sportlink credentials, Laposta key, WordPress URL, etc.

4. **Test tenant isolation explicitly.** Write tests that verify: given two clubs' databases, a request authenticated as Club A cannot access Club B's data.

**Which phase should address this:** Multi-club preparation phase. Design the directory structure and config approach before adding the second club. Retrofitting isolation is much harder.

**Confidence:** HIGH -- verified the hardcoded `DEFAULT_DB_PATH` pattern in all five database modules.

---

### Pitfall 5: Authentication That Is Worse Than No Authentication

**What goes wrong:**
The current system has strong security: SSH key-based access only. Adding a web dashboard with weak authentication (basic auth over HTTP, JWT in localStorage, session without CSRF protection) creates a false sense of security while actually being less secure than SSH.

Common authentication mistakes for internal dashboards:
- **Basic auth without HTTPS**: credentials sent in cleartext
- **JWT stored in localStorage**: vulnerable to XSS exfiltration, every npm dependency can read it
- **No session expiration**: a stolen cookie grants permanent access
- **Shared password for all users**: no accountability, no revocation
- **No CSRF protection**: malicious site can trigger actions on the dashboard
- **Rolling your own auth**: custom password hashing, custom token generation

**Why it happens:**
Internal tool developers think "it's just for us" and implement minimal auth. The dashboard starts as "just for the admin" but eventually needs to be accessible to multiple board members, team managers, or committee leads. Quick-and-dirty auth does not scale and creates liability.

**Consequences:**
- Stolen session cookie provides full access to all member personal data
- XSS vulnerability in any dashboard page exfiltrates all active sessions
- No audit trail of who accessed what data
- GDPR compliance issues (member data accessible without proper access controls)
- Password shared via WhatsApp/email becomes known to ex-board members

**Warning signs:**
- Login form on HTTP (not HTTPS)
- Password stored in `.env` or config file rather than hashed in database
- No "logout" functionality
- Sessions never expire
- No rate limiting on login attempts
- Same credentials work for everyone

**Prevention strategy:**

1. **Use an established session library**, not custom JWT implementation. For a small internal dashboard, server-side sessions with `express-session` and a SQLite session store are simpler and more secure than JWT. Sessions can be revoked (just delete from store), have built-in expiration, and do not require client-side storage.

2. **HTTPS is non-negotiable.** TLS must be in place before any login page exists. Use Let's Encrypt with Certbot auto-renewal via the nginx reverse proxy.

3. **Store session cookies as HttpOnly, Secure, SameSite=Strict.** This prevents JavaScript access (XSS cannot steal the cookie), ensures cookies are only sent over HTTPS, and prevents CSRF from other domains.

4. **Hash passwords with bcrypt or argon2.** Never store plaintext passwords. Even for a single admin user, use proper password hashing.

5. **Implement rate limiting on the login endpoint.** Limit to 5 attempts per IP per 15 minutes. This prevents brute force attacks.

6. **Add session expiration.** Sessions should expire after 8 hours of inactivity and have a maximum lifetime of 24 hours regardless of activity.

7. **Plan for multi-user from the start.** Even if v1 has one admin user, store users in a database table with hashed passwords and roles. Adding users later is trivial; retrofitting a user model is not.

**Which phase should address this:** Authentication phase, before the dashboard is accessible from outside localhost.

**Confidence:** HIGH -- these are well-established security best practices, not speculative.

---

## Moderate Pitfalls

Mistakes that cause operational pain, degraded experience, or technical debt.

### Pitfall 6: Web Server Interferes with Sync Process Memory/CPU

**What goes wrong:**
The server has finite resources. Sync processes (especially Playwright browser automation) are memory-intensive. A web server with a frontend build (React/Vite) serving dashboards with charts and tables also uses significant memory. Together, they can exceed the server's RAM, triggering the OOM killer which randomly kills processes.

**Why it matters here:**
Playwright launches headless Chromium, which uses 200-500MB per instance. The sync processes already use significant memory during the Sportlink scraping phase. Adding a web server with in-memory session store, database caches, and chart rendering can push total memory usage past the server's limits.

**Prevention:**
- **Profile current server memory usage** during peak sync. Run `free -h` during a people sync to establish baseline.
- **Set memory limits via systemd** for the web server (MemoryMax=512M).
- **Never run Playwright from the web server.** The web server should only read database state, not trigger sync operations. Keep sync as cron-only.
- **If adding "trigger sync" button to dashboard**, use a message queue or signal file, not a direct function call. The web server writes a request; the sync process picks it up independently.

**Which phase should address this:** Infrastructure phase. Memory profiling before adding the web server.

### Pitfall 7: Dashboard Shows Stale or Inconsistent Data During Sync

**What goes wrong:**
A sync run takes 5-30 minutes. During this time, the database is in a transitional state: some members are updated, others are not yet. The dashboard reads this mid-sync state and shows inconsistent data:
- Member counts fluctuate during sync
- Some members show updated data, adjacent members show old data
- Progress indicators are meaningless (database does not track "sync progress")
- "Last synced" timestamp updates per-member, so the global "last sync" time is misleading

**Why it matters here:**
The hash-based change detection pattern means `source_hash != last_synced_hash` for members not yet synced in the current run. The dashboard could show "247 members pending sync" which drops to 0 over 20 minutes, confusing users into thinking something is broken.

**Prevention:**
- **Show sync status prominently.** If a sync is running (detect via flock lock file existence), show a banner: "Sync in progress, data may be updating."
- **Use `last_synced_at` timestamps** to show per-member freshness rather than a single global timestamp.
- **Do not cache dashboard data aggressively.** Since data changes during sync, cache TTL should be short (10-30 seconds) or absent.
- **Consider a "sync runs" table** that tracks start/end time of each sync run, providing a reliable "last completed sync" timestamp.

**Which phase should address this:** Dashboard UI phase.

### Pitfall 8: Sync.sh Flock and Web Server Conflict

**What goes wrong:**
The current `sync.sh` uses `flock` to prevent concurrent runs of the same sync type. If the web server also needs to read lock state (to show "sync in progress") or trigger sync operations, it must interact with the same lock files. Getting this wrong causes:
- Web server acquires lock, preventing cron sync from running
- Web server cannot detect lock state (checks wrong file path)
- Lock files on `process.cwd()` differ between web server and cron context

**Why it matters here:**
`sync.sh` resolves `PROJECT_DIR` from the script's location and creates lock files at `$PROJECT_DIR/.sync-${SYNC_TYPE}.lock`. The web server runs from a different working directory or with a different user, so `process.cwd()` returns a different path.

**Prevention:**
- **Use absolute paths for lock files.** Hardcode `/home/sportlink/.sync-*.lock` rather than relying on `process.cwd()`.
- **Web server should only READ lock state, never acquire locks.** Check lock file existence with `flock -n` in test mode, or simply check if the lock file is being held by another process.
- **Do not add "run sync" functionality** to the web server in the initial version. This is a significant source of bugs. Read-only dashboard first.

**Which phase should address this:** Dashboard infrastructure phase.

### Pitfall 9: Deploying Web Server Changes Breaks Running Sync

**What goes wrong:**
Current deployment is `git pull && npm install`. If this runs while a sync process is active, Node.js modules are replaced underneath the running process. This can cause:
- Segfaults (native modules like `better-sqlite3` replaced mid-execution)
- Module not found errors (dependency tree changed)
- Sync process uses mix of old and new code

With a persistent web server, deployment is more complex: the server must be restarted after code changes. But restarting the web server while a sync is running (and they share database access) can cause lock issues.

**Prevention:**
- **Restart web server separately from sync.** Deploy sequence: (1) `git pull`, (2) `npm install`, (3) wait for any running sync to finish, (4) `systemctl restart rondo-dashboard`.
- **Use `systemctl reload`** if supported, for zero-downtime restarts.
- **Never deploy during peak sync windows** (8:00, 11:00, 14:00, 17:00 Amsterdam time).
- **Add a deployment script** that checks for running sync processes before restarting.

**Which phase should address this:** Infrastructure/deployment phase.

### Pitfall 10: Bolting Dashboard Routes onto Sync Codebase

**What goes wrong:**
The temptation is to add Express routes directly into the existing sync codebase: import `rondo-club-db.js`, add `app.get('/api/members', ...)`, done. This creates a monolith where:
- Web server startup initializes Playwright (not needed for dashboard)
- Database module changes for dashboard break sync processes
- Web server dependencies bloat the sync deployment
- `require()` order issues cause initialization side effects
- Testing web routes requires mocking sync infrastructure

**Prevention:**
- **Separate the web server entry point from sync pipelines.** The dashboard should have its own `dashboard/server.js` that imports only the database modules it needs.
- **Database modules are the shared layer.** The `lib/*-db.js` files should be the ONLY shared code between sync and dashboard. All other code (routes, middleware, templates) lives in a separate `dashboard/` directory.
- **Do not add web framework dependencies to the main `package.json`** if they are not needed by sync. Consider whether a separate `package.json` for the dashboard makes sense, or carefully manage that Express/Fastify/etc. are devDependencies for the sync side.

   ```
   lib/               # Shared: database modules (used by both sync and dashboard)
   pipelines/         # Sync-only: pipeline orchestrators
   steps/             # Sync-only: pipeline steps
   dashboard/         # Dashboard-only: web server, routes, templates
     server.js        # Entry point
     routes/          # API routes
     views/           # Templates
   ```

**Which phase should address this:** Architecture/foundation phase. Establish the directory structure before writing the first route.

---

## Minor Pitfalls

Mistakes that cause annoyance but are recoverable.

### Pitfall 11: Overengineering the First Dashboard Version

**What goes wrong:**
Building a full React SPA with real-time WebSocket updates, interactive data tables, chart libraries, and admin panels before the basic read-only dashboard is validated. The team spends weeks on framework setup, build tooling, and component libraries before answering: "Does anyone actually use this dashboard?"

**Prevention:**
- **Start with server-rendered HTML.** A few pages showing sync status, member counts, and recent errors is all that is needed initially. Pug/EJS templates with minimal CSS.
- **Add interactivity only where needed.** If a table needs sorting, add it. Do not pre-build a component library.
- **Validate usage before investing.** If the dashboard is used daily by board members after 2 weeks, invest in richer UI. If it's checked once a month, keep it simple.

**Which phase should address this:** MVP dashboard phase.

### Pitfall 12: Ignoring GDPR Implications of Web Access

**What goes wrong:**
Member personal data (names, addresses, phone numbers, birthdates, financial status) was previously only accessible via SSH to authorized administrators. A web dashboard makes this data accessible via a browser, potentially from personal devices, shared computers, or public WiFi. GDPR requires:
- Purpose limitation (why is this data displayed?)
- Data minimization (show only what is needed)
- Access logging (who viewed what, when?)
- Right to erasure (can a member request their data be removed from the dashboard cache?)

**Prevention:**
- **Do not display full addresses or phone numbers unless necessary.** Show masked versions (e.g., "A*****straat **", "+31 6 **** **78").
- **Log dashboard access** (who logged in, which pages they visited, when).
- **Implement role-based access.** Board treasurer sees financial data; team manager sees only their team's members.
- **Add a privacy notice** explaining what data is shown and why.

**Which phase should address this:** Authentication and authorization phase (roles), with privacy considerations from the start.

### Pitfall 13: Database Path Differences Between Environments

**What goes wrong:**
Sync processes resolve database paths relative to `process.cwd()`, which is `/home/sportlink` on the server. The web server, if started from a different directory or by systemd with a different `WorkingDirectory`, resolves to a different path and creates empty databases instead of reading existing ones.

**Prevention:**
- **Use absolute paths in database modules.** Change `DEFAULT_DB_PATH` to use `__dirname` resolution or a config constant, not `process.cwd()`.
- **Verify on first web server startup** that all expected database files exist and are non-empty. Log a clear error if databases are missing.
- **Set `WorkingDirectory=/home/sportlink`** in the systemd service file.

**Which phase should address this:** Foundation phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| Infrastructure / Foundation | SQLite SQLITE_BUSY (Pitfall 1) | Enable WAL mode and busy_timeout on ALL databases before adding web server | CRITICAL |
| Infrastructure / Foundation | Credential exposure (Pitfall 2) | Reverse proxy + TLS + non-root user + credential separation before any HTTP exposure | CRITICAL |
| Infrastructure / Foundation | Process management (Pitfall 3) | systemd service with memory limits and auto-restart | CRITICAL |
| Infrastructure / Foundation | Database path resolution (Pitfall 13) | Absolute paths or verified WorkingDirectory | MODERATE |
| Architecture | Monolith coupling (Pitfall 10) | Separate `dashboard/` directory, shared only `lib/*-db.js` | MODERATE |
| Authentication | Weak auth (Pitfall 5) | Server-side sessions, bcrypt, HttpOnly cookies, rate limiting | CRITICAL |
| Dashboard MVP | Stale data during sync (Pitfall 7) | Sync status indicator, lock file detection | MODERATE |
| Dashboard MVP | Overengineering (Pitfall 11) | Start with server-rendered HTML, validate usage first | MINOR |
| Deployment | Deploy breaks running sync (Pitfall 9) | Deployment script that waits for sync completion | MODERATE |
| Multi-club | Tenant isolation (Pitfall 4) | Database-per-tenant from the start, not shared tables | CRITICAL |
| Multi-club | GDPR compliance (Pitfall 12) | Data masking, access logging, role-based access | MODERATE |
| Operations | Web server resource contention (Pitfall 6) | Memory limits, never run Playwright from web server | MODERATE |
| Operations | Flock conflict (Pitfall 8) | Absolute lock file paths, read-only lock state checking | MODERATE |

## Domain-Specific Anti-Patterns

### Anti-Pattern 1: "Just Add Express to the Sync Process"

**Why it fails:**
Combining the web server and sync process into one Node.js process means:
- Sync failures crash the web server
- Web server memory leaks eventually crash the sync
- Cannot restart web server without interrupting running sync
- Cannot scale them independently (sync is CPU-bound during scraping; web is I/O-bound)

**Instead:** Run them as separate processes that share only database files. The web server is a **consumer** of sync output, not part of the sync pipeline.

### Anti-Pattern 2: "SQLite Is Fine for a Web Server Without Changes"

**Why it fails:**
SQLite is excellent for web servers -- but only when configured correctly. The default rollback journal mode was designed for single-process access. Multi-process access requires WAL mode, which is a one-line change but must be made explicitly. Assuming the existing database configuration "just works" for a web server leads to intermittent failures that are difficult to reproduce and diagnose.

**Instead:** Enable WAL mode in the `openDb()` function before deploying the web server. This is a non-breaking change that also improves performance for the existing sync processes.

### Anti-Pattern 3: "We'll Add Security Later"

**Why it fails:**
Security retrofits are always more expensive than upfront design. An internal dashboard without auth "just until we add it" gets shared via URL, bookmarked on personal devices, and accessed from untrusted networks. By the time auth is added, the habits are formed and users resist the friction.

**Instead:** No dashboard route should be accessible without authentication from day one. Even a simple username/password form with bcrypt hashing is sufficient for v1, as long as it is served over HTTPS with HttpOnly session cookies.

### Anti-Pattern 4: "Shared Password Is Good Enough for Now"

**Why it fails:**
A shared admin password (stored in `.env` or config) cannot be revoked when a board member steps down. It provides no audit trail. It will be shared via WhatsApp and become known to people who should no longer have access. For a system holding personal data of ~1000 club members, this is a GDPR liability.

**Instead:** Individual user accounts from day one. Even if there are only 2-3 users initially, store them in a `users` table with hashed passwords. When someone leaves the board, disable their account.

---

## Sources

SQLite Concurrent Access:
- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html)
- [better-sqlite3 Performance / Concurrency](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Concurrent Writes and "database is locked" errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [What to do about SQLITE_BUSY errors despite setting a timeout](https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/)

Production Node.js:
- [How to Set Up a Node.js Application for Production (DigitalOcean)](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-20-04)
- [Why Use a Reverse Proxy with Node.js](https://medium.com/intrinsic-blog/why-should-i-use-a-reverse-proxy-if-node-js-is-production-ready-5a079408b2ca)
- [Node.js Security Best Practices](https://nodejs.org/en/learn/getting-started/security-best-practices)
- [Nginx Reverse Proxy for Node.js (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/nodejs-reverse-proxy-nginx/)

Process Management:
- [PM2 Guide (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/pm2-guide/)
- [PM2 Cron Job Multiple Instances](https://greenydev.com/blog/pm2-cron-job-multiple-instances/)

Multi-Tenant SQLite:
- [Database-per-Tenant: Consider SQLite](https://medium.com/@dmitry.s.mamonov/database-per-tenant-consider-sqlite-9239113c936c)
- [Multi-tenancy - High Performance SQLite](https://highperformancesqlite.com/watch/multi-tenancy)
- [Multi-Tenancy with Node.js AsyncLocalStorage](https://medium.com/@jfelipevalr/multi-tenancy-with-node-js-asynclocalstorage-4c771a3d06ed)

Authentication and Security:
- [Do not use secrets in environment variables (Node.js Security)](https://www.nodejs-security.com/blog/do-not-use-secrets-in-environment-variables-and-here-is-how-to-do-it-better)
- [How to Avoid JWT Security Mistakes in Node.js](https://www.nodejs-security.com/blog/how-avoid-jwt-security-mistakes-nodejs)
- [Stop using JWTs for sessions](https://gist.github.com/samsch/0d1f3d3b4745d778f78b230cf6061452)
- [JWT vs Session-Based Auth](https://medium.com/@aysunitai/jwt-vs-session-based-auth-a-developers-complete-guide-9e0a7929afda)
