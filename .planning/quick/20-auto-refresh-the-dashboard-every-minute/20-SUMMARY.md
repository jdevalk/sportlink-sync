---
phase: quick-20
plan: 01
subsystem: web-dashboard
tags:
  - dashboard
  - ui-improvement
  - auto-refresh
dependency_graph:
  requires: []
  provides:
    - auto-refresh-dashboard
  affects:
    - views/partials/head.ejs
tech_stack:
  added: []
  patterns:
    - meta-refresh-tag
key_files:
  created: []
  modified:
    - views/partials/head.ejs
decisions: []
metrics:
  duration: 25
  completed_date: 2026-02-09
---

# Quick Task 20: Auto-refresh the dashboard every minute

**One-liner:** Meta refresh tag (60s) added to dashboard pages for automatic updates without manual browser refresh.

## What Changed

Added `<meta http-equiv="refresh" content="60">` to `views/partials/head.ejs` (line 6), causing all authenticated dashboard pages (overview, pipeline history, run detail, errors, error detail) to automatically reload every 60 seconds.

The login page is unaffected because it uses standalone HTML and does not include the `head.ejs` partial.

## Why This Approach

- **Simple and reliable**: Meta refresh is browser-native, works even if JavaScript fails
- **No state loss**: Dashboard pages have no interactive forms or unsaved state that would be lost on refresh
- **Targeted**: Only dashboard pages refresh; login page excluded by design
- **Monitoring-friendly**: Auto-refresh keeps pipeline run status current for users watching active syncs

## Implementation Details

### Modified Files

**views/partials/head.ejs** (1 line added)
- Added meta refresh tag after viewport meta tag
- Applies to all dashboard pages via shared partial

### Verification

✅ `views/partials/head.ejs` contains `<meta http-equiv="refresh" content="60">` on line 6
✅ `views/login.ejs` does NOT contain any refresh meta tag
✅ No other files modified

## Deviations from Plan

None - plan executed exactly as written.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 759ebad | Add auto-refresh to dashboard pages |

## Testing Notes

To verify on production:
1. SSH to `root@46.202.155.16`
2. `cd /home/rondo && git pull`
3. `systemctl restart rondo-sync-web`
4. Visit dashboard, check page source for meta refresh tag
5. Observe automatic page reload after 60 seconds

## Self-Check: PASSED

✅ File modified: `views/partials/head.ejs` exists with meta refresh tag
✅ Commit exists: `759ebad`
✅ Login page unaffected: No refresh tag in `views/login.ejs`
