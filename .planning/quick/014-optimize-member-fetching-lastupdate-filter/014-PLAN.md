---
phase: quick
plan: 014
type: execute
wave: 1
depends_on: []
files_modified:
  - download-functions-from-sportlink.js
  - sync-functions.js
  - scripts/install-cron.sh
  - CLAUDE.md
  - README.md
autonomous: true
must_haves:
  truths:
    - "Daily functions sync only processes members updated today or yesterday"
    - "Weekly full sync processes all tracked members"
    - "Cron schedules reflect daily (recent-only) and weekly (full) patterns"
  artifacts:
    - path: "download-functions-from-sportlink.js"
      provides: "Member filtering by LastUpdate"
      contains: "filterRecentlyUpdated"
    - path: "sync-functions.js"
      provides: "--all flag for full sync mode"
      contains: "all"
    - path: "scripts/install-cron.sh"
      provides: "Weekly full sync at Sunday 1AM"
      contains: "1 0 * * 0"
  key_links:
    - from: "sync-functions.js"
      to: "download-functions-from-sportlink.js"
      via: "recentOnly option"
---

<objective>
Optimize member fetching performance by filtering based on LastUpdate field

Purpose: Reduce daily sync time by only fetching detailed pages (/other, /financial, /functions) for members updated in Sportlink within the last 2 days. Full sync runs weekly to catch any edge cases.

Output: Modified sync scripts with LastUpdate filtering, updated cron schedules
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@download-functions-from-sportlink.js
@sync-functions.js
@scripts/install-cron.sh
@laposta-db.js (getLatestSportlinkResults provides SearchMembers JSON with LastUpdate)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add LastUpdate filtering to download-functions-from-sportlink.js</name>
  <files>
    download-functions-from-sportlink.js
    laposta-db.js
  </files>
  <action>
1. Add helper function `filterRecentlyUpdated(members, memberDataMap)`:
   - Takes array of tracked members (knvb_id, stadion_id)
   - Takes Map of knvb_id -> member data from SearchMembers JSON (includes LastUpdate)
   - Returns only members where LastUpdate is today or yesterday
   - LastUpdate format from Sportlink: "YYYY-MM-DD" or similar date string

2. Modify `runFunctionsDownload()`:
   - Add new option `recentOnly` (default: true for daily runs)
   - If `recentOnly` is true:
     a. Load latest Sportlink results from laposta-sync.sqlite using getLatestSportlinkResults()
     b. Parse JSON, extract Members array
     c. Build Map of PublicPersonId -> member data (includes LastUpdate)
     d. Filter tracked members to only those with LastUpdate in last 2 days
   - If `recentOnly` is false (--all flag): process all tracked members as before
   - Log: "Processing X of Y members (recent updates only)" or "Processing X members (full sync)"

3. Update CLI entry point:
   - Add `--all` flag detection: `const all = process.argv.includes('--all')`
   - Pass `recentOnly: !all` to runFunctionsDownload

Note: The PublicPersonId in SearchMembers corresponds to knvb_id in our database.
  </action>
  <verify>
    node download-functions-from-sportlink.js --verbose (should show "recent updates only" message)
    node download-functions-from-sportlink.js --all --verbose (should show "full sync" message)
  </verify>
  <done>
    Daily runs filter to recently updated members; --all flag processes all members
  </done>
</task>

<task type="auto">
  <name>Task 2: Update sync-functions.js and cron schedules</name>
  <files>
    sync-functions.js
    scripts/install-cron.sh
  </files>
  <action>
1. Modify sync-functions.js:
   - Add `all` option to runFunctionsSync
   - Pass `recentOnly: !all` to runFunctionsDownload
   - Update CLI to detect --all flag
   - Update summary to indicate sync mode (recent vs full)

2. Modify scripts/install-cron.sh:
   - Keep daily functions sync at 7:15 AM (uses default recentOnly mode)
   - Add weekly full sync: Sunday 1:00 AM with --all flag
   - Update echo messages to reflect two schedules:
     * "Functions sync (recent): daily at 7:15 AM"
     * "Functions sync (full): weekly on Sunday at 1:00 AM"

Cron entries:
```
# Functions sync (recent): daily at 7:15 AM
15 7 * * * $PROJECT_DIR/scripts/sync.sh functions

# Functions sync (full): weekly on Sunday at 1:00 AM
0 1 * * 0 $PROJECT_DIR/scripts/sync.sh functions --all
```
  </action>
  <verify>
    grep -A2 "Functions sync" scripts/install-cron.sh (shows both daily and weekly)
  </verify>
  <done>
    Daily sync runs recent-only mode; weekly Sunday 1AM runs full mode
  </done>
</task>

<task type="auto">
  <name>Task 3: Update documentation</name>
  <files>
    CLAUDE.md
    README.md
  </files>
  <action>
1. Update CLAUDE.md:
   - Update "Functions Pipeline" description in sync architecture section
   - Update cron schedules section to show both daily (recent) and weekly (full) schedules
   - Note the optimization: "Daily functions sync only processes members updated in Sportlink within the last 2 days. Full sync runs weekly to catch edge cases."

2. Update README.md:
   - Update schedule description in cron section
   - Document --all flag for scripts/sync.sh functions
  </action>
  <verify>
    grep -i "recent\|full" CLAUDE.md (shows optimization documented)
  </verify>
  <done>
    Documentation reflects new LastUpdate filtering optimization and schedules
  </done>
</task>

</tasks>

<verification>
- Daily sync filters members by LastUpdate
- --all flag processes all members
- Cron schedules show daily (7:15 AM) and weekly (Sunday 1 AM --all)
- Documentation updated
</verification>

<success_criteria>
- download-functions-from-sportlink.js has filterRecentlyUpdated function
- sync-functions.js accepts --all flag
- install-cron.sh has two functions sync schedules
- CLAUDE.md and README.md document the optimization
</success_criteria>

<output>
After completion, create `.planning/quick/014-optimize-member-fetching-lastupdate-filter/014-SUMMARY.md`
</output>
