---
phase: quick-19
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/schedule.js
  - lib/dashboard-queries.js
  - views/overview.ejs
  - public/style.css
autonomous: true
must_haves:
  truths:
    - "Each pipeline card on the dashboard shows the next planned run time"
    - "Next run times are accurate based on the cron schedule in install-cron.sh"
    - "Times are shown in Amsterdam timezone"
    - "The reverse pipeline is excluded (it runs hourly, not meaningful to show)"
  artifacts:
    - path: "lib/schedule.js"
      provides: "Schedule definitions and next-run-time calculator"
      exports: ["getNextRun", "PIPELINE_SCHEDULES"]
    - path: "lib/dashboard-queries.js"
      provides: "Pipeline overview with nextRun field added"
    - path: "views/overview.ejs"
      provides: "Dashboard UI showing next run time per pipeline card"
  key_links:
    - from: "lib/dashboard-queries.js"
      to: "lib/schedule.js"
      via: "require and getNextRun() call"
      pattern: "getNextRun.*pipeline"
    - from: "views/overview.ejs"
      to: "pipeline.nextRun"
      via: "template variable"
      pattern: "pipeline\\.nextRun"
---

<objective>
Show the next planned run time for each pipeline on the dashboard overview page.

Purpose: Users can see at a glance when each pipeline will next run, reducing uncertainty about sync timing and making the dashboard more informative.
Output: Each pipeline card displays a "Next run:" line with the computed next scheduled run time.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/dashboard-queries.js
@lib/web-server.js
@views/overview.ejs
@public/style.css
@scripts/install-cron.sh
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create schedule module with next-run calculator</name>
  <files>lib/schedule.js</files>
  <action>
Create `lib/schedule.js` that defines the cron schedules for each pipeline and computes the next run time. This must be a pure computation module (no DB, no side effects).

Define `PIPELINE_SCHEDULES` as a map of pipeline name to schedule definition. The schedules are (all times Europe/Amsterdam):

- **people**: 4x daily at 08:00, 11:00, 14:00, 17:00 (every day)
- **nikki**: daily at 07:00
- **freescout**: daily at 08:00
- **teams**: weekly on Sunday at 06:00
- **functions**: 4x daily at 07:30, 10:30, 13:30, 16:30 (every day) — note: also has weekly full sync Sunday 01:00, but the "recent" schedule is more frequent so drives the "next run"
- **discipline**: weekly on Monday at 23:30

Do NOT include `reverse` (hourly is not meaningful to show).

Each schedule entry should have:
- `times`: array of `{ hour, minute }` objects for daily/4x-daily schedules
- `dayOfWeek`: null for daily, 0 for Sunday, 1 for Monday (matching JS Date.getDay())
- `label`: human-readable schedule description like "4x daily" or "Weekly (Sun)"

Implement `getNextRun(pipelineName, now)` that:
1. Gets the schedule for the pipeline
2. Uses `now` (defaults to `new Date()`) as the reference time
3. Converts to Amsterdam timezone using `Intl.DateTimeFormat` with `timeZone: 'Europe/Amsterdam'` to extract current Amsterdam hour, minute, day-of-week
4. For daily schedules: finds the next time slot today that hasn't passed yet; if all have passed, returns first slot tomorrow
5. For weekly schedules: if today is the correct day and the time hasn't passed, returns today's time; otherwise returns next occurrence of that day
6. Returns an object `{ time: Date, label: string }` where `time` is a JS Date in UTC representing the Amsterdam-local scheduled time, and `label` is the schedule description

Key implementation detail for timezone: To construct the correct UTC Date for "next Amsterdam 08:00", use this approach:
- Create a date string like `2026-02-10T08:00:00` and parse it as Amsterdam time by using a helper that offsets correctly. The simplest reliable approach: use `toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })` on `now` to get Amsterdam local time components, do the "next occurrence" math on those components, then construct the target Amsterdam datetime as an ISO string and use `new Date(isoString)` with the known Amsterdam UTC offset (CET = +1, CEST = +2). To determine which offset applies, check if a date in that range is in DST by comparing formatted hour with UTC hour.

Actually, the simplest correct approach: compute the target Amsterdam wall-clock datetime, format as `YYYY-MM-DDTHH:MM:00`, and then find the UTC equivalent by trial: create `new Date('YYYY-MM-DDTHH:MM:00+01:00')` and `new Date('YYYY-MM-DDTHH:MM:00+02:00')`, check which one when formatted back to Amsterdam gives the right hour. This handles DST transitions correctly.

