# Roadmap: Sportlink Sync v2.0 Bidirectional Sync

## Overview

v2.0 adds bidirectional sync capability to enable corrections made in Stadion to flow back to Sportlink via browser automation. The roadmap implements loop prevention and conflict resolution infrastructure before enabling reverse sync, starting with low-risk contact fields and expanding to free fields and financial toggles. All reverse sync operations are audited and reported via email.

## Milestones

- ✅ **v1.0 MVP** - Phases 1-4 (shipped 2024)
- ✅ **v1.1 Email Reports** - Phases 5-7 (shipped 2024)
- ✅ **v1.2 Cron Refinements** - Phases 8-10 (shipped 2024)
- ✅ **v1.3 Stadion WordPress Sync** - Phases 11-13 (shipped 2024)
- ✅ **v1.4 Photo Sync** - Phases 14-16 (shipped 2025)
- ✅ **v1.5 Team Sync** - Phases 17-18 (shipped 2025)
- ✅ **v1.7 Photo API Optimization** - Phase 19 (shipped 2026-01-28)
- 🔧 **v2.0 Bidirectional Sync** - Phases 20-26 (gap closure in progress)

## Phases

<details>
<summary>✅ v1.0-v1.7 (Phases 1-19) - SHIPPED</summary>

Previous milestones completed. See git history for phase details.

</details>

### 🔧 v2.0 Bidirectional Sync (Gap Closure)

**Milestone Goal:** Enable pushing corrections made in Stadion back to Sportlink via browser automation, with last-edit-wins conflict resolution.

#### Phase 20: Foundation (Database & Origin Tracking)

**Goal**: Database schema supports bidirectional timestamp tracking and origin attribution to prevent infinite sync loops

**Depends on**: Phase 19

**Requirements**: FOUND-01, FOUND-02, FOUND-03

**Success Criteria** (what must be TRUE):
  1. SQLite schema includes forward and reverse modification timestamps per field
  2. All sync operations record origin (user-edit vs sync-initiated)
  3. Timestamp comparison operations normalize all times to UTC before comparison
  4. Migration script successfully adds columns to existing stadion-sync.sqlite without data loss

**Plans:** 1 plan

Plans:
- [x] 20-01-PLAN.md — Add per-field timestamp columns and sync-origin utilities

#### Phase 21: Conflict Resolution Infrastructure

**Goal**: System detects conflicts and resolves them using last-edit-wins logic at field level

**Depends on**: Phase 20

**Requirements**: CONF-01, CONF-02, CONF-03

**Success Criteria** (what must be TRUE):
  1. Conflict resolver compares timestamps to determine which edit is newer
  2. Conflicts detected and resolved at individual field level, not whole record
  3. Operator receives email notification when conflicts are detected with details of resolution
  4. Grace period tolerates minor clock drift between systems

**Plans:** 1 plan

Plans:
- [x] 21-01-PLAN.md — Conflict detection and resolution module with audit trail

#### Phase 22: Stadion Change Detection

**Goal**: System identifies which Stadion members have modifications newer than Sportlink for reverse sync

**Depends on**: Phase 21

**Requirements**: RSYNC-01, INTEG-01

**Success Criteria** (what must be TRUE):
  1. System queries Stadion REST API for members with modified_gmt timestamps
  2. Timestamp comparison identifies members with Stadion changes newer than last forward sync
  3. Hash-based change detection confirms actual field changes (not just modification time)
  4. All detected changes logged with timestamps and field values for audit trail

**Plans:** 2 plans

Plans:
- [x] 22-01-PLAN.md — Stadion change detection script with audit table and hash comparison
- [x] 22-02-PLAN.md — Fix field-level comparison (gap closure)

#### Phase 23: Contact Fields Reverse Sync

**Goal**: Contact field corrections (email, email2, mobile, phone) sync from Stadion to Sportlink via browser automation

**Depends on**: Phase 22

**Requirements**: RSYNC-02

