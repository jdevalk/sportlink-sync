# Requirements: Rondo Sync

**Defined:** 2026-02-10
**Core Value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention

## v3.2 Requirements

Requirements for Stadion-to-Rondo rename. Each maps to roadmap phases.

### Database Migration

- [ ] **DB-01**: All `stadion_*` tables renamed to `rondo_club_*` in rondo-sync.sqlite
- [ ] **DB-02**: All `stadion_id` columns renamed to `rondo_club_id`
- [ ] **DB-03**: All `*_stadion_modified` columns renamed to `*_rondo_club_modified`
- [ ] **DB-04**: Migration runs safely on live server without breaking running syncs

### Code References

- [ ] **CODE-01**: All `stadion_` references in lib/ updated to `rondo_club_`
- [ ] **CODE-02**: All `stadion_` references in steps/ updated to `rondo_club_`
- [ ] **CODE-03**: All `stadion_` references in pipelines/ updated to `rondo_club_`
- [ ] **CODE-04**: All `stadion_` references in tools/ updated to `rondo_club_`
- [ ] **CODE-05**: Variable names using `stadion` renamed throughout

### Documentation

- [ ] **DOCS-01**: All `stadion` references in docs/ updated
- [ ] **DOCS-02**: CLAUDE.md updated
- [ ] **DOCS-03**: README and package.json updated

## Future Requirements

None — this is a one-time rename milestone.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Renaming the SQLite database file | Already `data/rondo-sync.sqlite` |
| Multi-club table structure | Deferred to Phase 39 when second club onboards |
| Renaming dashboard.sqlite tables | Already use `rondo` naming (club_slug = 'rondo') |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 41 | Pending |
| DB-02 | Phase 41 | Pending |
| DB-03 | Phase 41 | Pending |
| DB-04 | Phase 41 | Pending |
| CODE-01 | Phase 42 | Pending |
| CODE-02 | Phase 42 | Pending |
| CODE-03 | Phase 42 | Pending |
| CODE-04 | Phase 42 | Pending |
| CODE-05 | Phase 42 | Pending |
| DOCS-01 | Phase 43 | Pending |
| DOCS-02 | Phase 43 | Pending |
| DOCS-03 | Phase 43 | Pending |

**Coverage:**
- v3.2 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 after initial definition*
