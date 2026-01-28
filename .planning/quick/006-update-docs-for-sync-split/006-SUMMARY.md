---
task: 006-update-docs-for-sync-split
type: quick
subsystem: documentation
completed: 2026-01-28
duration: 2 minutes
tags: [documentation, sync-architecture, cron]

provides:
  - Updated documentation reflecting split sync architecture
  - Four separate pipeline documentation (people/photos/teams/functions)
  - scripts/sync.sh as primary sync interface

affects:
  - Developer onboarding (accurate architecture docs)
  - Operations (correct cron setup instructions)

tech-stack:
  removed:
    - scripts/cron-wrapper.sh (obsolete, replaced by sync.sh)

key-files:
  modified:
    - CLAUDE.md (internal developer docs)
    - README.md (user-facing docs)
  deleted:
    - scripts/cron-wrapper.sh (obsolete wrapper)

decisions:
  - decision: Document sync.sh as primary sync interface
    rationale: sync.sh is the unified wrapper used by all cron jobs
    date: 2026-01-28

  - decision: Keep sync-all.js documented as "full sync" option
    rationale: Still useful for manual full syncs and initial setup
    date: 2026-01-28

  - decision: Remove cron-wrapper.sh
    rationale: Obsolete; replaced by sync.sh which supports all sync types
    date: 2026-01-28
---

# Quick Task 006: Update Documentation for Sync Split

**One-liner:** Updated CLAUDE.md and README.md to accurately reflect the split sync architecture with four independent pipelines instead of monolithic sync-all.

## Objective

Update documentation to reflect the new sync architecture: split syncs (people, photos, teams, functions) instead of monolithic sync-all. Documentation was out of date and referenced the old sync-all approach when the sync has been split into four separate pipelines with a unified sync.sh wrapper.

## Changes Made

### Task 1: Update CLAUDE.md for new sync architecture
**Commit:** 0fd562d

Updated CLAUDE.md to reflect split sync architecture:

1. **Quick Reference section** - Changed from monolithic sync-all to four separate sync commands via sync.sh
2. **Sync Pipeline section** - Restructured to document four independent pipelines:
   - People Pipeline (hourly): download → prepare-laposta → submit-laposta → submit-stadion → birthdays
   - Photo Pipeline (daily): download-photos → upload-photos
   - Team Pipeline (weekly): download-teams → submit-teams → work-history
   - Functions Pipeline (weekly): download-functions → commissies → commissie-work-history
3. **Cron Automation section** - Updated to show four schedules:
   - People: hourly
   - Photos: daily 6:00 AM
   - Teams: weekly Sunday 6:00 AM
   - Functions: weekly Sunday 7:00 AM
4. **Supporting Files** - Updated cron-wrapper.sh reference to sync.sh
5. **Data Flow diagram** - Updated to show four parallel pipelines instead of one linear flow
6. **Development section** - Added sync.sh commands as primary sync method

**Files modified:** CLAUDE.md

### Task 2: Update README.md for new sync architecture
**Commit:** 6ce5f04

Updated README.md to match the new architecture:

1. **Quick Reference section** - Updated to show sync.sh commands as primary interface
2. **Architecture > Sync Pipeline section** - Restructured to show four independent pipelines with clear descriptions
3. **Usage section** - Renamed "One-step full sync" to "Running syncs" and documented:
   - Individual pipeline commands (recommended for production)
   - Full sync option (scripts/sync.sh all or npm run sync-all)
4. **Automated daily sync section** - Updated to "Automated sync schedules" with four schedules
5. **Data Flow diagram** - Updated to show four parallel pipelines with separate email reports
6. **Supporting Files** - Updated cron-wrapper.sh reference to sync.sh

**Files modified:** README.md

### Task 3: Delete obsolete cron-wrapper.sh
**Commit:** bf21321

Deleted scripts/cron-wrapper.sh as it's been superseded by scripts/sync.sh.

