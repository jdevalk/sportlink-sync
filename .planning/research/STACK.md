# Technology Stack

**Project:** Rondo Sync Web Dashboard
**Researched:** 2026-02-08
**Focus:** Stack additions for adding a web dashboard to the existing Node.js CLI sync tool

---

## Prerequisite: Node.js Upgrade

**Before anything else, upgrade Node.js from 18 to 22.**

Node.js 18 reached end-of-life on April 30, 2025. It receives no security patches. Node.js 22 is the current Active LTS (supported until April 2027) and is the correct upgrade target -- skip Node.js 20 to avoid another upgrade cycle in 18 months.

| Current | Target | Why Skip 20 |
|---------|--------|-------------|
| Node.js 18 (EOL) | Node.js 22 LTS | 20 enters maintenance soon; 22 has active LTS until April 2027 |

**Impact on existing code:** The existing dependencies (better-sqlite3, Playwright, otplib, postmark, varlock) all support Node.js 22. No breaking changes expected -- better-sqlite3 uses native addons that rebuild on install. The upgrade is a prerequisite because the recommended web framework (Fastify v5) requires Node.js 20+.

**Confidence:** HIGH (verified via Node.js official EOL schedule and Fastify docs)

---

## Recommended Stack

### Web Framework: Fastify v5

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| fastify | 5.7.x | HTTP server, routing, plugin architecture | Best performance/DX ratio for Node.js; plugin system fits the existing modular codebase; built-in schema validation; 2-3x faster than Express |

**Why Fastify over Express:**

1. **Plugin architecture matches the codebase.** Rondo Sync already uses a modular pattern: `lib/` for shared code, `pipelines/` for orchestration, `steps/` for units of work. Fastify's encapsulated plugin system maps naturally to this. Each dashboard feature (auth, pipeline status, error browsing) becomes a self-contained plugin.

2. **Performance is meaningful here.** The dashboard will query SQLite databases (4 databases, 21 tables) for run history and error drill-down. Fastify's faster JSON serialization and lower overhead mean snappier responses even on the single VPS (46.202.155.16) that also runs sync pipelines.

3. **Built-in schema validation (Ajv).** Useful for validating query parameters on error-browsing endpoints (date ranges, pipeline filters, pagination) without adding a separate validation library.

4. **Active maintenance and OpenJS Foundation backing.** Fastify v5 was released to GA in late 2024 and is actively maintained (v5.7.4 released February 2026). Express 5 works but has historically had slow release cadence.

**Why not Express:** Express 5 (v5.2.1) is a viable alternative that supports Node.js 18+. However, its middleware-chain architecture is less structured than Fastify's plugin system, leading to more ad-hoc organization in a growing codebase. Express would also work -- it is the safe fallback if Fastify's learning curve is a concern. But for a new addition to the project, Fastify is the better long-term investment.

**Why not Hono:** Hono excels at edge/serverless and tiny bundles. This dashboard runs on a dedicated VPS -- Hono's strengths are irrelevant, and its ecosystem is smaller for server-side rendering use cases.

**Confidence:** HIGH (verified via npm, Fastify docs, GitHub releases)

---

### Template Engine: EJS v4

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ejs | 4.0.x | Server-side HTML rendering | Actively maintained (v4.0.1 published Jan 2026); syntax is plain HTML + JS; zero learning curve for anyone who knows JavaScript |

**Why EJS over Nunjucks:**

- Nunjucks (v3.2.4) has not been updated in 3 years. While it still works, relying on unmaintained software for new features is a poor trade.
- EJS v4 was released in January 2026 with active maintenance.
- EJS syntax is just JavaScript inside `<%= %>` tags -- no new template language to learn. The existing codebase is 100% JavaScript, and the team does not need Nunjucks' Jinja2-style features (macros, complex inheritance).
- EJS is natively supported by `@fastify/view` (the official Fastify template plugin).

**Why not Eta:** Eta is faster in benchmarks (20ms vs 68ms per render), but for a dashboard serving a handful of concurrent users, this difference is irrelevant. EJS has 50x the npm usage (15,000+ dependents vs ~300 for Eta), meaning better community support, more examples, and easier debugging.

**Why not a React/Vite SPA:** Rondo Club (the WordPress theme) already uses React/Vite for its front-end. However, adding a full SPA build pipeline to a CLI tool is massive overhead for what is essentially a read-only dashboard with tables, filters, and drill-down links. Server-rendered HTML with htmx for interactivity is dramatically simpler: no build step, no client-side state management, no API layer to design.

