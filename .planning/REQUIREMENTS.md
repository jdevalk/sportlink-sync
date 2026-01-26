# Requirements: Sportlink Sync

**Defined:** 2026-01-26
**Core Value:** Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention.

## v1.4 Requirements

Requirements for photo sync milestone. Each maps to roadmap phases.

### Photo Download

- [ ] **PHOTO-01**: System detects members with photos via PersonImageDate field
- [ ] **PHOTO-02**: System navigates to member detail page and extracts photo from modal
- [ ] **PHOTO-03**: System saves photo locally as `photos/<PublicPersonId>.<ext>`

### Change Detection

- [ ] **PHOTO-04**: System tracks PersonImageDate in SQLite
- [ ] **PHOTO-05**: System only downloads when PersonImageDate is new or changed

### Stadion Upload

- [ ] **PHOTO-06**: System uploads photo to Stadion via `POST /stadion/v1/people/{id}/photo`
- [ ] **PHOTO-07**: System matches person by KNVB ID before uploading

### Photo Removal

- [ ] **PHOTO-08**: System detects when PersonImageDate becomes empty
- [ ] **PHOTO-09**: System deletes local photo file when removed in Sportlink
- [ ] **PHOTO-10**: System deletes photo from Stadion when removed in Sportlink

### Pipeline Integration

- [ ] **PHOTO-11**: Photo sync runs as part of sync-all pipeline
- [ ] **PHOTO-12**: Email report includes photo sync statistics (downloaded, uploaded, deleted, errors)

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
| PHOTO-01 | Phase 10 | Pending |
| PHOTO-02 | Phase 10 | Pending |
| PHOTO-03 | Phase 10 | Pending |
| PHOTO-04 | Phase 9 | Pending |
| PHOTO-05 | Phase 9 | Pending |
| PHOTO-06 | Phase 11 | Pending |
| PHOTO-07 | Phase 11 | Pending |
| PHOTO-08 | Phase 11 | Pending |
| PHOTO-09 | Phase 11 | Pending |
| PHOTO-10 | Phase 11 | Pending |
| PHOTO-11 | Phase 12 | Pending |
| PHOTO-12 | Phase 12 | Pending |

**Coverage:**
- v1.4 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-26 after roadmap creation*