The cron-wrapper.sh:
- Still referenced sync-all.js directly
- Has been replaced by sync.sh which supports all sync types (people|photos|teams|functions|all)
- Is no longer referenced by install-cron.sh

**Files deleted:** scripts/cron-wrapper.sh

## Verification Results

All verification checks passed:

1. ✅ **sync-all mentions** - Found only in context of "full sync" option (not as primary method)
2. ✅ **sync.sh mentions** - Documented as primary sync interface in both CLAUDE.md and README.md
3. ✅ **cron-wrapper references** - None found in documentation (clean removal)
4. ✅ **cron-wrapper.sh file** - Does not exist (successfully deleted)
5. ✅ **Quick scan** - Both docs accurately reflect current architecture

## Deviations from Plan

None - plan executed exactly as written.

## Technical Details

### Documentation Structure

**CLAUDE.md (developer docs):**
- Quick Reference with sync.sh commands
- Four pipeline architecture clearly documented
- Cron schedules with frequencies
- Data flow diagram showing parallel pipelines
- Development section with sync.sh as primary interface

**README.md (user-facing docs):**
- Quick Reference emphasizing individual pipelines as "recommended"
- Four pipeline architecture with step-by-step breakdowns
- Updated Usage section with clear production recommendations
- Automated sync schedules section with four cron jobs
- Data flow diagram showing independent pipelines with email reports

### Sync Architecture (as documented)

**People Pipeline (hourly):**
- download-data-from-sportlink.js
- prepare-laposta-members.js
- submit-laposta-list.js
- submit-stadion-sync.js
- sync-important-dates.js

**Photo Pipeline (daily):**
- download-photos-from-sportlink.js
- upload-photos-to-stadion.js

**Team Pipeline (weekly):**
- download-teams-from-sportlink.js
- submit-stadion-teams.js
- submit-stadion-work-history.js

**Functions Pipeline (weekly):**
- download-functions-from-sportlink.js
- submit-stadion-commissies.js
- submit-stadion-commissie-work-history.js

### Cron Schedules (as documented)

- **People:** Hourly (0 * * * *)
- **Photos:** Daily at 6:00 AM (0 6 * * *)
- **Teams:** Weekly Sunday at 6:00 AM (0 6 * * 0)
- **Functions:** Weekly Sunday at 7:00 AM (0 7 * * 0)

All times in Europe/Amsterdam timezone.

## Impact

### Positive Impact

1. **Developer onboarding** - New developers see accurate architecture documentation
2. **Operations** - Correct cron setup instructions prevent confusion
3. **Documentation accuracy** - Docs match actual implementation
4. **Code cleanliness** - Removed obsolete cron-wrapper.sh
5. **Architecture clarity** - Four independent pipelines clearly documented

### Documentation Accuracy

Before: Documentation referenced monolithic sync-all as primary approach
After: Documentation reflects split sync architecture with four independent pipelines

## Next Steps

None required - documentation is now accurate and complete.

## Lessons Learned

1. **Documentation drift** - Documentation can quickly become outdated after architectural changes
2. **Quick task value** - Small documentation updates improve developer experience significantly
3. **Verification importance** - Grep checks confirm clean removal of obsolete references

## Related Work

- Quick task 005: Added functions sync to cron (added fourth pipeline)
- Phase 15: Implemented commissies/functions sync (architectural split)
- Phase 14: Implemented team sync (architectural split)
- Phase 13: Implemented photo sync (architectural split)

## Success Metrics

- ✅ CLAUDE.md documents sync.sh as primary sync interface
- ✅ README.md documents four pipelines clearly
- ✅ Both docs show correct cron schedules (hourly, daily, weekly x2)
- ✅ cron-wrapper.sh deleted
- ✅ No broken references in documentation
- ✅ All verification checks passed

**Completion time:** 2 minutes
**Commits:** 3 (one per task)
**Files modified:** 2 (CLAUDE.md, README.md)
**Files deleted:** 1 (scripts/cron-wrapper.sh)
