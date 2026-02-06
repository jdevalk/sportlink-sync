# Requirements: Sportlink Sync v2.3

**Defined:** 2026-02-06
**Core Value:** Keep downstream systems automatically in sync with Sportlink member data without manual intervention.

## v2.3 Requirements

### Birthday Sync Migration

- [ ] **BDAY-01**: Sync birthdate as `acf.birthdate` field on person during existing Stadion person sync step
- [ ] **BDAY-02**: Remove the separate `sync-important-dates.js` step from the people pipeline
- [ ] **BDAY-03**: Remove or deprecate the `stadion_important_dates` DB table
- [ ] **BDAY-04**: Update email reports to remove the separate birthday sync section

## Out of Scope

| Feature | Reason |
|---------|--------|
| Clean up existing important_date birthday posts in Stadion | Handled on Stadion side |
| Important dates for non-birthday events | Not currently synced, no change needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BDAY-01 | TBD | Pending |
| BDAY-02 | TBD | Pending |
| BDAY-03 | TBD | Pending |
| BDAY-04 | TBD | Pending |

**Coverage:**
- v2.3 requirements: 4 total
- Mapped to phases: 0
- Unmapped: 4

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-06 after initial definition*
