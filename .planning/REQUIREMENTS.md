# Requirements: Sportlink Sync v2.1

**Defined:** 2026-02-01
**Core Value:** Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention

## v2.1 Requirements

Requirements for Improved Nikki Import milestone.

### CSV Download

- [x] **CSV-01**: System downloads CSV when clicking Rapporten link after /leden scrape
- [x] **CSV-02**: System handles download via Playwright (wait for download, read file)
- [x] **CSV-03**: System parses CSV with columns: nikki_id, lid_nr, hoofdsom, saldo, etc.

### Data Matching

- [x] **MATCH-01**: System matches CSV rows to /leden table rows by nikki_id
- [x] **MATCH-02**: System extracts hoofdsom (total amount) from matched CSV row
- [x] **MATCH-03**: System handles missing nikki_id gracefully (skip without error)

### Per-Year Storage

- [x] **STORE-01**: SQLite schema stores per-year data: year, knvb_id, total, saldo, status
- [x] **STORE-02**: System retains 2-3 years of historical data per member
- [x] **STORE-03**: System replaces data for current year on each sync

### Stadion Sync

- [x] **SYNC-01**: System syncs `_nikki_{year}_total` field to Stadion person ACF
- [x] **SYNC-02**: System syncs `_nikki_{year}_saldo` field to Stadion person ACF
- [x] **SYNC-03**: System syncs `_nikki_{year}_status` field to Stadion person ACF
- [x] **SYNC-04**: System syncs all years (2-3) for each member

## Out of Scope

| Feature | Reason |
|---------|--------|
| Bidirectional Nikki sync | Nikki is read-only source, corrections made there directly |
| Real-time sync | Daily batch sync is sufficient for contribution data |
| Additional CSV columns | Only hoofdsom needed now, can extend later |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CSV-01 | Phase 27 | Complete |
| CSV-02 | Phase 27 | Complete |
| CSV-03 | Phase 27 | Complete |
| MATCH-01 | Phase 27 | Complete |
| MATCH-02 | Phase 27 | Complete |
| MATCH-03 | Phase 27 | Complete |
| STORE-01 | Phase 28 | Complete |
| STORE-02 | Phase 28 | Complete |
| STORE-03 | Phase 28 | Complete |
| SYNC-01 | Phase 29 | Complete |
| SYNC-02 | Phase 29 | Complete |
| SYNC-03 | Phase 29 | Complete |
| SYNC-04 | Phase 29 | Complete |

**Coverage:**
- v2.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-01*
*Last updated: 2026-02-01 after Phase 29 completion*
