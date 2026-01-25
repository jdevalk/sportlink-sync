# Roadmap: Sportlink Sync v1.2

**Milestone:** Email Improvements
**Created:** 2026-01-25
**Phases:** 1 (continues from v1.1 which ended at Phase 3)

## Overview

Polish email reports with HTML formatting, proper sender name, and cleaner output. Also fix cron installer to overwrite existing entries.

---

## Phase 4: Email Polish ✓

**Goal:** Sync report emails are well-formatted HTML with proper sender identity and no noise.

**Dependencies:** None (builds on v1.1 Postmark infrastructure)

**Plans:** 2 plans

Plans:
- [x] 04-01-PLAN.md - HTML email formatting with from name
- [x] 04-02-PLAN.md - Clean output and cron overwrite fix

**Requirements:**
- EMAIL-06: Sync reports are sent as HTML email with proper formatting
- EMAIL-07: Email from name displays as "Sportlink SYNC"
- EMAIL-08: Email body does not include npm script execution header
- INST-01: Running install-cron replaces existing sportlink-sync cron entries

**Success Criteria:**
1. Running sync and sending email shows "Sportlink SYNC" as sender name in inbox
2. Email body is formatted HTML with tables/sections (not plain text dump)
3. Email does not contain "> sportlink-downloader@0.1.0 sync-all" npm header
4. Running install-cron twice results in exactly 2 cron entries (not 4)

---

## Progress

| Phase | Status | Requirements |
|-------|--------|--------------|
| 4 - Email Polish | ✓ Complete | 4/4 |

**Total v1.2 Requirements:** 4
**Mapped:** 4
**Coverage:** 100%

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-25 (Phase 4 complete)*
