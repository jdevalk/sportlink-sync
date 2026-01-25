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
| STAD-01 | TBD | Pending |
| STAD-02 | TBD | Pending |
| STAD-03 | TBD | Pending |
| STAD-04 | TBD | Pending |
| STAD-05 | TBD | Pending |
| STAD-06 | TBD | Pending |
| STAD-07 | TBD | Pending |
| STAD-08 | TBD | Pending |
| STAD-09 | TBD | Pending |
| STAD-10 | TBD | Pending |
| STAD-11 | TBD | Pending |
| STAD-12 | TBD | Pending |
| STAD-13 | TBD | Pending |
| STAD-14 | TBD | Pending |
| STAD-15 | TBD | Pending |
| STAD-16 | TBD | Pending |
| STAD-17 | TBD | Pending |
| STAD-18 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 18 total
- Mapped to phases: 0
- Unmapped: 18

---
*Requirements defined: 2026-01-25*
*Last updated: 2026-01-25 after initial definition*
