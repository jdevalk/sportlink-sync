# Requirements: Sportlink Sync

**Defined:** 2026-01-25
**Core Value:** Keep Laposta email lists automatically in sync with Sportlink member data without manual intervention

## v1.2 Requirements

Requirements for Email Improvements milestone.

### Email Formatting

- [x] **EMAIL-06**: Sync reports are sent as HTML email with proper formatting
- [x] **EMAIL-07**: Email from name displays as "Sportlink SYNC"
- [x] **EMAIL-08**: Email body does not include npm script execution header

### Installer

- [x] **INST-01**: Running install-cron replaces existing sportlink-sync cron entries instead of adding duplicates

## Future Requirements

None planned - define in next milestone.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fallback to plain text | HTML with text fallback is sufficient |
| Configurable from name | "Sportlink SYNC" is appropriate for all deployments |
| Email templates | Simple inline HTML is sufficient for sync reports |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EMAIL-06 | Phase 4 | Complete |
| EMAIL-07 | Phase 4 | Complete |
| EMAIL-08 | Phase 4 | Complete |
| INST-01 | Phase 4 | Complete |

**Coverage:**
- v1.2 requirements: 4 total
- Mapped to phases: 4
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-25*
*Last updated: 2026-01-25 after Phase 4 completion*
