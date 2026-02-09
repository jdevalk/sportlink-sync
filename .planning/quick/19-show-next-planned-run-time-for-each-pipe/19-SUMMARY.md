---
phase: quick-19
plan: 01
subsystem: web-dashboard
tags: [ui, scheduling, timezone]
dependency_graph:
  requires: [web-server, dashboard-queries]
  provides: [schedule-module, next-run-display]
  affects: [dashboard-ui]
tech_stack:
  added:
    - lib/schedule.js (schedule definitions and next-run calculator)
  patterns:
    - Amsterdam timezone handling with DST support
    - Dual-offset probe for correct UTC conversion
key_files:
  created:
    - lib/schedule.js
  modified:
    - lib/dashboard-queries.js
    - lib/web-server.js
    - views/overview.ejs
    - public/style.css
decisions:
  - "Use dual-offset probe (+01:00 CET and +02:00 CEST) to correctly handle Amsterdam DST transitions"
  - "Show weekday abbreviation + time for consistency across daily and weekly schedules"
  - "Exclude reverse pipeline (hourly schedule not meaningful to display)"
metrics:
  duration: 2
  completed: 2026-02-09T15:43:00Z
---

# Quick Task 19: Show Next Planned Run Time for Each Pipeline

**One-liner:** Dashboard now displays next scheduled run time for each pipeline with Amsterdam timezone and schedule frequency label.

## Objective

Display the next planned run time on each pipeline card in the dashboard overview, so users can see at a glance when each sync will execute next.

## Implementation

### Task 1: Create Schedule Module

Created `lib/schedule.js` with:

- `PIPELINE_SCHEDULES` constant mapping pipeline names to schedule definitions:
  - **people**: 4x daily at 08:00, 11:00, 14:00, 17:00
  - **nikki**: daily at 07:00
  - **freescout**: daily at 08:00
  - **teams**: weekly on Sunday at 06:00
  - **functions**: 4x daily at 07:30, 10:30, 13:30, 16:30
  - **discipline**: weekly on Monday at 23:30

- `getNextRun(pipelineName, now)` function that:
  - Converts UTC to Amsterdam time components using `toLocaleString`
  - For daily schedules: finds next time slot today or first slot tomorrow
  - For weekly schedules: finds next occurrence of target day
  - Returns `{ time: Date, label: string }` with UTC Date and human-readable label

- Amsterdam timezone handling:
  - Uses dual-offset probe (+01:00 CET and +02:00 CEST)
  - Correctly handles DST transitions
  - Verifies formatted time matches target time

- CLI self-test showing next run for all 6 pipelines

### Task 2: Integrate Into Dashboard

**lib/dashboard-queries.js:**
- Import `getNextRun` from schedule module
- Call `getNextRun(name)` for each pipeline in `getPipelineOverview()`
- Add `nextRun` field to pipeline objects

**lib/web-server.js:**
- Add `formatNextRun(nextRunObj)` helper function
- Format as Amsterdam time with weekday abbreviation (e.g., "Mon 08:00")
- Pass `formatNextRun` to overview template

**views/overview.ejs:**
- Add "Next: [time] ([label])" line at bottom of each pipeline card
- Display for all pipeline states (running, completed, never-run)
- Show schedule frequency in gray parentheses

**public/style.css:**
- Add `.next-run` styles with visual separator (top border)
- Blue color for next run time
- Gray color for schedule label
- Consistent spacing with other card elements

## Results

- Every pipeline card now shows next scheduled run time
- Times displayed in Amsterdam timezone with weekday abbreviation
- Schedule frequency shown in parentheses (e.g., "4x daily", "Weekly (Sun)")
- Visual separator clearly distinguishes next run from other card content
- No new npm dependencies required

## Deviations from Plan

None - plan executed exactly as written.

## Verification

1. `node lib/schedule.js` prints correct next-run times for all 6 pipelines ✓
2. `node -e "require('./lib/dashboard-queries').getPipelineOverview().forEach(p => console.log(p.name, p.nextRun))"` shows nextRun data for each pipeline ✓
3. EJS template compiles without syntax errors ✓
4. Web server starts successfully (verified on production server)

## Self-Check: PASSED

Created files exist:
```bash
[ -f "lib/schedule.js" ] && echo "FOUND: lib/schedule.js"
```
FOUND: lib/schedule.js

Modified files exist:
```bash
[ -f "lib/dashboard-queries.js" ] && echo "FOUND: lib/dashboard-queries.js"
[ -f "lib/web-server.js" ] && echo "FOUND: lib/web-server.js"
[ -f "views/overview.ejs" ] && echo "FOUND: views/overview.ejs"
[ -f "public/style.css" ] && echo "FOUND: public/style.css"
```
FOUND: lib/dashboard-queries.js
FOUND: lib/web-server.js
FOUND: views/overview.ejs
FOUND: public/style.css

Commits exist:
```bash
git log --oneline | grep -q "570f87f" && echo "FOUND: 570f87f"
git log --oneline | grep -q "d8a638d" && echo "FOUND: d8a638d"
```
FOUND: 570f87f
FOUND: d8a638d
