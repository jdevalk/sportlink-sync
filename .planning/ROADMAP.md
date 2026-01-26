# Roadmap: Sportlink Sync

## Milestones

- **v1.0 MVP** — Phases 1-2 (shipped 2026-01-24)
- **v1.1 Postmark Email** — Phase 3 (shipped 2026-01-25)
- **v1.2 Email Polish** — Phase 4 (shipped 2026-01-25)
- **v1.3 Connect to Stadion** — Phases 5-8 (shipped 2026-01-25)
- **v1.4 Photo Sync** — Phases 9-12 (shipped 2026-01-26)
- **v1.5 Team Sync** — Phases 13-15 (in progress)

## Phases

<details>
<summary>v1.0-v1.4 (Phases 1-12) — SHIPPED</summary>

See `.planning/MILESTONES.md` for completed work.

Archives:
- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.1-ROADMAP.md`
- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.3-ROADMAP.md`
- `.planning/milestones/v1.4-ROADMAP.md`

</details>

### v1.5 Team Sync (In Progress)

**Milestone Goal:** Sync member teams from Sportlink to Stadion, creating teams and work history entries.

#### Phase 13: Team Extraction and Management
**Goal**: Extract unique team names from Sportlink and create teams in Stadion via REST API
**Depends on**: Phase 12 (existing member sync infrastructure)
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04
**Success Criteria** (what must be TRUE):
  1. System extracts team name from UnionTeams field when present
  2. System falls back to ClubTeams field when UnionTeams is empty
  3. System creates teams in Stadion via POST /wp/v2/teams with title field
  4. SQLite database tracks team name to Stadion team ID mappings
**Plans**: 1 plan

Plans:
- [x] 13-01-PLAN.md — Team extraction and Stadion team creation

#### Phase 14: Work History Sync
**Goal**: System links persons to their teams via work history entries with change detection
**Depends on**: Phase 13 (needs teams to exist in Stadion)
**Requirements**: TEAM-05, TEAM-06, TEAM-07, TEAM-08, TEAM-09
**Success Criteria** (what must be TRUE):
  1. Person records have work_history entry with team reference (post_object)
  2. Work history job_title is set to "Speler"
  3. Work history is_current field is set to true
  4. System tracks each member's current team assignment in SQLite
  5. When member's team changes, system updates work_history in Stadion
**Plans**: 1 plan

Plans:
- [x] 14-01-PLAN.md — Work history creation and team change detection

#### Phase 15: Pipeline Integration
**Goal**: Team sync integrated into daily pipeline with email reporting
**Depends on**: Phase 14 (complete team sync functionality)
**Requirements**: TEAM-10, TEAM-11
**Success Criteria** (what must be TRUE):
  1. Team sync runs automatically as part of Stadion member sync
  2. Email report includes team sync statistics (teams created, members linked, changes detected)
  3. Team sync failures do not block Laposta or core Stadion member sync
**Plans**: TBD

Plans:
- [ ] 15-01: Integrate team sync into sync-all with email reporting

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-2. MVP | v1.0 | 3/3 | Complete | 2026-01-24 |
| 3. Postmark | v1.1 | 2/2 | Complete | 2026-01-25 |
| 4. Email Polish | v1.2 | 2/2 | Complete | 2026-01-25 |
| 5. Stadion Foundation | v1.3 | 1/1 | Complete | 2026-01-25 |
| 6. Member Sync | v1.3 | 3/3 | Complete | 2026-01-25 |
| 7. Parent Sync | v1.3 | 3/3 | Complete | 2026-01-25 |
| 8. Pipeline Integration | v1.3 | 1/1 | Complete | 2026-01-25 |
| 9. Photo State Tracking | v1.4 | 1/1 | Complete | 2026-01-26 |
| 10. Photo Download | v1.4 | 1/1 | Complete | 2026-01-26 |
| 11. Photo Upload/Deletion | v1.4 | 1/1 | Complete | 2026-01-26 |
| 12. Pipeline Integration | v1.4 | 1/1 | Complete | 2026-01-26 |
| 13. Team Extraction | v1.5 | 1/1 | Complete | 2026-01-26 |
| 14. Work History | v1.5 | 1/1 | Complete | 2026-01-26 |
| 15. Pipeline Integration | v1.5 | 0/1 | Not started | - |

**Total:** 15 phases (14 complete, 1 remaining)

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-26 for Phase 14 complete*
