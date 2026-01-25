---
status: resolved
trigger: "Cron job installed via npm run install-cron shows in crontab -l but didn't execute at scheduled time"
created: 2026-01-25T07:45:00Z
resolved: 2026-01-25T08:00:00Z
---

# Debug Session: cron-not-running

## Root Causes Found

### 1. Playwright browsers not installed (FIXED by user)

The Chromium browser used by Playwright wasn't downloaded on the server. When cron ran the wrapper script, it failed silently because of `set -e`.

**Fix:** Run `npx playwright install` on the server.

### 2. CRON_TZ not supported by Ubuntu cron (KNOWN LIMITATION)

Ubuntu's Vixie cron doesn't support `CRON_TZ`. The job runs at the specified time in **system timezone (UTC)**, not Amsterdam time.

- `0 6 * * *` runs at 6:00 UTC = 7:00 AM Amsterdam (winter) / 8:00 AM Amsterdam (summer)
- To run at 6:00 AM Amsterdam, would need `0 5 * * *` in winter

**Status:** Working as-is at 6:00 UTC.

### 3. Dotenv v17 tip messages (FIXED)

Dotenv v17 shows promotional "tip" messages by default.

**Fix:**
- Added `{ debug: false }` to sync-all.js dotenv.config()
- Added `export DOTENV_CONFIG_SILENT=true` to cron-wrapper.sh

## Evidence

1. Cron logs showed job DID execute at 06:00:01 UTC:
   ```
   2026-01-25T06:00:01.688299+00:00 srv888452 CRON[1190440]: (root) CMD (flock -w 0 /home/sportlink/.cron.lock /home/sportlink/scripts/cron-wrapper.sh)
   ```

2. logs/cron directory was created (wrapper started) but empty (failed before tee)

3. npm and node are in /usr/bin (PATH is correct)

4. After `npx playwright install`, wrapper runs successfully

## Resolution

root_cause: Playwright browsers not installed on server; dotenv v17 noisy output
fix: User ran `npx playwright install`; code changes to suppress dotenv output
verification: Manual wrapper execution now works
files_changed:
  - sync-all.js (dotenv debug:false)
  - scripts/cron-wrapper.sh (DOTENV_CONFIG_SILENT)

## Remaining Issue

Login fails with "Could not find dashboard element" - this is a Sportlink login issue, not a cron issue. Separate debug session needed.

---
*Debug session resolved: 2026-01-25*
