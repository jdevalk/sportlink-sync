# Quick Task 17: Improve running pipeline UI

## Task 1: Update dashboard query to include previous run data
- In `getPipelineOverview()`, fetch the last *completed* run (success/failure) alongside the latest run
- Return `previousRun` with `duration_ms` for display
- When current run is "running", also return `started_at` for elapsed time calculation

## Task 2: Update CSS — replace yellow dot with spinning icon for running state
- Replace `.status-running` yellow circle with a CSS spinner animation
- Use a border-based spinner (small, inline, same 12px size as other indicators)
- Keep green/red/grey dots unchanged

## Task 3: Update overview.ejs template
- Show previous run duration on each card (e.g. "Previous: 4m 12s")
- When running: show "Started Xm ago" with elapsed time
- Pass `formatRelativeTime` and `formatDuration` (already available)