**Confidence:** HIGH (verified via npm publication dates)

---

### Interactivity: htmx v2

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| htmx.org | 2.0.x | AJAX interactions without JavaScript | Enables partial page updates (filter tables, load error details, poll for running pipeline status) with HTML attributes instead of client-side JS |

**Why htmx:**

1. **No build step.** Include via CDN or vendor the 14KB minified file. The existing project has zero front-end build tooling and should keep it that way.
2. **Server-rendered architecture.** The dashboard is fundamentally a data viewer: tables of pipeline runs, lists of errors, member detail pages. htmx lets you add interactivity (filtering, pagination, live status polling) by returning HTML fragments from the server -- which Fastify + EJS already produce.
3. **Tiny footprint.** 14KB gzipped, no dependencies. Compare to React (45KB+) or even Alpine.js (15KB but adds a JS framework).

**Use cases in this dashboard:**
- `hx-get` for paginated error tables and drill-down
- `hx-trigger="every 5s"` for polling pipeline run status
- `hx-swap="innerHTML"` for filter changes without full page reload

**Delivery:** Vendor the file into `public/vendor/htmx.min.js` rather than using a CDN. The server is on a VPS with no CDN in front of it, so self-hosting is more reliable.

**Confidence:** HIGH (htmx 2.0.8 verified via npm)

---

### CSS Framework: None (custom minimal CSS)

**Recommendation: Do not add a CSS framework.**

The dashboard is an internal tool used by a small number of club administrators. A simple, hand-written CSS file (~200-300 lines) using modern CSS features (grid, custom properties, container queries) is sufficient and avoids adding Tailwind's build step, Bootstrap's 200KB payload, or any other dependency.

If a CSS framework is desired later, the easiest addition would be **Simple.css** or **Pico CSS** -- classless CSS frameworks that style semantic HTML with zero configuration and no build step.

**Confidence:** HIGH (opinion based on project constraints)

---

### Authentication: Custom session-based auth with Fastify plugins

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @fastify/session | 11.1.x | Server-side session management | Official Fastify plugin; works with cookie-based sessions |
| @fastify/cookie | 11.0.x | Cookie parsing/setting | Required by @fastify/session |
| argon2 | 0.44.x | Password hashing (Argon2id) | NIST-recommended; superior to bcrypt against GPU/ASIC attacks |
| fastify-session-better-sqlite3-store | 2.1.x | Session storage in SQLite | Reuses the existing better-sqlite3 dependency; no new database server needed |

**Authentication architecture:**

This is a small internal dashboard (3-10 users). A full auth framework (Passport, Better Auth, Auth.js) is overkill. Instead:

1. **Users table** in a new `dashboard.sqlite` database (keeps dashboard state separate from sync state).
2. **Login form** that verifies password against Argon2id hash.
3. **Session cookie** stored in SQLite via `fastify-session-better-sqlite3-store`.
4. **Fastify preHandler hook** that checks session on protected routes.
5. **Multi-club readiness:** The users table includes a `club_id` column from day one, even if there is only one club initially. This avoids a schema migration later.

**Why not JWT:** JWTs are for stateless distributed systems. This is a single-server dashboard with SQLite -- server-side sessions are simpler, revocable, and more secure (no token exposure in localStorage).

**Why not Passport:** Passport adds unnecessary abstraction for a single auth strategy (local username/password). The entire auth implementation is ~50 lines of code without Passport.

**Why Argon2 over bcrypt:** Argon2id is the NIST-recommended algorithm as of 2025. bcrypt's fixed 4KB memory makes it increasingly vulnerable to FPGA attacks. Both work, but for new code, use the better algorithm.

**Confidence:** MEDIUM (session store package is community-maintained, not official Fastify; version 2.1.2 published 3 months ago -- reasonably active but needs validation during implementation)

---

### Fastify Plugin Ecosystem

| Plugin | Version | Purpose |
|--------|---------|---------|
| @fastify/view | 11.1.x | Template rendering (EJS integration) |
| @fastify/static | 9.0.x | Serve CSS, JS, and image files from `public/` |
| @fastify/formbody | 8.0.x | Parse `application/x-www-form-urlencoded` (login forms) |
| @fastify/cookie | 11.0.x | Cookie support (required by session plugin) |
| @fastify/session | 11.1.x | Session management |

