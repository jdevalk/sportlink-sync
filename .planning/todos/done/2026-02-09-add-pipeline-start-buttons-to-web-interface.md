---
created: 2026-02-09T11:44:06.809Z
title: Add pipeline start buttons to web interface
area: ui
files:
  - web/server.js
  - web/views/
  - scripts/sync.sh
---

## Problem

The web dashboard (sync.rondo.club) currently only shows sync status, errors, and run history. There's no way to manually trigger a pipeline run from the web interface — operators must SSH into the server and run `scripts/sync.sh <pipeline>` manually.

Each pipeline (people, nikki, freescout, teams, functions, discipline) should have a "Start" button in the web UI that triggers a run on the server.

## Solution

- Add a start/trigger button next to each pipeline on the dashboard
- Create a POST endpoint (e.g., `POST /api/pipelines/:name/run`) that spawns the sync script
- Use `child_process.spawn` to run `scripts/sync.sh <pipeline>` in the background
- Show immediate feedback (started/queued) and link to the run's log output
- Respect existing lock files to prevent concurrent runs of the same pipeline
- Consider adding confirmation dialog to prevent accidental triggers
