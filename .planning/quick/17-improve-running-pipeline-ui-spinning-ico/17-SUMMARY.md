# Quick Task 17: Improve running pipeline UI

## Changes

### `public/style.css`
- Replaced yellow dot (`.status-running`) with a blue CSS spinner animation
- Added `.running-info` style (blue text) for the "Running since" message

### `lib/dashboard-queries.js`
- `getPipelineOverview()` now also fetches the last completed run (`previousRun`) per pipeline for duration display

### `views/overview.ejs`
- When a pipeline is running: shows "Running since Xm ago" (blue text) and "Previous run: Xm Xs"
- When not running: unchanged behavior (last run time, counts, duration)

## Commit
- `11d030c` — feat: improve running pipeline UI with spinner and timing info
