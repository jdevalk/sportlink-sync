# Roadmap: Sportlink Sync v1.1

**Milestone:** Postmark Email Delivery
**Created:** 2026-01-25
**Phases:** 1 (continues from v1.0 which ended at Phase 2)

## Overview

Replace unreliable local `mail` command with Postmark transactional email for sync reports. Single phase delivers complete email functionality and integrates it into existing cron automation.

---

## Phase 3: Postmark Email Delivery

**Goal:** Sync reports are delivered reliably via Postmark instead of local mail command.

**Dependencies:** None (builds on v1.0 infrastructure)

**Requirements:**
- EMAIL-01: System sends sync report via Postmark API after each sync
- EMAIL-02: Postmark API key configured via POSTMARK_API_KEY env var
- EMAIL-03: Sender email configured via POSTMARK_FROM_EMAIL env var
- EMAIL-04: Recipient email configured via existing OPERATOR_EMAIL env var
- EMAIL-05: Email failure is logged but does not fail the sync
- INTG-01: cron-wrapper.sh calls Node.js script for email instead of `mail` command
- INTG-02: install-cron.sh prompts for Postmark credentials during setup

**Success Criteria:**
1. Running `npm run sync` followed by email script sends report to OPERATOR_EMAIL via Postmark
2. Missing or invalid POSTMARK_API_KEY logs error but sync completes successfully
3. `npm run install-cron` prompts for Postmark API key and sender email, stores in .env
4. After cron runs, operator receives email with sync summary (not in spam folder)

---

## Progress

| Phase | Status | Requirements |
|-------|--------|--------------|
| 3 - Postmark Email | Pending | 7/7 |

**Total v1.1 Requirements:** 7
**Mapped:** 7
**Coverage:** 100%

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-25*
