---
phase: quick
plan: 005
type: execute
wave: 1
depends_on: []
files_modified:
  - sync-functions.js
  - scripts/sync.sh
  - scripts/install-cron.sh
autonomous: true
---

<objective>
Add functions/commissies sync to the weekly cron schedule

Purpose: Enable automated weekly sync of member functions and committee memberships from Sportlink to Stadion WordPress, alongside the existing team sync.

Output: Working `sync-functions.js` orchestration script, updated `sync.sh` supporting `functions` type, and updated `install-cron.sh` with weekly functions sync.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
Existing pipeline components:
- `download-functions-from-sportlink.js` - downloads member functions/committees via browser automation
- `submit-stadion-commissies.js` - syncs commissies to WordPress (`runSync` export)
- `submit-stadion-commissie-work-history.js` - syncs work history to people (`runSync` export)

Pattern to follow:
- `sync-teams.js` - orchestrates team download + team sync + work history sync with summary output

Current cron setup in `install-cron.sh`:
- People sync: hourly
- Photo sync: daily at 6:00 AM
- Team sync: weekly on Sunday at 6:00 AM

Current `sync.sh` supports: people, photos, teams, all
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create sync-functions.js orchestration script</name>
  <files>sync-functions.js</files>
  <action>
Create `sync-functions.js` following the pattern of `sync-teams.js`:

1. Import required modules:
   - `createSyncLogger` from `./lib/logger`
   - `runFunctionsDownload` from `./download-functions-from-sportlink`
   - `runSync` as `runCommissiesSync` from `./submit-stadion-commissies`
   - `runSync` as `runCommissieWorkHistorySync` from `./submit-stadion-commissie-work-history`
   - Database functions for getting commissie names (for orphan detection)

2. Create `formatDuration(ms)` helper (copy from sync-teams.js)

3. Create `printSummary(logger, stats)` function with sections:
   - FUNCTIONS SYNC SUMMARY header
   - FUNCTIONS DOWNLOAD (functionsCount, committeesCount, errors)
   - COMMISSIES SYNC TO STADION (created, updated, skipped, deleted)
   - COMMISSIE WORK HISTORY SYNC (created, ended, skipped)
   - ERRORS section if any

4. Create `runFunctionsSync(options = {})` async function:
   - Accept { verbose, force } options
   - Create logger with prefix 'functions'
   - Initialize stats object tracking all phases
   - Step 1: Download functions from Sportlink via `runFunctionsDownload`
   - Step 2: Sync commissies to Stadion via `runCommissiesSync` (pass currentCommissieNames for orphan detection)
   - Step 3: Sync commissie work history via `runCommissieWorkHistorySync`
   - Print summary, return { success, stats }

5. Export `runFunctionsSync`

6. CLI entry point: `if (require.main === module)` with --verbose and --force flags
  </action>
  <verify>
Run `node sync-functions.js --verbose` on the server - should complete without errors (may show "No tracked members" if database is empty locally, that's fine)
  </verify>
  <done>
`sync-functions.js` exists, exports `runFunctionsSync`, follows same pattern as `sync-teams.js`
  </done>
</task>

<task type="auto">
  <name>Task 2: Update sync.sh to support functions type</name>
  <files>scripts/sync.sh</files>
  <action>
Update `scripts/sync.sh` to support the `functions` sync type:

1. Update the case statement validation (line ~32) to include `functions`:
   ```bash
   case "$SYNC_TYPE" in
       people|photos|teams|functions|all)
   ```

2. Update the script selection case statement (line ~73) to add functions:
   ```bash
   functions)
       SYNC_SCRIPT="sync-functions.js"
       ;;
   ```

3. Update the usage message (line ~36) to include functions:
   ```bash
   echo "Usage: $0 {people|photos|teams|functions|all}" >&2
   ```

4. Update the script header comment to document functions:
   ```bash
   #   sync.sh functions  # Weekly: functions download + commissies + work history
   ```
  </action>
  <verify>
Run `./scripts/sync.sh functions` - should execute sync-functions.js (may fail if not on server, but should at least invoke the script)
  </verify>
  <done>
`sync.sh` accepts `functions` as valid sync type and routes to `sync-functions.js`
  </done>
</task>

<task type="auto">
  <name>Task 3: Update install-cron.sh to add weekly functions sync</name>
  <files>scripts/install-cron.sh</files>
  <action>
Update `scripts/install-cron.sh` to include the weekly functions sync:

1. Update the intro message (line ~11-15) to include functions:
   ```bash
   echo "This will set up four sync schedules:"
   echo "  - People sync:    hourly (members, parents, birthdays)"
   echo "  - Photo sync:     daily at 6:00 AM"
   echo "  - Team sync:      weekly on Sunday at 6:00 AM"
   echo "  - Functions sync: weekly on Sunday at 7:00 AM"
   ```

2. Update CRON_ENTRIES (line ~101-113) to add functions:
   ```bash
   CRON_ENTRIES="
   # Sportlink Sync automation (installed $(date +%Y-%m-%d))
   CRON_TZ=Europe/Amsterdam

   # People sync: hourly (download, laposta, stadion members, birthdays)
   0 * * * * $PROJECT_DIR/scripts/sync.sh people

   # Photo sync: daily at 6:00 AM
   0 6 * * * $PROJECT_DIR/scripts/sync.sh photos

   # Team sync: weekly on Sunday at 6:00 AM
   0 6 * * 0 $PROJECT_DIR/scripts/sync.sh teams

   # Functions sync: weekly on Sunday at 7:00 AM (after teams)
   0 7 * * 0 $PROJECT_DIR/scripts/sync.sh functions
   "
   ```

3. Update the success message (line ~120-124):
   ```bash
   echo "Scheduled jobs:"
   echo "  - People sync:    every hour (members, parents, birthdays)"
   echo "  - Photo sync:     daily at 6:00 AM"
   echo "  - Team sync:      weekly on Sunday at 6:00 AM"
   echo "  - Functions sync: weekly on Sunday at 7:00 AM"
   ```

4. Update the manual sync help line (line ~134):
   ```bash
   echo "  Manual sync:                $PROJECT_DIR/scripts/sync.sh {people|photos|teams|functions|all}"
   ```

Note: Functions sync runs at 7:00 AM (1 hour after teams) to avoid overlapping browser sessions with Sportlink.
  </action>
  <verify>
Review `scripts/install-cron.sh` - should show four sync types in documentation and CRON_ENTRIES
  </verify>
  <done>
`install-cron.sh` installs weekly functions sync cron job at 7:00 AM on Sundays
  </done>
</task>

</tasks>

<verification>
After all tasks complete:
1. `node sync-functions.js --verbose` runs without syntax errors
2. `./scripts/sync.sh` shows `functions` in usage message
3. `./scripts/install-cron.sh` (dry read) shows four sync schedules including functions at 7:00 AM Sunday
</verification>

<success_criteria>
- `sync-functions.js` orchestrates: download -> commissies sync -> work history sync
- `sync.sh` routes `functions` type to `sync-functions.js`
- `install-cron.sh` adds weekly functions sync to cron schedule
- All scripts follow existing code patterns and conventions
</success_criteria>

<output>
After completion, create `.planning/quick/005-add-functions-sync-to-cron/005-SUMMARY.md`
</output>
