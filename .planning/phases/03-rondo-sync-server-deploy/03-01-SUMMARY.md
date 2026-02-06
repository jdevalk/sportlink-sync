---
phase: 03-rondo-sync-server-deploy
plan: 01
subsystem: infra
tags: [ssh, sqlite, cron, deploy, env-migration]

# Dependency graph
requires:
  - phase: 01-rondo-club-code-rename
    provides: "/rondo/v1/ API endpoint on production WordPress"
  - phase: 02-rondo-sync-code-rename
    provides: "Renamed code using RONDO_* env vars and rondo/v1 API paths"
provides:
  - "Production server running Rondo Sync with RONDO_* env vars"
  - "Database at data/rondo-sync.sqlite"
  - "Cron jobs active and running renamed code"
affects: [04-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["stop-service migration with backup-before-modify"]

key-files:
  created: []
  modified:
    - "steps/submit-rondo-club-sync.js"
    - "steps/download-functions-from-sportlink.js"
    - "pipelines/sync-all.js"
    - "pipelines/sync-nikki.js"

key-decisions:
  - "Copy database within data/ (already migrated from root) rather than from root as planned"
  - "Deploy Phase 1 to WordPress production as prerequisite (was not yet deployed)"

patterns-established:
  - "Coordinated deploy: disable cron → migrate → deploy → verify sync → re-enable cron"

# Metrics
duration: 25 min
completed: 2026-02-06
---

# Phase 3 Plan 1: Coordinated Server Deploy Summary

**Production server at 46.202.155.16 fully transitioned: RONDO_* env vars, data/rondo-sync.sqlite database, renamed code deployed, full sync verified across all pipelines**

## Performance

- **Duration:** 25 min
- **Started:** 2026-02-06T18:20:00Z
- **Completed:** 2026-02-06T18:55:00Z
- **Tasks:** 3
- **Files modified:** 4 (bug fixes discovered during deploy)

## Accomplishments
- Production server .env updated from STADION_* to RONDO_* variables (backup at .env.pre-rondo)
- Database copied to data/rondo-sync.sqlite (old stadion-sync.sqlite preserved as backup)
- Phase 2 renamed code deployed via git pull
- Full sync completed: 1068 members, 61 teams, 1062 FreeScout customers, 106 discipline cases
- Cron jobs re-enabled after successful verification
- Phase 1 (Rondo Club WordPress) deployed to production as prerequisite

## Task Commits

Each task was committed atomically:

1. **Task 1: Push code + pre-flight checks** - no local commit (SSH operations + git push)
2. **Task 2: Disable cron, deploy, migrate, update .env** - no local commit (SSH operations)
3. **Task 3: Verification sync + checkpoint** - no local commit (SSH operations)

**Bug fixes discovered during deploy:**
- `ab53f8d` fix(03-01): rename 3 missed stadion/v1 API paths to rondo/v1
- `1d80787` fix(03-01): rename stats.stadion to stats.rondoClub in pipeline files

## Files Created/Modified
- `steps/submit-rondo-club-sync.js` - Fixed 2 missed stadion/v1 API path references
- `steps/download-functions-from-sportlink.js` - Fixed 1 missed stadion/v1 API path reference
- `pipelines/sync-all.js` - Fixed stats.stadion → stats.rondoClub (crash fix)
- `pipelines/sync-nikki.js` - Fixed stats.stadion → stats.rondoClub + summary header

## Decisions Made
- Databases were already in data/ directory (not at root as plan assumed) — adapted migration to copy within data/
- Phase 1 WordPress deploy was required first — deployed via bin/deploy.sh before proceeding
- Cron restored from backup file after sed-based restore failed on empty crontab

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 3 missed stadion/v1 API path references**
- **Found during:** Task 1 (pre-flight checks)
- **Issue:** Phase 2 missed renaming 3 API path strings in submit-rondo-club-sync.js and download-functions-from-sportlink.js
- **Fix:** Changed `stadion/v1` to `rondo/v1` in all 3 locations
- **Committed in:** ab53f8d

**2. [Rule 1 - Bug] stats.stadion property name not renamed**
- **Found during:** Task 3 (verification sync crashed with "Cannot set properties of undefined")
- **Issue:** sync-all.js and sync-nikki.js initialized stats with `stadion:` key but all references used `rondoClub`
- **Fix:** Renamed property key in stats initialization
- **Committed in:** 1d80787

**3. [Rule 3 - Blocking] Phase 1 not deployed to production**
- **Found during:** Task 1 (pre-flight API check returned 404 for /rondo/v1/)
- **Issue:** Production WordPress still served /stadion/v1/ — Phase 1 code rename had not been deployed
- **Fix:** Built frontend assets and ran bin/deploy.sh to deploy Phase 1 to production
- **No commit:** Deployment operation only

**4. [Adapted] Database location different from plan**
- **Found during:** Task 1 (pre-flight check showed databases already in data/)
- **Issue:** Plan assumed databases at /home/sportlink/*.sqlite but they were already in /home/sportlink/data/
- **Fix:** Adapted Step 3 to copy within data/ directory instead of from root
- **No commit:** SSH operation only

---

**Total deviations:** 4 (2 bug fixes committed, 1 blocking deploy fix, 1 plan adaptation)
**Impact on plan:** All fixes necessary for successful deploy. No scope creep.

## Issues Encountered
- Cron restore via sed failed (produced empty crontab) — restored from /tmp/crontab.backup instead
- 16 pre-existing errors in sync: 15 photo download 401s (Sportlink auth issue), 1 deleted person 410 — none related to deploy

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Server fully operational with renamed code and env vars
- All sync pipelines verified working
- Ready for Phase 4 (Documentation)

---
*Phase: 03-rondo-sync-server-deploy*
*Completed: 2026-02-06*
