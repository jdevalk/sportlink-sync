# Requirements: Sportlink Sync

**Defined:** 2026-01-24
**Core Value:** Keep Laposta email lists automatically in sync with Sportlink member data without manual intervention.

## v1 Requirements

### Automation

- [x] **AUTO-01**: Cron job runs `npm run sync-all` daily
- [x] **AUTO-02**: Crontab entry with MAILTO configured for email reports

### Output

- [x] **OUT-01**: Sync produces concise summary (not verbose progress messages)
- [x] **OUT-02**: Summary shows: sync timestamp, members processed per list, errors if any
- [x] **OUT-03**: Output is clean enough for cron MAILTO delivery

## v2 Requirements

(None planned)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Slack/Discord notifications | Cron MAILTO is sufficient for now |
| Web dashboard | CLI tool with email reports meets operator needs |
| Real-time sync | Batch sync is appropriate for member data |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OUT-01 | Phase 1 | Complete |
| OUT-02 | Phase 1 | Complete |
| OUT-03 | Phase 1 | Complete |
| AUTO-01 | Phase 2 | Complete |
| AUTO-02 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: 5 total
- Mapped to phases: 5
- Unmapped: 0

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-24 after Phase 2 completion*