All plugins are part of the official Fastify organization and are actively maintained.

**Confidence:** HIGH (verified via npm and Fastify ecosystem page)

---

### Database: SQLite (existing, extended)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | latest | Database driver (already in use) | No new dependency; synchronous API is simple for dashboard queries |

**Dashboard database strategy:**

Add a new SQLite database: `data/dashboard.sqlite`

This database holds:
- **users** -- Dashboard login accounts (email, argon2 hash, club_id, role)
- **pipeline_runs** -- Structured run data (pipeline name, started_at, finished_at, status, step results as JSON)
- **sync_errors** -- Individual errors from runs (run_id, step, member identifier, error type, error message, raw data)

**Why a separate database:** The four existing databases (`laposta-sync.sqlite`, `rondo-sync.sqlite`, `nikki-sync.sqlite`, `freescout-sync.sqlite`) track sync state and should not be polluted with dashboard concerns. The dashboard database is a consumer: it reads from the sync databases for current state and stores its own operational data (users, structured run history).

**Why not PostgreSQL/MySQL:** The project already uses better-sqlite3 everywhere. SQLite handles the expected load (a handful of concurrent dashboard users) without any issue. Adding a separate database server for an internal tool would be pure overhead.

**Structured run data:** The existing `sportlink_runs` table in `laposta-sync.sqlite` stores raw JSON results. The new `pipeline_runs` table adds structure: status enum, duration, step-level breakdown. Pipeline orchestrators (`pipelines/*.js`) need to be modified to write structured results here in addition to (or replacing) the current log-file-based reporting.

**Confidence:** HIGH (better-sqlite3 is already the proven database layer in this project)

---

### Email Reporting: Postmark (existing, modified)

| Technology | Version | Purpose | Change |
|------------|---------|---------|--------|
| postmark | 4.0.x | Email delivery (already in use) | Switch from "always email" to "email only on errors" |

No new dependency needed. The existing `scripts/send-email.js` and Postmark integration remain. The change is behavioral: pipeline orchestrators check run status and only send email when errors occur. The dashboard becomes the primary reporting interface; email becomes the exception-notification channel.

**Confidence:** HIGH (no technology change, only behavioral change)

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Web framework | Fastify v5 | Express v5 | Less structured plugin system; slower; but viable fallback |
| Web framework | Fastify v5 | Hono v4 | Optimized for edge/serverless, not server-side rendering on VPS |
| Template engine | EJS v4 | Nunjucks v3 | Unmaintained (3 years without update) |
| Template engine | EJS v4 | Eta v3 | Lower adoption, smaller community |
| Interactivity | htmx v2 | React SPA | Massive overhead for a read-only dashboard; requires build pipeline |
| Interactivity | htmx v2 | Alpine.js | htmx is more appropriate for server-rendered partial updates |
| Auth | Custom sessions | Passport.js | Unnecessary abstraction for single-strategy auth |
| Auth | Custom sessions | JWT tokens | Wrong tool for single-server dashboard with SQLite |
| Password hash | Argon2id | bcrypt | bcrypt works but Argon2id is NIST-recommended for new projects |
| Database | SQLite | PostgreSQL | Overkill; SQLite already handles all sync databases fine |
| CSS | Minimal custom | Tailwind | Requires build step; overkill for internal tool |
| CSS | Minimal custom | Bootstrap | 200KB payload; class soup; not needed for simple tables |

---

## Installation

```bash
# Prerequisite: upgrade Node.js to v22 LTS on the server
# (method depends on how Node.js was installed -- nvm, nodesource, etc.)

# Core web framework
npm install fastify@^5.7 @fastify/view@^11.1 @fastify/static@^9.0 @fastify/formbody@^8.0

# Session management
npm install @fastify/cookie@^11.0 @fastify/session@^11.1 fastify-session-better-sqlite3-store@^2.1

# Template engine
npm install ejs@^4.0

# Authentication
npm install argon2@^0.44

# Interactivity (vendor, not npm)
# Download htmx.min.js to public/vendor/htmx.min.js
curl -o public/vendor/htmx.min.js https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js
```

**Total new dependencies:** 9 npm packages + 1 vendored JS file

**No new devDependencies.** The project has no build step and should keep it that way.

---

## Integration with Existing Stack

### What stays the same

