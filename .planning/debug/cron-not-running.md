---
status: resolved
trigger: "Cron job installed via npm run install-cron shows in crontab -l but didn't execute at scheduled time"
created: 2026-01-25T07:45:00Z
resolved: 2026-01-25T09:15:00Z
---

# Debug Session: cron-not-running

## Root Causes Found

### 1. Playwright browsers not installed (FIXED)

The Chromium browser used by Playwright wasn't downloaded on the server. When cron ran the wrapper script, it failed silently because of `set -e`.

**Fix:** Run `npx playwright install` on the server.

### 2. CRON_TZ not supported by Ubuntu cron (KNOWN LIMITATION)

Ubuntu's Vixie cron doesn't support `CRON_TZ`. The job runs at the specified time in **system timezone (UTC)**, not Amsterdam time.

- `0 6 * * *` runs at 6:00 UTC = 7:00 AM Amsterdam (winter) / 8:00 AM Amsterdam (summer)
- To run at 6:00 AM Amsterdam, would need `0 5 * * *` in winter

**Status:** Accepted - runs at 6:00 UTC.

### 3. Dotenv v17 promotional spam (FIXED)

Dotenv v17 added promotional "tip" messages that cannot be suppressed.

**Fix:** Switched from dotenv to varlock (`require('varlock/auto-load')`).

### 4. Login failure (TRANSIENT)

Initial test showed "Could not find dashboard element" error. This was transient - subsequent runs worked correctly.

### 5. Email lands in spam (TODO)

Cron emails sent via `mail` command land in spam due to lack of SPF/DKIM.

**Status:** Todo created to switch to Postmark.

## Evidence

1. Cron logs showed job DID execute at 06:00:01 UTC
2. logs/cron directory created but empty (wrapper failed before tee due to missing Playwright)
3. npm and node in /usr/bin (PATH correct)
4. After `npx playwright install`, sync runs successfully
5. Manual cron-wrapper.sh test confirmed working
6. Second sync run showed 0 members needing sync (change detection working)

## Resolution

**Root causes:**
- Playwright browsers not installed
- dotenv v17 spam

**Fixes applied:**
- User ran `npx playwright install`
- Switched from dotenv to varlock

**Verification:**
- Manual `cron-wrapper.sh` execution successful
- Email received (in spam - separate todo)
- Back-to-back sync confirmed change detection works

**Files changed:**
- package.json (dotenv → varlock)
- All JS files (require('dotenv').config() → require('varlock/auto-load'))

---
*Debug session resolved: 2026-01-25*
