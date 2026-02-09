---
created: 2026-02-09T09:34
title: Create dedicated service user for web server
area: infra
files:
  - systemd/rondo-sync-web.service
  - .planning/phases/36-web-server-and-authentication/36-02-SUMMARY.md
---

## Problem

The rondo-sync-web systemd service runs as root on the production server (46.202.155.16) because no dedicated `sportlink` user exists. All existing files and cron jobs also run as root. This is a security concern — the web server process has full root access and can read all credentials (Sportlink, Laposta, etc.) even though it only needs SESSION_SECRET and config/users.json.

This was flagged during Phase 36 deployment as a known deviation from INFRA-04 ("web server runs as non-root user with minimal permissions").

## Solution

1. Create a `sportlink` system user on the server
2. Set appropriate ownership on `/home/sportlink` files (web server needs read access to code, write to `data/`)
3. Update systemd unit to `User=sportlink`
4. Restrict `.env` so only root can read it (cron runs as root, web server doesn't need API creds)
5. Create a separate `.env.web` with only SESSION_SECRET for the web server, or use systemd `Environment=` directives
6. Re-enable NoNewPrivileges and PrivateTmp hardening flags
7. Verify cron pipelines still work after ownership changes
