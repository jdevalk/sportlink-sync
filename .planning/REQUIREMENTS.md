# Requirements: Sportlink Sync

**Defined:** 2026-01-24
**Core Value:** Keep Laposta email lists automatically in sync with Sportlink member data without manual intervention.

## v1 Requirements

### Automation

- [ ] **AUTO-01**: Cron job runs `npm run sync-all` daily
- [ ] **AUTO-02**: Crontab entry with MAILTO configured for email reports

### Output

- [ ] **OUT-01**: Sync produces concise summary (not verbose progress messages)
- [ ] **OUT-02**: Summary shows: sync timestamp, members processed per list, errors if any
- [ ] **OUT-03**: Output is clean enough for cron MAILTO delivery

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
| AUTO-01 | TBD | Pending |
| AUTO-02 | TBD | Pending |
| OUT-01 | TBD | Pending |
| OUT-02 | TBD | Pending |
| OUT-03 | TBD | Pending |

**Coverage:**
- v1 requirements: 5 total
- Mapped to phases: 0
- Unmapped: 5 ⚠️

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-24 after initial definition*
