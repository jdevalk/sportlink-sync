# Roadmap: Sportlink Sync

## Milestones

- ✅ **v1.0 MVP** - Phases 1-8 (shipped 2025)
- ✅ **v1.1 Email Reports** - Phases 9-11 (shipped 2025)
- ✅ **v1.2 Email Refinements** - Phases 12-13 (shipped 2025)
- ✅ **v1.3 Stadion Sync** - Phases 14-15 (shipped 2025)
- ✅ **v1.4 Photo Sync** - Phases 16-17 (shipped 2025)
- ✅ **v1.5 Team Sync** - Phases 18-19 (shipped 2025)
- ✅ **v1.7 Financial Block** - Phases 20-21 (shipped 2025)
- ✅ **v2.0 Bidirectional Sync** - Phases 22-26 (shipped 2026-01-29)
- 🚧 **v2.1 Improved Nikki Import** - Phases 27-29 (in progress)

## Phases

<details>
<summary>✅ v1.0-v2.0 (Phases 1-26) - SHIPPED</summary>

Previous milestones completed. See git history for details.

</details>

### 🚧 v2.1 Improved Nikki Import (In Progress)

**Milestone Goal:** Enhance Nikki contribution sync with CSV data extraction and per-year ACF field storage in Stadion.

#### Phase 27: CSV Download & Data Matching ✓
**Goal**: Download CSV from Nikki Rapporten link and match contribution data to members by nikki_id
**Depends on**: Phase 26
**Requirements**: CSV-01, CSV-02, CSV-03, MATCH-01, MATCH-02, MATCH-03
**Success Criteria** (what must be TRUE):
  1. CSV file downloads automatically after /leden table scrape completes
  2. System extracts hoofdsom (total amount) from CSV for each member with valid nikki_id
  3. Members without nikki_id are processed without errors (gracefully skipped)
  4. CSV data correctly matches to existing /leden records for validation
**Plans:** 1 plan
**Completed:** 2026-02-01

Plans:
- [x] 27-01-PLAN.md — CSV download, parsing, and data merge with hoofdsom field

#### Phase 28: Per-Year SQLite Storage
**Goal**: Store 2-3 years of historical contribution data per member in SQLite
**Depends on**: Phase 27
**Requirements**: STORE-01, STORE-02, STORE-03
**Success Criteria** (what must be TRUE):
  1. SQLite schema stores contribution data with year, knvb_id, total, saldo, status columns
  2. Historical data persists across syncs (2-3 years retained per member)
  3. Current year data updates correctly on each sync (replace, not append)
  4. Query can retrieve multi-year history for any member by knvb_id
**Plans**: TBD

Plans:
- [ ] 28-01: TBD

#### Phase 29: Stadion ACF Sync
**Goal**: Sync individual per-year contribution fields to Stadion person ACF
**Depends on**: Phase 28
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04
**Success Criteria** (what must be TRUE):
  1. Each person record in Stadion shows _nikki_{year}_total field with correct value
  2. Each person record in Stadion shows _nikki_{year}_saldo field with correct value
  3. Each person record in Stadion shows _nikki_{year}_status field with correct value
  4. All years (2-3) sync correctly for each member in one sync operation
**Plans**: TBD

Plans:
- [ ] 29-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 27 → 28 → 29

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 27. CSV Download & Data Matching | v2.1 | 1/1 | Complete | 2026-02-01 |
| 28. Per-Year SQLite Storage | v2.1 | 0/? | Not started | - |
| 29. Stadion ACF Sync | v2.1 | 0/? | Not started | - |
