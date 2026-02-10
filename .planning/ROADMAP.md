# Roadmap: Rondo Sync

## Milestones

- ✅ **v1.0 MVP** — Phases 1-2 (shipped 2026-01-24)
- ✅ **v1.1 Postmark Email** — Phase 3 (shipped 2026-01-25)
- ✅ **v1.2 Email Polish** — Phase 4 (shipped 2026-01-25)
- ✅ **v1.3 Connect to Rondo Club** — Phases 5-8 (shipped 2026-01-25)
- ✅ **v1.4 Photo Sync** — Phases 9-12 (shipped 2026-01-26)
- ✅ **v1.5 Team Sync** — Phases 13-15 (shipped 2026-01-26)
- ✅ **v1.7 MemberHeader API** — Phases 17-19 (shipped 2026-01-28)
- ✅ **v2.0 Bidirectional Sync** — Phases 20-26 (shipped 2026-01-29)
- ✅ **v2.1 Nikki Import** — Phases 27-29 (shipped 2026-02-02)
- ✅ **v2.2 Discipline Cases** — Phases 30-32 (shipped 2026-02-03)
- ✅ **v2.3 Birthday Migration** — Phase 33 (shipped 2026-02-06)
- ✅ **v3.0 Web Dashboard** — Phases 34-38 (shipped 2026-02-09)
- ✅ **v3.1 Fetch Former Members** — Phase 40 (shipped 2026-02-09)
- 🚧 **v3.2 Stadion-to-Rondo Rename** — Phases 41-43 (in progress)

## Phases

<details>
<summary>✅ v3.0 Web Dashboard (Phases 34-38) — SHIPPED 2026-02-09</summary>

- [x] Phase 34: Infrastructure Foundation (1/1 plan) — completed 2026-02-08
- [x] Phase 35: Run Tracking (1/1 plan) — completed 2026-02-08
- [x] Phase 36: Web Server and Authentication (2/2 plans) — completed 2026-02-09
- [x] Phase 37: Dashboard UI (2/2 plans) — completed 2026-02-09
- [x] Phase 38: Email Migration (1/1 plan) — completed 2026-02-09

</details>

<details>
<summary>✅ v3.1 Fetch Former Members (Phase 40) — SHIPPED 2026-02-09</summary>

- [x] Phase 40: Former Member Import Tool (2/2 plans) — completed 2026-02-09

</details>

### 🚧 v3.2 Stadion-to-Rondo Rename (In Progress)

**Milestone Goal:** Rename all "stadion" references to "rondo_club" across the entire codebase — database tables, columns, file references, variable names, and documentation.

#### Phase 41: Database Migration
**Goal**: Rename SQLite tables and columns from stadion to rondo_club
**Depends on**: Nothing (first phase in milestone)
**Requirements**: DB-01, DB-02, DB-03, DB-04
**Success Criteria** (what must be TRUE):
  1. All `stadion_*` tables are renamed to `rondo_club_*` in rondo-sync.sqlite
  2. All `stadion_id` columns are renamed to `rondo_club_id`
  3. All `*_stadion_modified` columns are renamed to `*_rondo_club_modified`
  4. Migration runs without breaking active sync processes on production server
  5. Migration uses CREATE+INSERT+DROP pattern (not ALTER TABLE RENAME) to avoid concurrent access bugs
**Plans**: TBD

Plans:
- [ ] 41-01: TBD

#### Phase 42: Code References
**Goal**: Update all stadion references in codebase to rondo_club
**Depends on**: Phase 41
**Requirements**: CODE-01, CODE-02, CODE-03, CODE-04, CODE-05
**Success Criteria** (what must be TRUE):
  1. All `stadion_` references in lib/ are updated to `rondo_club_`
  2. All `stadion_` references in steps/ are updated to `rondo_club_`
  3. All `stadion_` references in pipelines/ are updated to `rondo_club_`
  4. All `stadion_` references in tools/ are updated to `rondo_club_`
  5. Variable names using `stadion` are renamed throughout codebase
  6. All sync pipelines run successfully after rename
**Plans**: TBD

Plans:
- [ ] 42-01: TBD

#### Phase 43: Documentation
**Goal**: Update all documentation to reflect rondo_club naming
**Depends on**: Phase 42
**Requirements**: DOCS-01, DOCS-02, DOCS-03
**Success Criteria** (what must be TRUE):
  1. All `stadion` references in docs/ are updated
  2. CLAUDE.md reflects new naming conventions
  3. README.md and package.json are updated
  4. Developer docs site synced with changes
**Plans**: TBD

Plans:
- [ ] 43-01: TBD

### Deferred

- [ ] Phase 39: Multi-Club Readiness (0/1 plan) — deferred until second club onboards

## Progress

**Execution Order:**
Phases execute in numeric order: 41 → 42 → 43

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 34. Infrastructure Foundation | v3.0 | 1/1 | Complete | 2026-02-08 |
| 35. Run Tracking | v3.0 | 1/1 | Complete | 2026-02-08 |
| 36. Web Server and Authentication | v3.0 | 2/2 | Complete | 2026-02-09 |
| 37. Dashboard UI | v3.0 | 2/2 | Complete | 2026-02-09 |
| 38. Email Migration | v3.0 | 1/1 | Complete | 2026-02-09 |
| 39. Multi-Club Readiness | — | 0/1 | Deferred | - |
| 40. Former Member Import Tool | v3.1 | 2/2 | Complete | 2026-02-09 |
| 41. Database Migration | v3.2 | 0/TBD | Not started | - |
| 42. Code References | v3.2 | 0/TBD | Not started | - |
| 43. Documentation | v3.2 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-08*
*Last updated: 2026-02-10 after v3.2 milestone roadmap creation*
