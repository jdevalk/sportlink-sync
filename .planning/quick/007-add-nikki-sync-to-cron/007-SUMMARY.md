---
phase: quick
plan: 007
title: "Add Nikki Sync to Cron Automation"
subsystem: sync-orchestration
tags: [nikki, cron, automation, orchestration]

dependencies:
  requires:
    - download-nikki-contributions.js
    - sync-nikki-to-stadion.js
  provides:
    - sync-nikki.js orchestration
    - nikki cron schedule
    - npm sync-nikki commands
  affects:
    - daily-automation

tech-stack:
  added: []
  patterns:
    - orchestration-script
    - cron-integration

file-tracking:
  created:
    - sync-nikki.js
  modified:
    - scripts/sync.sh
    - scripts/install-cron.sh
    - package.json

decisions:
  - id: quick-007-1
    choice: "Schedule nikki sync daily at 7:00 AM (after photos at 6:00 AM)"
    rationale: "Nikki contributions don't change frequently; daily sync is sufficient"
  - id: quick-007-2
    choice: "Follow sync-functions.js orchestration pattern"
    rationale: "Consistent pattern across all sync orchestrators"

metrics:
  duration: 2m
  tasks-completed: 3
  commits: 3
  completed: 2026-01-28
---

# Quick Task 007: Add Nikki Sync to Cron Automation

**One-liner:** Nikki contribution sync now runs daily at 7 AM via cron automation

## Summary

Created `sync-nikki.js` orchestration script following the established pattern from `sync-functions.js`. The script coordinates downloading Nikki contribution data and syncing it to Stadion WordPress. Integrated nikki sync into the unified `sync.sh` wrapper and added it to the cron schedule at 7:00 AM daily (after photo sync at 6:00 AM).

## Tasks Completed

### Task 1: Create sync-nikki.js orchestration script
**Commit:** 6fe46ca

Created orchestration script that:
- Imports `runNikkiDownload` and `runNikkiStadionSync`
- Creates logger with 'nikki' prefix
- Runs download step, captures stats (count, success)
- Runs stadion sync step, captures stats (updated, skipped, errors, noStadionId)
- Prints formatted summary report
- Exports `runNikkiSync` function
- CLI entry point with `--verbose` and `--force` flags

Summary report format matches other sync scripts for consistency.

**Files created:**
- sync-nikki.js

### Task 2: Add nikki case to sync.sh and install-cron.sh
**Commit:** b960e7f

**scripts/sync.sh:**
- Added 'nikki' to usage comment
- Added 'nikki' to sync type validation case
- Added nikki case to script selection (runs sync-nikki.js)

**scripts/install-cron.sh:**
- Updated intro to mention 5 schedules (was 4)
- Added cron entry: `0 7 * * * $PROJECT_DIR/scripts/sync.sh nikki`
- Updated "Scheduled jobs" output to include nikki
- Updated manual sync help text to include nikki option

**Files modified:**
- scripts/sync.sh
- scripts/install-cron.sh

### Task 3: Add npm scripts for manual nikki sync
**Commit:** 2b41119

Added to package.json scripts section:
- `sync-nikki`: runs `node sync-nikki.js`
- `sync-nikki-verbose`: runs with `--verbose` flag

Placed near other sync-* scripts for organization.

**Files modified:**
- package.json

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **Nikki sync schedule: Daily at 7:00 AM**
   - Runs after photo sync (6:00 AM) to stagger automation
   - Daily frequency sufficient for contribution data that doesn't change hourly
   - Consistent with photo sync pattern (daily morning automation)

2. **Orchestration pattern: Follow sync-functions.js**
   - Same structure: logger creation, step-by-step execution, stats tracking
   - Same summary format: dividers, sections, error reporting
   - Maintains codebase consistency

## Technical Details

### Orchestration Flow

```
sync-nikki.js
  ├── runNikkiDownload()
  │   └── Downloads contribution data from nikki-online.nl
  │       (browser automation, scrapes /leden table)
  └── runNikkiStadionSync()
      └── Updates Stadion member WYSIWYG field
          (hash-based change detection)
```

### Cron Schedule

After `npm run install-cron`:
```
0 * * * *   sync.sh people     # Hourly
0 6 * * *   sync.sh photos     # Daily 6 AM
0 7 * * *   sync.sh nikki      # Daily 7 AM (NEW)
0 6 * * 0   sync.sh teams      # Weekly Sunday 6 AM
0 7 * * 0   sync.sh functions  # Weekly Sunday 7 AM
```

### CLI Usage

Manual execution:
```bash
npm run sync-nikki              # Standard output
npm run sync-nikki-verbose      # Detailed logging
scripts/sync.sh nikki           # Via wrapper (for testing cron behavior)
```

## Next Phase Readiness

**Ready to proceed:** Yes

**Blockers:** None

**Integration notes:**
- Nikki sync is now fully integrated into the cron automation stack
- Email reports will be sent after each sync via Postmark
- Logs stored in `logs/cron/sync-nikki-*.log`
- Flock locking prevents overlapping executions

## Verification

- [x] sync-nikki.js exists and exports runNikkiSync
- [x] scripts/sync.sh accepts 'nikki' as sync type
- [x] scripts/install-cron.sh includes nikki in schedule (daily 7 AM)
- [x] npm run sync-nikki runs the orchestration script
- [x] All tasks committed atomically with proper messages

## Success Criteria Met

- [x] Can be run manually: `npm run sync-nikki`
- [x] Can be run via wrapper: `scripts/sync.sh nikki`
- [x] Will be scheduled daily at 7 AM when install-cron.sh is run
- [x] Produces email-ready summary like other sync types
