# Requirements: Sportlink Sync

**Defined:** 2026-01-26
**Core Value:** Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention.

## v1.4 Requirements

Requirements for photo sync milestone. Each maps to roadmap phases.

### Photo Download

- [x] **PHOTO-01**: System detects members with photos via PersonImageDate field
- [x] **PHOTO-02**: System navigates to member detail page and extracts photo from modal
- [x] **PHOTO-03**: System saves photo locally as `photos/<PublicPersonId>.<ext>`

### Change Detection

- [x] **PHOTO-04**: System tracks PersonImageDate in SQLite
- [x] **PHOTO-05**: System only downloads when PersonImageDate is new or changed

### Stadion Upload

- [x] **PHOTO-06**: System uploads photo to Stadion via `POST /stadion/v1/people/{id}/photo`
- [x] **PHOTO-07**: System matches person by KNVB ID before uploading

### Photo Removal

- [x] **PHOTO-08**: System detects when PersonImageDate becomes empty
- [x] **PHOTO-09**: System deletes local photo file when removed in Sportlink
- [x] **PHOTO-10**: System deletes photo from Stadion when removed in Sportlink

### Pipeline Integration

- [x] **PHOTO-11**: Photo sync runs as part of sync-all pipeline
- [x] **PHOTO-12**: Email report includes photo sync statistics (downloaded, uploaded, deleted, errors)

## Future Requirements

None currently identified for photo sync.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Photo resizing/optimization | Stadion handles thumbnail generation |
| Batch photo download API | Must use browser automation per member |
| Photo sync for parents | Parents don't have Sportlink photo data |
| Historical photo tracking | Only track current photo state |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PHOTO-01 | Phase 10 | Complete |
| PHOTO-02 | Phase 10 | Complete |
| PHOTO-03 | Phase 10 | Complete |
| PHOTO-04 | Phase 9 | Complete |
| PHOTO-05 | Phase 9 | Complete |
| PHOTO-06 | Phase 11 | Complete |
| PHOTO-07 | Phase 11 | Complete |
| PHOTO-08 | Phase 11 | Complete |
| PHOTO-09 | Phase 11 | Complete |
| PHOTO-10 | Phase 11 | Complete |
| PHOTO-11 | Phase 12 | Complete |
| PHOTO-12 | Phase 12 | Complete |

**Coverage:**
- v1.4 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-26 after Phase 12 complete*
