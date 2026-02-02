# Requirements: Sportlink Sync v2.2

**Defined:** 2026-02-02
**Core Value:** Keep downstream systems automatically in sync with Sportlink member data without manual intervention

## v2.2 Requirements

Requirements for discipline case sync. Each maps to roadmap phases.

### Download & Storage

- [x] **DISC-01**: Download discipline cases from Sportlink `/competition-affairs/discipline-cases`
- [x] **DISC-02**: Click "Individuele tuchtzaken" tab and capture DisciplineClubCasesPlayer API response
- [x] **DISC-03**: Store cases in SQLite with all fields (DossierId, PublicPersonId, MatchDate, MatchDescription, TeamName, ChargeCodes, ChargeDescription, SanctionDescription, ProcessingDate, AdministrativeFee, IsCharged)

### Stadion Sync

- [ ] **DISC-04**: Create/update discipline-cases as Stadion custom post type
- [ ] **DISC-05**: Map all case fields to Stadion ACF fields
- [ ] **DISC-06**: Link case to person via ACF relationship field (using PublicPersonId -> stadion_id mapping)

### Season Organization

- [ ] **DISC-09**: Derive season from case date (Aug 1 = new season boundary)
- [ ] **DISC-10**: Create season category if it doesn't exist (e.g., "2025-2026")
- [ ] **DISC-11**: Assign cases to appropriate season category

### Pipeline Integration

- [ ] **DISC-12**: Weekly sync schedule (cron)
- [ ] **DISC-13**: Include discipline case stats in email report
- [ ] **DISC-14**: Add `scripts/sync.sh discipline` command

## Out of Scope

| Feature | Reason |
|---------|--------|
| Bidirectional sync | Cases are read-only from Sportlink, no editing in Stadion |
| Case deletion | Cases persist in Stadion even if removed from Sportlink (historical record) |
| Team discipline cases | Only individual cases ("Individuele tuchtzaken"), not team cases |
| Real-time sync | Weekly batch sync sufficient for rare disciplinary events |
| Player card on case page (DISC-07) | Stadion theme/plugin work, not sync code — deferred to Stadion codebase |
| Cases list on player page (DISC-08) | Stadion theme/plugin work, not sync code — deferred to Stadion codebase |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 30 | Complete |
| DISC-02 | Phase 30 | Complete |
| DISC-03 | Phase 30 | Complete |
| DISC-04 | Phase 31 | Pending |
| DISC-05 | Phase 31 | Pending |
| DISC-06 | Phase 31 | Pending |
| DISC-09 | Phase 31 | Pending |
| DISC-10 | Phase 31 | Pending |
| DISC-11 | Phase 31 | Pending |
| DISC-12 | Phase 32 | Pending |
| DISC-13 | Phase 32 | Pending |
| DISC-14 | Phase 32 | Pending |

**Coverage:**
- v2.2 requirements: 12 total (2 deferred to Stadion codebase)
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-02*
*Last updated: 2026-02-02 after deferring DISC-07, DISC-08 to Stadion codebase*
