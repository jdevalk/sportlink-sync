# Roadmap: Sportlink Sync

## Milestones

- ✅ **v1.0 MVP** — Phases 1-2 (shipped 2026-01-24)
- ✅ **v1.1 Postmark Email** — Phase 3 (shipped 2026-01-25)
- ✅ **v1.2 Email Polish** — Phase 4 (shipped 2026-01-25)
- ✅ **v1.3 Connect to Stadion** — Phases 5-8 (shipped 2026-01-25)
- **v1.4 Photo Sync** — Phases 9-12 (in progress)

## Phases

<details>
<summary>v1.0-v1.3 (Phases 1-8) — SHIPPED</summary>

See `.planning/MILESTONES.md` for completed work.

Archives:
- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.1-ROADMAP.md`
- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.3-ROADMAP.md`

</details>

### v1.4 Photo Sync (In Progress)

**Milestone Goal:** Download member photos from Sportlink and sync them to both local storage and Stadion WordPress.

#### Phase 9: Photo State Tracking
**Goal**: System tracks photo state in SQLite and detects when photos need syncing
**Depends on**: Phase 8 (existing SQLite infrastructure)
**Requirements**: PHOTO-04, PHOTO-05
**Success Criteria** (what must be TRUE):
  1. SQLite schema includes PersonImageDate column for photo state tracking
  2. System identifies members with new/changed PersonImageDate
  3. System identifies members whose PersonImageDate became empty (photo removed)
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

#### Phase 10: Photo Download
**Goal**: System extracts photos from Sportlink member detail pages via browser automation
**Depends on**: Phase 9 (needs change detection to know which photos to download)
**Requirements**: PHOTO-01, PHOTO-02, PHOTO-03
**Success Criteria** (what must be TRUE):
  1. System identifies members with photos via PersonImageDate field presence
  2. System navigates to member detail page and opens photo modal
  3. Photos saved locally as `photos/<PublicPersonId>.<ext>` with correct format
**Plans**: TBD

Plans:
- [ ] 10-01: TBD

#### Phase 11: Photo Upload and Deletion
**Goal**: System syncs photos to Stadion and handles photo removal from both local and Stadion
**Depends on**: Phase 10 (needs downloaded photos to upload)
**Requirements**: PHOTO-06, PHOTO-07, PHOTO-08, PHOTO-09, PHOTO-10
**Success Criteria** (what must be TRUE):
  1. System matches person in Stadion by KNVB ID before uploading photo
  2. Photo uploaded to Stadion via `POST /stadion/v1/people/{id}/photo` endpoint
  3. When photo removed in Sportlink, local file deleted from `photos/` directory
  4. When photo removed in Sportlink, photo deleted from Stadion via API
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

#### Phase 12: Pipeline Integration
**Goal**: Photo sync integrated into daily sync-all pipeline with email reporting
**Depends on**: Phase 11 (complete photo sync functionality)
**Requirements**: PHOTO-11, PHOTO-12
**Success Criteria** (what must be TRUE):
  1. Photo sync runs as part of `npm run sync-all` pipeline
  2. Email report includes photo sync statistics (downloaded, uploaded, deleted, errors)
  3. Photo sync failures do not block Laposta/Stadion member sync
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

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
| 9. Photo State Tracking | v1.4 | 0/? | Not started | - |
| 10. Photo Download | v1.4 | 0/? | Not started | - |
| 11. Photo Upload/Deletion | v1.4 | 0/? | Not started | - |
| 12. Pipeline Integration | v1.4 | 0/? | Not started | - |

**Total:** 12 phases (8 complete, 4 in v1.4)

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-26 after v1.4 roadmap creation*