Export `{ getNextRun, PIPELINE_SCHEDULES }`.

Include CLI self-test: `if (require.main === module)` that prints next run for each pipeline.

Follow the module/CLI hybrid pattern from the codebase.
  </action>
  <verify>Run `node lib/schedule.js` and verify it prints a sensible next run time for each pipeline (should be a future time, correct day-of-week for weekly pipelines).</verify>
  <done>lib/schedule.js exists, exports getNextRun and PIPELINE_SCHEDULES, and the CLI self-test shows correct next run times for all 6 pipelines.</done>
</task>

<task type="auto">
  <name>Task 2: Integrate next-run into dashboard overview and template</name>
  <files>lib/dashboard-queries.js, views/overview.ejs, public/style.css, lib/web-server.js</files>
  <action>
**In `lib/dashboard-queries.js`:**
1. Add `const { getNextRun } = require('./schedule');` at the top
2. In `getPipelineOverview()`, after building each pipeline object, call `getNextRun(name)` and add the result as `nextRun` to the pipeline object. If `getNextRun` returns null (e.g., unknown pipeline), set `nextRun: null`.

**In `lib/web-server.js`:**
1. Add a `formatNextRun(nextRunObj)` helper function near the existing `formatRelativeTime` and `formatDuration` helpers. This formats the nextRun for display:
   - If `nextRun` is null, return empty string
   - Format `nextRun.time` as Amsterdam-local time: use `toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })` to get e.g. "Mon 08:00" or "Sun 06:00"
   - For daily pipelines (where the next run is today), show just the time "08:00" instead of "Today 08:00" — actually, always show weekday + time for consistency: "Mon 08:00"
   - Return the formatted string
2. Pass `formatNextRun` to the overview template alongside the existing formatRelativeTime and formatDuration

**In `views/overview.ejs`:**
1. Add a "Next run:" line below the existing "Duration:" line (or below "Last run:" / "Never run") in each pipeline card
2. Show it for all pipeline states (running, completed, never-run)
3. The markup should be:
   ```html
   <% if (pipeline.nextRun) { %>
     <div class="next-run">
       Next: <%= formatNextRun(pipeline.nextRun) %> <span class="schedule-label">(<%= pipeline.nextRun.label %>)</span>
     </div>
   <% } %>
   ```
4. Place this as the LAST element inside the pipeline card, after all existing content but before the closing `</a>` tag

**In `public/style.css`:**
Add styles for the new elements:
```css
.pipeline-card .next-run {
  font-size: 0.85rem;
  color: #007bff;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #eee;
}

.pipeline-card .next-run .schedule-label {
  color: #999;
  font-size: 0.8rem;
}
```
  </action>
  <verify>
1. Run `node -e "require('./lib/dashboard-queries').getPipelineOverview().forEach(p => console.log(p.name, p.nextRun))"` from the project root — should show nextRun objects for all 6 pipelines.
2. Visually inspect `views/overview.ejs` to confirm the next-run div is properly placed inside each card variant (running, completed, never-run).
  </verify>
  <done>
Dashboard overview page shows "Next: Mon 08:00 (4x daily)" or similar for each pipeline card. The next-run line appears at the bottom of every pipeline card regardless of pipeline state. Formatting is consistent and uses Amsterdam timezone.
  </done>
</task>

</tasks>

<verification>
1. `node lib/schedule.js` prints correct next-run times for all 6 pipelines
2. `node -e "require('./lib/dashboard-queries').getPipelineOverview().forEach(p => console.log(p.name, p.nextRun))"` shows nextRun data for each pipeline
3. No syntax errors in the EJS template: `node -e "const ejs = require('ejs'); const fs = require('fs'); ejs.compile(fs.readFileSync('views/overview.ejs', 'utf8'))"` succeeds
4. No errors when starting the web server (if env vars are available)
</verification>

<success_criteria>
- Every pipeline card on the dashboard overview displays the next scheduled run time
- Times are computed correctly based on the actual cron schedule from install-cron.sh
- Times are displayed in Amsterdam timezone with weekday abbreviation
- Schedule frequency label (e.g., "4x daily", "Weekly (Sun)") is shown in parentheses
- The reverse pipeline is not shown (it has no card on the dashboard)
- No new npm dependencies required
</success_criteria>

<output>
After completion, create `.planning/quick/19-show-next-planned-run-time-for-each-pipe/19-SUMMARY.md`
</output>
