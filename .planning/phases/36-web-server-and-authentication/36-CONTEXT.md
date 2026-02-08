# Phase 36: Web Server and Authentication - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Authenticated Fastify web server accessible via HTTPS at sync.rondo.club, managed by systemd. Provides login/session infrastructure for the dashboard UI (Phase 37). Does NOT include dashboard pages, views, or data display — only the server, authentication, and deployment infrastructure.

</domain>

<decisions>
## Implementation Decisions

### User management
- 2-5 operators (board members, committee leads)
- Users defined in a JSON config file on the server (no admin UI, no CLI tool)
- All users have equal access — no role distinctions
- Config file lives on the server alongside .env

### Session behavior
- Unlimited concurrent sessions per user (multi-device, no restrictions)

### Login experience
- Minimal and clean login page — centered form with username, password, submit
- No club branding, logos, or colors — just functional
- After successful login, redirect to pipeline overview page (/)
- Generic error on failed login: "Invalid username or password" — don't reveal which was wrong

### Server access model
- Dashboard accessible from the public internet — authentication is the only gate
- Domain: sync.rondo.club (subdomain, needs DNS + nginx + TLS)
- Basic rate limiting on login endpoint (e.g., 5 attempts per minute per IP)

### Claude's Discretion
- Password storage approach (plain-in-config vs pre-hashed, hashing algorithm)
- Session store implementation (SQLite vs in-memory)
- Session duration and remember-me behavior
- Logout button placement and behavior
- TLS certificate approach (Let's Encrypt vs other)
- Exact rate limiting implementation

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Keep it simple and functional.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 36-web-server-and-authentication*
*Context gathered: 2026-02-08*