| Component | Status |
|-----------|--------|
| better-sqlite3 | Stays; shared with dashboard database |
| Playwright | Stays; sync pipelines unchanged |
| Postmark | Stays; email behavior changes from "always" to "errors only" |
| otplib | Stays; Sportlink TOTP unchanged |
| varlock | Stays; .env loading unchanged |
| lib/ modules | Stay; dashboard reads from existing DB modules |

### What changes

| Component | Change |
|-----------|--------|
| `pipelines/*.js` | Modified to write structured run data to `dashboard.sqlite` |
| `lib/logger.js` | Extended with a log-adapter that writes structured entries for dashboard consumption |
| `scripts/sync.sh` | Unchanged (still runs pipelines via cron) |
| `scripts/send-email.js` | Modified to only send on errors |

### New directory structure

```
server/                  # New: dashboard web server
  server.js              # Fastify instance, plugin registration
  plugins/               # Fastify plugins (auth, db, etc.)
  routes/                # Route handlers
  views/                 # EJS templates
  public/                # Static files (CSS, vendored htmx)
```

The dashboard server is a **separate process** from the sync pipelines. It runs alongside cron-triggered syncs on the same server, reading from the same SQLite databases.

---

## Multi-Club Architecture Considerations

The requirement is "structured so multi-club support can be added later." The stack supports this through:

1. **`club_id` on users and pipeline_runs tables** from day one. Queries filter by club_id.
2. **Database-per-club pattern** for sync databases (each club gets its own set of 4 sync SQLite files). The dashboard database remains shared (it stores user accounts and references to per-club data).
3. **Fastify's encapsulation** means club-scoping can be added as a plugin/hook without refactoring routes.

This is a schema/data design concern, not a stack concern. The recommended stack does not block multi-club support.

---

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| TypeScript | The codebase is ~20k lines of CommonJS JavaScript. Adding TS to a subset (dashboard) creates a split codebase. The benefit is minimal for an internal tool. |
| Webpack/Vite/esbuild | No client-side JS compilation is needed. EJS templates + vendored htmx need no build step. |
| Docker | Single-server deployment via git pull. Docker adds orchestration complexity with no benefit. |
| Redis | Session store and caching are well-served by SQLite for this scale. |
| WebSocket library | htmx's polling (`hx-trigger="every 5s"`) is simpler than WebSockets for near-real-time status. If real-time is needed later, Fastify has `@fastify/websocket`. |
| ORM (Knex, Prisma, etc.) | better-sqlite3's synchronous API with raw SQL is simpler and faster. The team already writes SQL everywhere. |

---

## Sources

### Official / Verified (HIGH confidence)
- [Fastify v5 npm](https://www.npmjs.com/package/fastify) -- v5.7.4, published Feb 2026
- [Fastify v5 requires Node.js 20+](https://fastify.dev/docs/latest/Reference/LTS/)
- [Node.js 18 EOL announcement](https://nodejs.org/en/blog/announcements/node-18-eol-support) -- EOL April 30, 2025
- [Express 5 npm](https://www.npmjs.com/package/express) -- v5.2.1, supports Node.js 18+
- [EJS npm](https://www.npmjs.com/package/ejs) -- v4.0.1, published Jan 2026
- [htmx npm](https://www.npmjs.com/package/htmx.org) -- v2.0.8
- [@fastify/view npm](https://www.npmjs.com/package/@fastify/view) -- v11.1.1
- [@fastify/static npm](https://www.npmjs.com/package/@fastify/static) -- v9.0.0
- [@fastify/session npm](https://www.npmjs.com/package/@fastify/session) -- v11.1.1
- [argon2 npm](https://www.npmjs.com/package/argon2) -- v0.44.0
- [Fastify database guide](https://fastify.dev/docs/latest/Guides/Database/) -- plugin pattern for custom DB

### Community / Cross-Referenced (MEDIUM confidence)
- [fastify-session-better-sqlite3-store npm](https://www.npmjs.com/package/fastify-session-better-sqlite3-store) -- v2.1.2, community package
- [Nunjucks npm](https://www.npmjs.com/package/nunjucks) -- v3.2.4, last published 3 years ago
- [Fastify vs Express comparison](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/)
- [Argon2 vs bcrypt comparison](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/)
- [htmx SSR best practices](https://htmx.org/essays/10-tips-for-ssr-hda-apps/)
