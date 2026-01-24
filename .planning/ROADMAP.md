# Roadmap: Sportlink Sync

## Overview

This roadmap enhances an existing sync pipeline with automation-ready output and scheduled execution. Phase 1 converts verbose console output into concise summaries suitable for email reports. Phase 2 configures cron to run daily syncs with automated email delivery.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Summary Output** - Create concise sync report format
- [x] **Phase 2: Cron Automation** - Schedule daily sync with email reports

## Phase Details

### Phase 1: Summary Output
**Goal**: Sync produces clean, concise output suitable for email delivery
**Depends on**: Nothing (first phase)
**Requirements**: OUT-01, OUT-02, OUT-03
**Success Criteria** (what must be TRUE):
  1. Running `npm run sync-all` produces a summary (not verbose progress messages)
  2. Summary includes sync timestamp, members processed per list, and any errors
  3. Output is clean enough to be readable in an email (no debug noise or excessive logging)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Logger infrastructure and script modularization
- [x] 01-02-PLAN.md — Summary orchestrator with email-ready output

### Phase 2: Cron Automation
**Goal**: Daily sync runs automatically with email reports on completion
**Depends on**: Phase 1
**Requirements**: AUTO-01, AUTO-02
**Success Criteria** (what must be TRUE):
  1. Crontab entry exists that runs `npm run sync-all` daily
  2. MAILTO is configured to send cron output to operator email
  3. Sync runs automatically without manual intervention
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — Cron wrapper and install scripts

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Summary Output | 2/2 | Complete | 2026-01-24 |
| 2. Cron Automation | 1/1 | Complete | 2026-01-24 |

---
*Roadmap created: 2026-01-24*
*Last updated: 2026-01-24 (Milestone v1 complete)*
