---
phase: 36-web-server-and-authentication
plan: 02
subsystem: infra
tags: [nginx, certbot, systemd, tls, deployment, dns]

# Dependency graph
requires:
  - phase: 36-web-server-and-authentication
    provides: "Fastify web server, auth module, systemd/nginx config files"
provides:
  - "Production web server running at https://sync.rondo.club"
  - "TLS certificate via Let's Encrypt with auto-renewal"
  - "Systemd service with crash recovery"
  - "Nginx reverse proxy with HTTPS"
  - "Production user account configured"
affects: [37-dashboard-ui, 38-email-migration]

# Tech tracking
tech-stack:
  added: [nginx, certbot]
  patterns:
    - "Systemd service runs as root (no sportlink user on server)"
    - "Cloudflare DNS proxy in front of nginx"
    - "varlock loads .env from WorkingDirectory for session secret"

key-files:
  created: []
  modified:
    - /etc/systemd/system/rondo-sync-web.service
    - /etc/nginx/sites-enabled/sync.rondo.club.conf
    - /home/sportlink/config/users.json
    - /home/sportlink/.env

key-decisions:
  - "Run systemd service as root (no sportlink user exists on server)"
  - "Cloudflare DNS proxy accepted (resolves to CF IPs, not direct server IP)"
  - "SESSION_SECRET generated with openssl rand -base64 32"

patterns-established:
  - "Server deployment: git push, ssh pull, npm install, systemctl restart"

# Metrics
duration: 5min
completed: 2026-02-09
---

# Phase 36 Plan 02: Server Deployment Summary

**Production web server deployed at https://sync.rondo.club with nginx TLS termination, systemd crash recovery, and verified browser login flow**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T09:28:00Z
- **Completed:** 2026-02-09T09:33:40Z
- **Tasks:** 3 (1 human-action, 1 auto, 1 human-verify)
- **Files modified:** 4 (server-side only)

## Accomplishments
- DNS A record created for sync.rondo.club (via Cloudflare proxy)
- nginx installed, configured as reverse proxy, TLS certificate obtained via certbot
- Systemd service enabled with automatic crash recovery (verified with SIGKILL test)
- Production user account created with Argon2id-hashed password
- Full HTTPS login flow verified in browser: login, session persistence, logout, auth redirect

## Task Commits

Server-side deployment — no git commits for this plan (all changes are on the production server, not in the repository).

## Files Created/Modified
- `/etc/systemd/system/rondo-sync-web.service` - Systemd unit (adjusted: runs as root, no sportlink user)
- `/etc/nginx/sites-enabled/sync.rondo.club.conf` - Nginx reverse proxy with TLS (certbot-managed)
- `/home/sportlink/config/users.json` - Production user credentials (600 permissions)
- `/home/sportlink/.env` - Added SESSION_SECRET

## Decisions Made
- **Run as root:** Server has no `sportlink` user — all existing files and cron jobs run as root. Adjusted systemd service accordingly. Creating a dedicated user is a future hardening step.
- **Cloudflare DNS proxy:** DNS resolves to Cloudflare IPs rather than direct server IP. This is expected — Cloudflare proxies to origin.
- **SESSION_SECRET in .env:** Generated with `openssl rand -base64 32`, loaded by varlock at server startup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed SESSION_SECRET concatenation in .env**
- **Found during:** Task 2 (Deploy web server)
- **Issue:** `echo >>` appended without newline, concatenating SESSION_SECRET with previous line
- **Fix:** Used `sed` to insert newline before SESSION_SECRET
- **Verification:** Service started successfully after fix

**2. [Rule 3 - Blocking] Adjusted systemd service for root user**
- **Found during:** Task 2 (Deploy web server)
- **Issue:** Plan specified `User=sportlink` but no sportlink user exists on server
- **Fix:** Changed to `User=root` in the installed systemd unit file
- **Verification:** Service starts and runs correctly

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for service to start. No scope creep.

## Issues Encountered
- .env file lacked trailing newline, causing SESSION_SECRET to merge with previous variable. Fixed with sed.
- No `sportlink` user on server. Systemd service adjusted to run as root.

## User Setup Required

None - deployment is complete and verified.

## Next Phase Readiness
- Web server running and accessible at https://sync.rondo.club
- Authentication working with session persistence
- Ready for Phase 37 (Dashboard UI) to add actual dashboard pages
- No blockers

---
*Phase: 36-web-server-and-authentication*
*Completed: 2026-02-09*