**Success Criteria** (what must be TRUE):
  1. System navigates to Sportlink /general page and enters edit mode
  2. Contact fields (email, email2, mobile, phone) update in Sportlink with values from Stadion
  3. Form submission verified by reading back saved values from Sportlink
  4. Failed submissions retry with exponential backoff up to 3 attempts
  5. Successful reverse sync updates forward_modified timestamp to prevent re-sync

**Plans:** 2 plans

Plans:
- [x] 23-01-PLAN.md — Core reverse sync module with Playwright automation
- [x] 23-02-PLAN.md — Pipeline integration and email reporting

#### Phase 24: Free Fields & Financial Toggle Reverse Sync

**Goal**: All remaining target fields (datum-vog, freescout-id, financial block) sync from Stadion to Sportlink with full observability

**Depends on**: Phase 23

**Requirements**: RSYNC-03, RSYNC-04, INTEG-02, INTEG-03

**Success Criteria** (what must be TRUE):
  1. System syncs datum-vog and freescout-id from Stadion to Sportlink /other page
  2. System syncs financiele-blokkade toggle from Stadion to Sportlink /financial page
  3. Multi-page navigation maintains session state across /general, /other, and /financial pages
  4. Email reports include reverse sync statistics (members updated, fields changed, conflicts resolved)
  5. Reverse sync runs on separate cron schedule every 15 minutes via scripts/sync.sh reverse
  6. Graceful degradation on failures (forward sync not blocked by reverse sync issues)

**Plans:** 2 plans

Plans:
- [x] 24-01-PLAN.md — Multi-page reverse sync core with session timeout detection
- [x] 24-02-PLAN.md — CLI entry point and 15-minute cron integration

#### Phase 25: Wire Change Detection to Reverse Sync (Gap Closure)

**Goal**: Connect orphaned change detection infrastructure to reverse sync pipeline so Stadion edits flow through to Sportlink

**Depends on**: Phase 24

**Requirements**: RSYNC-01, INTEG-01, INTEG-02

**Gap Closure**: Closes integration gap from v2.0-MILESTONE-AUDIT.md

**Success Criteria** (what must be TRUE):
  1. reverse-sync.js calls detectChanges() before runReverseSyncMultiPage()
  2. stadion_change_detections table populates with real data when Stadion members are modified
  3. E2E flow works: Stadion edit → change detected → reverse sync → Sportlink updated
  4. Email reports show actual reverse sync statistics (non-zero when changes exist)

**Plans:** 0 plans (pending)

#### Phase 26: Wire Conflict Resolution to Forward Sync (Gap Closure)

**Goal**: Connect orphaned conflict resolution infrastructure to forward sync so bidirectional conflicts are detected and resolved

**Depends on**: Phase 25

**Requirements**: CONF-03

**Gap Closure**: Closes integration gap from v2.0-MILESTONE-AUDIT.md

**Success Criteria** (what must be TRUE):
  1. submit-stadion-sync.js calls resolveFieldConflicts() before updating Stadion
  2. Conflicts are detected when both systems have modifications to same field
  3. Last-edit-wins is applied based on timestamp comparison
  4. Conflict resolutions logged to audit table and included in email reports

**Plans:** 0 plans (pending)

## Progress

**Execution Order:**
Phases execute in numeric order: 20 → 21 → 22 → 23 → 24 → 25 → 26

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 20. Foundation | v2.0 | 1/1 | ✅ Complete | 2026-01-29 |
| 21. Conflict Resolution | v2.0 | 1/1 | ✅ Complete | 2026-01-29 |
| 22. Change Detection | v2.0 | 2/2 | ✅ Complete | 2026-01-29 |
| 23. Contact Fields | v2.0 | 2/2 | ✅ Complete | 2026-01-29 |
| 24. Free Fields & Toggle | v2.0 | 2/2 | ✅ Complete | 2026-01-29 |
| 25. Wire Change Detection | v2.0 | 0/? | ⏳ Pending | - |
| 26. Wire Conflict Resolution | v2.0 | 0/? | ⏳ Pending | - |

---
*Roadmap created: 2026-01-29*
*Last updated: 2026-01-29 (Gap closure phases 25-26 added)*
