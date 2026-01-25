# Roadmap: Sportlink Sync

## Milestones

- v1.0 MVP - Phases 1-2 (shipped 2026-01-24)
- v1.1 Postmark Email - Phase 3 (shipped 2026-01-25)
- v1.2 Email Polish - Phase 4 (shipped 2026-01-25)
- **v1.3 Connect to Stadion** - Phases 5-8 (in progress)

## Phases

<details>
<summary>v1.0-v1.2 (Phases 1-4) - SHIPPED</summary>

See MILESTONES.md for completed work.

</details>

### v1.3 Connect to Stadion (In Progress)

**Milestone Goal:** Sync Sportlink member data to Stadion WordPress app via REST API.

- [x] **Phase 5: Stadion Foundation** - API client with auth and error handling
- [x] **Phase 6: Member Sync** - Field mapping, matching, and change detection
- [ ] **Phase 7: Parent Sync** - Parents as separate person records
- [ ] **Phase 8: Pipeline Integration** - Integrate into sync-all and email reports

## Phase Details

### Phase 5: Stadion Foundation
**Goal**: Stadion API client is operational and can make authenticated requests
**Depends on**: Nothing (new integration)
**Requirements**: STAD-03, STAD-04, STAD-18
**Success Criteria** (what must be TRUE):
  1. Script can authenticate to Stadion WordPress REST API using application password
  2. API errors return structured error messages without crashing
  3. Stadion credentials are loaded from environment variables
**Plans**: 1 plan

Plans:
- [x] 05-01-PLAN.md — Stadion API client with authentication and error handling

### Phase 6: Member Sync
**Goal**: Members sync from Sportlink to Stadion with all field mappings
**Depends on**: Phase 5
**Requirements**: STAD-01, STAD-02, STAD-05, STAD-06, STAD-07, STAD-08, STAD-09, STAD-10, STAD-11, STAD-12
**Success Criteria** (what must be TRUE):
  1. New Sportlink members are created as persons in Stadion
  2. Changed member data updates existing Stadion person
  3. Unchanged members are skipped (hash-based detection)
  4. Members are matched by KNVB ID (relatiecode), with email fallback
  5. All mapped fields (name, contact, address, gender, birth year) appear correctly in Stadion
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Stadion database module for hash-based change detection
- [x] 06-02-PLAN.md — Field mapping and member preparation
- [x] 06-03-PLAN.md — Sync execution with matching and CRUD operations

### Phase 7: Parent Sync
**Goal**: Parents sync as separate person records linked to children
**Depends on**: Phase 6
**Requirements**: STAD-13, STAD-14, STAD-15
**Success Criteria** (what must be TRUE):
  1. Parent creates as separate person record in Stadion
  2. Same parent appearing for multiple children is synced once
  3. Parent record is linked to child via relationships field
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md — Shared parent deduplication module (lib/parent-dedupe.js)
- [ ] 07-02-PLAN.md — Parent preparation with extraction and deduplication
- [ ] 07-03-PLAN.md — Parent sync execution with relationship linking

### Phase 8: Pipeline Integration
**Goal**: Stadion sync is part of automated daily pipeline with email reports
**Depends on**: Phase 7
**Requirements**: STAD-16, STAD-17
**Success Criteria** (what must be TRUE):
  1. Running `npm run sync-all` syncs to both Laposta and Stadion
  2. Email report includes Stadion sync results (creates, updates, skipped)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-2. MVP | v1.0 | 3/3 | Complete | 2026-01-24 |
| 3. Postmark | v1.1 | 2/2 | Complete | 2026-01-25 |
| 4. Email Polish | v1.2 | 2/2 | Complete | 2026-01-25 |
| 5. Stadion Foundation | v1.3 | 1/1 | Complete | 2026-01-25 |
| 6. Member Sync | v1.3 | 3/3 | Complete | 2026-01-25 |
| 7. Parent Sync | v1.3 | 0/3 | Not started | - |
| 8. Pipeline Integration | v1.3 | 0/? | Not started | - |

---
*Roadmap created: 2026-01-25*
