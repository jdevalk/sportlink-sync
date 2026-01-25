---
created: 2026-01-25T12:15
title: install-cron should overwrite existing crons
area: automation
files:
  - scripts/install-cron.sh:76-83
---

## Problem

Running `npm run install-cron` multiple times adds duplicate cron entries instead of replacing existing ones. The current implementation appends new entries without checking for or removing previous sportlink-sync cron jobs.

This leads to multiple sync attempts at the same time if the user re-runs the installer (e.g., after changing credentials).

## Solution

Before adding new cron entries, remove any existing sportlink-sync entries:

1. Filter out existing sportlink-sync lines from crontab
2. Then append the new entries

Something like:
```bash
(crontab -l 2>/dev/null | grep -v "sportlink-sync" || true; echo "$CRON_ENTRIES") | crontab -
```

Or use a marker comment to identify managed entries and replace the block.
