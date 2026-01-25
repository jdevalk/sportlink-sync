# Requirements: Sportlink Sync

**Defined:** 2026-01-25
**Core Value:** Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention.

## v1.3 Requirements

Requirements for Stadion integration. Each maps to roadmap phases.

### Stadion API Client

- [ ] **STAD-01**: Sync creates new person in Stadion when member doesn't exist
- [ ] **STAD-02**: Sync updates existing person when member data changes
- [ ] **STAD-03**: Authenticate via WordPress application password
- [ ] **STAD-04**: Handle API errors gracefully without failing entire sync

### Field Mapping

- [ ] **STAD-05**: Map first/last name (handling tussenvoegsel)
- [ ] **STAD-06**: Map email/mobile/phone to contact_info repeater
- [ ] **STAD-07**: Map address fields to addresses repeater
- [ ] **STAD-08**: Map gender code to Stadion gender values
- [ ] **STAD-09**: Extract birth year from geboortedatum

### Member Matching

- [ ] **STAD-10**: Store Sportlink relatiecode as "KNVB ID" custom field
- [ ] **STAD-11**: Match by KNVB ID first, fall back to email
- [ ] **STAD-12**: Use hash-based change detection like Laposta

### Parent Sync

- [ ] **STAD-13**: Create parent as separate person record
- [ ] **STAD-14**: Deduplicate parents across members (like Laposta)
- [ ] **STAD-15**: Link parent to child via relationships field

### Pipeline Integration

- [ ] **STAD-16**: Add Stadion sync to sync-all.js pipeline
- [ ] **STAD-17**: Include Stadion results in email report
- [ ] **STAD-18**: Configure Stadion via environment variables

## Future Requirements

Deferred to later milestones.

### Bidirectional Sync

- **BIDI-01**: Read changes from Stadion
- **BIDI-02**: Sync Stadion changes back to Sportlink
- **BIDI-03**: Sync Stadion changes to Laposta
- **BIDI-04**: Conflict resolution when sources disagree

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Photo sync | Storage/bandwidth costs, not needed for v1.3 |
| Team/work_history sync | Sportlink doesn't provide team role data |
| Relationship types | Only parent/child for now, expand later |
| Delete sync | Members removed from Sportlink stay in Stadion |
| Stadion → Sportlink | Bidirectional sync deferred to future milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STAD-01 | Phase 6 | Complete |
| STAD-02 | Phase 6 | Complete |
| STAD-03 | Phase 5 | Complete |
| STAD-04 | Phase 5 | Complete |
| STAD-05 | Phase 6 | Complete |
| STAD-06 | Phase 6 | Complete |
| STAD-07 | Phase 6 | Complete |
| STAD-08 | Phase 6 | Complete |
| STAD-09 | Phase 6 | Complete |
| STAD-10 | Phase 6 | Complete |
| STAD-11 | Phase 6 | Complete |
| STAD-12 | Phase 6 | Complete |
| STAD-13 | Phase 7 | Complete |
| STAD-14 | Phase 7 | Complete |
| STAD-15 | Phase 7 | Complete |
| STAD-16 | Phase 8 | Pending |
| STAD-17 | Phase 8 | Pending |
| STAD-18 | Phase 5 | Complete |

**Coverage:**
- v1.3 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-01-25*
*Last updated: 2026-01-25 after roadmap creation*
