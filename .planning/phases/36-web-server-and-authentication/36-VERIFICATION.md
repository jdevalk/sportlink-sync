---
phase: 36-web-server-and-authentication
verified: 2026-02-09T17:30:00Z
status: human_needed
score: 8/8 must-haves verified (automated checks passed)
human_verification:
  - test: "Login with valid credentials and verify session persistence"
    expected: "User logs in, sees dashboard, and session persists across browser refreshes"
    why_human: "Browser-based authentication flow requires real user interaction"
  - test: "Verify HTTPS certificate is valid"
    expected: "Browser shows lock icon, no certificate warnings"
    why_human: "TLS certificate validation requires live browser check"
  - test: "Verify systemd crash recovery"
    expected: "After killing the process, systemd restarts it within 10-15 seconds"
    why_human: "Service management requires server access and process monitoring"
---

# Phase 36: Web Server and Authentication Verification Report

**Phase Goal:** An authenticated web server is running on the production server, accessible via HTTPS, managed by systemd

**Verified:** 2026-02-09T17:30:00Z
**Status:** human_needed (all automated checks passed, awaiting human verification)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fastify server starts on localhost:3000, serves login page at /login | ✓ VERIFIED | lib/web-server.js:75-82 defines GET /login route, returns login.ejs template |
| 2 | Unauthenticated requests to / redirect to /login | ✓ VERIFIED | lib/web-server.js:103 uses requireAuth preHandler; lib/auth.js:10-14 redirects if !session.user |
| 3 | Valid credentials (from users.json) create session, redirect to / | ✓ VERIFIED | lib/auth.js:22-70 loginHandler verifies with Argon2, regenerates session, sets session.user, redirects |
| 4 | Invalid credentials show generic error on login page | ✓ VERIFIED | lib/auth.js:41-57 returns 401 with "Invalid username or password" for both invalid username and password |
| 5 | Session persists across requests (cookie-based, SQLite-backed) | ✓ VERIFIED | lib/web-server.js:39-52 configures @fastify/session with SqliteStore, 7-day maxAge |
| 6 | Logout destroys session and redirects to /login | ✓ VERIFIED | lib/auth.js:78-82 calls session.destroy() and redirects to /login |
| 7 | Login endpoint is rate-limited (5/min per IP) | ✓ VERIFIED | lib/web-server.js:85-92 POST /login has rateLimit config max:5, timeWindow:'1 minute' |
| 8 | hash-password.js utility generates Argon2id hashes | ✓ VERIFIED | scripts/hash-password.js:16 uses argon2.hash() with default Argon2id settings |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/web-server.js` | Fastify server setup, plugin registration, route definitions, listen | ✓ VERIFIED | 156 lines, exports buildServer(), registers all plugins, defines 5 routes, module/CLI hybrid |
| `lib/auth.js` | requireAuth preHandler hook, login/logout handlers | ✓ VERIFIED | 88 lines, exports requireAuth/loginHandler/logoutHandler, uses argon2.verify, session.regenerate |
| `lib/user-config.js` | Load and validate users.json config file | ✓ VERIFIED | 82 lines, exports loadUsers(), validates username/passwordHash/displayName, checks Argon2id format |
| `views/login.ejs` | Minimal login form with error display | ✓ VERIFIED | 20 lines, contains form method="POST", username/password inputs, error conditional display |
| `scripts/hash-password.js` | CLI utility to hash passwords for users.json | ✓ VERIFIED | 24 lines, reads password from argv[2], uses argon2.hash(), prints hash |
| `systemd/rondo-sync-web.service` | Systemd unit file for non-root web server | ⚠️ VERIFIED (deviation) | 28 lines, contains User=sportlink in repo (deployed as root per 36-02-SUMMARY deviation) |
| `nginx/sync.rondo.club.conf` | Nginx reverse proxy config with TLS placeholders | ✓ VERIFIED | 23 lines, contains proxy_pass http://127.0.0.1:3000, X-Forwarded-For headers |
| `config/users.example.json` | Example user config (committed to git) | ✓ VERIFIED | 8 lines, contains username/passwordHash/displayName structure, placeholder Argon2id hash |

**All artifacts:** 8/8 verified (1 with known deviation documented in SUMMARY)

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| lib/web-server.js | lib/auth.js | imports requireAuth, loginHandler, logoutHandler | ✓ WIRED | Line 8: const { requireAuth, loginHandler, logoutHandler } = require('./auth') |
| lib/auth.js | lib/user-config.js | imports loadUsers for credential verification | ✓ WIRED | Line 2: const { loadUsers } = require('./user-config'); Line 33: users = loadUsers() |
| lib/web-server.js | @fastify/session | plugin registration with SQLite store | ✓ WIRED | Line 43: app.register(require('@fastify/session'), {...store: new SqliteStore(sessionDb)}) |
| lib/auth.js | argon2 | password verification | ✓ WIRED | Line 1: const argon2 = require('argon2'); Line 49: await argon2.verify() |
| requireAuth hook | protected routes | preHandler: requireAuth on / and /logout | ✓ WIRED | web-server.js:95,103 use preHandler: requireAuth; auth.js:11-13 redirects unauthenticated |
| loginHandler | session creation | regenerate + set session.user | ✓ WIRED | auth.js:60-66 calls session.regenerate() then sets session.user object |
| config/users.json | .gitignore | excluded from git | ✓ WIRED | .gitignore:20 contains "config/users.json" |

**All links:** 7/7 verified and wired

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **AUTH-01**: Users log in with individual username and password | ✓ SATISFIED | loginHandler (auth.js:22-70) validates username/password from users.json |
| **AUTH-02**: Passwords are hashed with Argon2id | ✓ SATISFIED | user-config.js:47-51 validates $argon2id$ prefix; auth.js:49 uses argon2.verify |
| **AUTH-03**: Sessions persist across browser refresh via secure cookies | ✓ SATISFIED | web-server.js:43-52 configures session with 7-day maxAge, httpOnly, secure in prod |
| **AUTH-04**: All dashboard routes require authentication (no public pages except login) | ✓ SATISFIED | Only /login, /health are public; / uses requireAuth preHandler (web-server.js:103) |
| **AUTH-05**: CLI tool exists to create/manage user accounts | ✓ SATISFIED | scripts/hash-password.js generates hashes; users managed via users.json file |
| **WEB-01**: Fastify web server serves the dashboard on the production server | ✓ SATISFIED | lib/web-server.js exports buildServer(); 36-02-SUMMARY confirms service running |
| **WEB-02**: Nginx reverse proxy handles TLS termination | ✓ SATISFIED | nginx/sync.rondo.club.conf proxies to 127.0.0.1:3000; 36-02-SUMMARY confirms certbot TLS |
| **WEB-03**: Web server managed by systemd with automatic restart on crash | ✓ SATISFIED | systemd/rondo-sync-web.service has Restart=on-failure, RestartSec=10; 36-02-SUMMARY verifies SIGKILL recovery |
| **WEB-04**: Web server binds to localhost only (not exposed directly) | ✓ SATISFIED | web-server.js:142 defaults to HOST='127.0.0.1'; nginx proxies publicly |
| **INFRA-04**: Web server runs as non-root user with minimal permissions | ⚠️ PARTIAL | Systemd service in repo specifies User=sportlink, but 36-02-SUMMARY documents deviation: deployed as root due to no sportlink user on server |

**Requirements:** 9/10 fully satisfied, 1/10 partial (INFRA-04 deferred)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| lib/web-server.js | 102 | Comment: "placeholder for Phase 37" | ℹ️ Info | Dashboard route intentionally minimal; Phase 37 will add UI |
| systemd/rondo-sync-web.service | 7 | User=sportlink (but deployed as root) | ⚠️ Warning | Security hardening incomplete; documented deviation in 36-02-SUMMARY |

**Blockers:** 0
**Warnings:** 1 (known deviation, documented)
**Info:** 1 (intentional placeholder)

### Human Verification Required

#### 1. Login Flow and Session Persistence

**Test:** 
1. Open https://sync.rondo.club in a browser
2. Verify HTTPS with valid certificate (lock icon)
3. Log in with valid credentials
4. Verify dashboard displays with user's display name
5. Refresh the page — verify still logged in
6. Open new tab to https://sync.rondo.club — verify still logged in
7. Click "Logout" — verify redirected to /login
8. Try accessing https://sync.rondo.club/ directly — verify redirected to /login

**Expected:** All authentication flows work correctly, session persists across refreshes and tabs, logout destroys session

**Why human:** Browser-based authentication flow requires real user interaction and visual verification of UI states

#### 2. Invalid Credentials Handling

**Test:**
1. Navigate to https://sync.rondo.club/login
2. Enter incorrect username and password
3. Verify error message "Invalid username or password" appears
4. Enter correct username but wrong password
5. Verify same generic error message (doesn't reveal username validity)

**Expected:** Generic error message for both invalid username and invalid password

**Why human:** Error message display and security behavior requires visual verification

#### 3. Systemd Crash Recovery

**Test:**
1. SSH to root@46.202.155.16
2. Run: `systemctl status rondo-sync-web.service` — verify active
3. Run: `systemctl kill rondo-sync-web.service` (sends SIGKILL)
4. Wait 15 seconds
5. Run: `systemctl status rondo-sync-web.service` — verify active again
6. Check logs: `journalctl -u rondo-sync-web -n 20` — verify restart logged

**Expected:** Service restarts automatically within 10-15 seconds after crash (RestartSec=10)

**Why human:** Service management and process monitoring requires server access and timing verification

---

## Summary

**All automated verification checks passed.** The Phase 36 goal is structurally achieved:

✓ **Code artifacts:** All 8 required files exist and are substantive (no stubs)
✓ **Wiring:** All 7 critical links verified (imports, plugin registration, session management)
✓ **Authentication logic:** Argon2id verification, session fixation prevention, rate limiting all implemented
✓ **Requirements:** 9/10 requirements satisfied, 1 partial (INFRA-04 documented deviation)

**Known deviation:** Systemd service runs as root instead of sportlink user (no sportlink user exists on server). This is a known trade-off documented in 36-02-SUMMARY. Security hardening (NoNewPrivileges, PrivateTmp) is still active.

**Human verification required:** The production web server at https://sync.rondo.club needs browser-based testing to confirm:
1. HTTPS login flow works end-to-end
2. Session persistence across refreshes
3. Systemd crash recovery functions correctly

Once human verification completes, Phase 36 can be marked as **passed** (or gaps identified if any issues found).

---

_Verified: 2026-02-09T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
