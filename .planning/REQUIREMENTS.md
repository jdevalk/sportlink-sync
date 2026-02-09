# Requirements: Rondo Sync

**Defined:** 2026-02-09
**Core Value:** Keep downstream systems (Laposta, Rondo Club) automatically in sync with Sportlink member data without manual intervention

## v3.1 Requirements

Requirements for v3.1 Fetch Former Members. One-time onboarding tool.

### Download

- [ ] **DL-01**: Tool can log into Sportlink and search for INACTIVE members by toggling status chips
- [ ] **DL-02**: Tool captures SearchMembers API response with inactive member data
- [ ] **DL-03**: Tool downloads member photos via MemberHeader API for each former member

### Sync

- [ ] **SYNC-01**: Former members sync to Rondo Club as person records with name, contact details, address, and KNVB ID
- [ ] **SYNC-02**: Former members have `acf.former_member` set to `true`
- [ ] **SYNC-03**: Former member photos upload to their Rondo Club person record
- [ ] **SYNC-04**: Existing active members are skipped (no duplicates)

### Tooling

- [ ] **TOOL-01**: Script runs as a one-time tool (not a scheduled pipeline)
- [ ] **TOOL-02**: Script supports dry-run mode (preview without syncing)
- [ ] **TOOL-03**: Script provides progress output with counts (downloaded, synced, skipped, failed)

## Future Requirements

### Recurring Sync

- **FUTURE-01**: Periodic re-check for newly inactive members (if needed after initial backfill)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Laposta sync for former members | Not needed — former members don't get marketing emails |
| Team/work history for former members | Not needed for outstanding payments/equipment tracking |
| Reverse sync for former members | One-time import, corrections happen in Rondo Club directly |
| Discipline cases for former members | Historical discipline data not needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DL-01 | Phase 40 | Pending |
| DL-02 | Phase 40 | Pending |
| DL-03 | Phase 40 | Pending |
| SYNC-01 | Phase 40 | Pending |
| SYNC-02 | Phase 40 | Pending |
| SYNC-03 | Phase 40 | Pending |
| SYNC-04 | Phase 40 | Pending |
| TOOL-01 | Phase 40 | Pending |
| TOOL-02 | Phase 40 | Pending |
| TOOL-03 | Phase 40 | Pending |

**Coverage:**
- v3.1 requirements: 10 total
- Mapped to phases: 10 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-02-09 after roadmap creation*
