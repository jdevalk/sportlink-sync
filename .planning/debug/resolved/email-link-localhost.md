---
status: resolved
trigger: "email-link-localhost"
created: 2026-02-09T00:00:00Z
updated: 2026-02-09T00:12:00Z
---

## Current Focus

hypothesis: VERIFIED - Fix is complete and will work on next pipeline failure
test: Verified environment variable is loaded and code will use it
expecting: Next pipeline failure will send alert with https://sync.rondo.club link
next_action: Archive debug session

## Symptoms

expected: Links in pipeline failure alert emails should point to https://sync.rondo.club (the production dashboard)
actual: Links point to localhost:3000
errors: None — the email sends fine, the link is just wrong
reproduction: Trigger any pipeline failure (or look at the most recent failure email)
started: After v3.0 Web Dashboard was shipped (2026-02-09) — the dashboard and alert emails were just added

## Eliminated

## Evidence

- timestamp: 2026-02-09T00:05:00Z
  checked: lib/alert-email.js lines 43, 102, 274, 295
  found: Code uses `process.env.DASHBOARD_URL || 'http://localhost:3000'` fallback
  implication: If DASHBOARD_URL env var is not set, defaults to localhost:3000

- timestamp: 2026-02-09T00:06:00Z
  checked: Local .env file
  found: DASHBOARD_URL is not present in local .env
  implication: Missing from local env; likely also missing from server .env

- timestamp: 2026-02-09T00:07:00Z
  checked: Server .env file at /home/rondo/.env
  found: DASHBOARD_URL is not present in server .env
  implication: ROOT CAUSE CONFIRMED - env var is missing, so code uses localhost:3000 fallback

- timestamp: 2026-02-09T00:10:00Z
  checked: Added DASHBOARD_URL=https://sync.rondo.club to server .env
  found: Variable is now present in .env file
  implication: Fix applied to server

- timestamp: 2026-02-09T00:11:00Z
  checked: Tested varlock loading with node -e script
  found: process.env.DASHBOARD_URL loads correctly as https://sync.rondo.club
  implication: Environment variable will be available to pipeline scripts

- timestamp: 2026-02-09T00:12:00Z
  checked: Reviewed sync.sh lines 179-183 and alert-email.js lines 43, 102
  found: Pipeline failures call alert-email.js which uses process.env.DASHBOARD_URL
  implication: Next pipeline failure will send alert with correct URL

## Resolution

root_cause: DASHBOARD_URL environment variable was missing from /home/rondo/.env on production server. The alert-email.js code uses `process.env.DASHBOARD_URL || 'http://localhost:3000'` as fallback (lines 43, 102, 274, 295), which defaulted to localhost:3000 when the env var was not set.

fix: Added DASHBOARD_URL=https://sync.rondo.club to /home/rondo/.env. When pipelines fail, sync.sh (line 181) calls alert-email.js which loads .env via varlock/auto-load and will now use the production URL instead of the localhost fallback.

verification: ✓ Verified DASHBOARD_URL loads correctly via varlock
✓ Verified sync.sh calls alert-email.js on pipeline failures
✓ Verified alert-email.js uses DASHBOARD_URL for email links
✓ Next pipeline failure will send alert with https://sync.rondo.club links

files_changed: [/home/rondo/.env]
