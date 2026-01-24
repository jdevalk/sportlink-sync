# Sportlink Sync

## What This Is

A CLI tool that synchronizes member data from Sportlink Club (a Dutch sports club management system) to Laposta email marketing lists. It downloads member data via browser automation, transforms it according to field mappings, syncs changes to up to 4 Laposta lists, and runs automatically on a daily schedule with email reports.

## Core Value

Keep Laposta email lists automatically in sync with Sportlink member data without manual intervention.

## Current State (v1.0 Shipped)

**Shipped:** 2026-01-24

The sync pipeline is fully operational with:
- Browser automation downloads member data from Sportlink
- Field transformation and hash-based change detection
- Sync to up to 4 Laposta lists with state tracking
- Clean summary output suitable for email delivery
- Automated daily cron job at 6:00 AM Amsterdam time
- Email reports sent after each sync
- Retry mechanism at 8:00 AM on failure

**To deploy:**
```bash
npm run install-cron  # Prompts for operator email, sets up cron
```

## Requirements

### Validated

- ✓ Download member data from Sportlink via browser automation with OTP — existing
- ✓ Transform Sportlink fields to Laposta format via configurable mapping — existing
- ✓ Sync members to up to 4 Laposta lists — existing
- ✓ Track sync state in SQLite to only submit changed members — existing
- ✓ Support parent/child member associations — existing
- ✓ Deduplicate parent entries across lists — existing
- ✓ Inspect pending changes before sync — existing
- ✓ Cronjob setup for scheduled automated sync — v1.0
- ✓ Reduced/formatted output suitable for email reports — v1.0

### Active

(None - define in next milestone)

### Out of Scope

- Web UI — CLI tool is sufficient for operator use
- Real-time sync — scheduled batch sync is appropriate for member data
- Bidirectional sync — Laposta is downstream only, Sportlink is source of truth
- Slack/Discord notifications — Cron MAILTO is sufficient for now

## Context

**Codebase:**
- 2,419 lines of JavaScript + shell
- Node.js with Playwright for browser automation
- SQLite for state tracking
- Shell scripts for cron automation

**Tech stack:** Node.js 18+, Playwright/Chromium, SQLite, Bash

**Server requirements:**
- Chromium (downloaded by Playwright) for Sportlink scraping
- Network access to club.sportlink.com and api.laposta.nl
- `mail` command for email delivery
- Credentials in `.env` file

## Constraints

- **Runtime**: Node.js 18+ with Playwright browser automation
- **Dependencies**: Requires Chromium for Sportlink scraping
- **Network**: Needs access to club.sportlink.com and api.laposta.nl
- **Credentials**: Sportlink username/password/OTP secret and Laposta API key in `.env`
- **Email**: Requires `mail` command for cron email delivery

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Browser automation for Sportlink | No API available, must scrape web interface | ✓ Good |
| SQLite for state tracking | Simple, no external database needed, portable | ✓ Good |
| Hash-based change detection | Avoids timestamp issues, reliable diff detection | ✓ Good |
| Dual-stream logger (stdout + file) | Simple logging, email-ready output | ✓ Good |
| Module/CLI hybrid pattern | Scripts work standalone and as imports | ✓ Good |
| Plain text summary format | Clean in email clients, no ANSI codes | ✓ Good |
| Cron timezone Europe/Amsterdam | Club operates in Amsterdam timezone | ✓ Good |
| Email in wrapper vs MAILTO | Enables custom subject lines | ✓ Good |
| flock-based locking | Prevents overlapping sync executions | ✓ Good |

---
*Last updated: 2026-01-24 after v1.0 milestone*
