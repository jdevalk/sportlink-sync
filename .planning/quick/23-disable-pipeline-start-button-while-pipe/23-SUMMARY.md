---
phase: quick-23
plan: 01
subsystem: web-dashboard
tags: [ui, safety, concurrency]
dependency_graph:
  requires: [dashboard-queries, web-server, overview-template]
  provides: [running-pipeline-protection]
  affects: [pipeline-start-flow]
tech_stack:
  added: [isPipelineRunning-query]
  patterns: [server-side-validation, client-side-disable]
key_files:
  created: []
  modified:
    - lib/dashboard-queries.js
    - lib/web-server.js
    - views/overview.ejs
decisions:
  - choice: "Three-layer protection: UI disabled state, server 409 guard, client 409 handler"
    rationale: "Defense in depth prevents race conditions and accidental double-starts"
  - choice: "isPipelineRunning() as separate exported function"
    rationale: "Reusable query pattern, keeps web-server.js route handler clean"
  - choice: "Button shows 'Running' text when disabled"
    rationale: "Clear visual feedback why button is unavailable"
metrics:
  duration_minutes: 1.2
  tasks_completed: 1
  files_modified: 3
  completed_date: 2026-02-09
---

# Quick Task 23: Disable Start Button While Pipeline Running

**One-liner:** Prevent duplicate pipeline runs with disabled UI button and 409 Conflict server guard

## Summary

Added three-layer protection against starting a pipeline that's already running:

1. **UI layer**: Start button conditionally disabled and shows "Running" text when `pipeline.status === 'running'`
2. **Server layer**: POST endpoint returns 409 Conflict if pipeline has active run in database
3. **Client layer**: Fetch handler gracefully processes 409 by keeping button disabled

Users can no longer accidentally spawn concurrent sync processes that could cause data conflicts or race conditions.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Disable Start button in UI and add server-side guard | d746305 | dashboard-queries.js, web-server.js, overview.ejs |

## Implementation Details

### New Function: `isPipelineRunning(pipeline)`

Added to `lib/dashboard-queries.js`:

```javascript
function isPipelineRunning(pipeline) {
  const database = ensureDb();
  const row = database.prepare(`
    SELECT COUNT(*) as count FROM runs
    WHERE pipeline = ? AND club_slug = 'rondo' AND outcome = 'running'
  `).get(pipeline);
  return row.count > 0;
}
```

Exported alongside existing dashboard query functions.

### Server Guard

In `lib/web-server.js` POST `/api/pipeline/:name/start` route:

```javascript
// Prevent starting a pipeline that's already running
if (isPipelineRunning(pipelineName)) {
  return reply.code(409).send({ ok: false, error: 'Pipeline is already running' });
}
```

Returns HTTP 409 Conflict with descriptive error message.

### UI Changes

**Button markup** in `views/overview.ejs`:

```html
<button class="btn-start"
  <% if (pipeline.status === 'running') { %>disabled title="Pipeline is currently running"<% } %>
  onclick="startPipeline('<%= pipeline.name %>', this); event.preventDefault(); event.stopPropagation();">
  <%= pipeline.status === 'running' ? 'Running' : 'Start' %>
</button>
```

**Client-side handler**:

```javascript
async function startPipeline(name, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    const res = await fetch('/api/pipeline/' + encodeURIComponent(name) + '/start', { method: 'POST' });
    if (res.status === 409) {
      btn.textContent = 'Running';
      btn.disabled = true;
      return;
    }
    // ... existing success/error handling
  }
}
```

Handles 409 before JSON parsing, shows "Running" state.

## CSS Leveraged

Existing `.btn-start:disabled` styles already present in `public/style.css`:

```css
.btn-start:disabled {
  background: #6c757d;
  cursor: not-allowed;
}
```

No CSS changes required.

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

Verification confirms:

- Button renders with `disabled` attribute when `pipeline.status === 'running'`
- Button text changes from "Start" to "Running" in running state
- Server route includes `isPipelineRunning()` guard before spawning process
- Client-side handler has 409 response case before data.ok check
- No syntax errors in any modified files

## Self-Check: PASSED

Created files: None
Modified files:
- FOUND: /Users/joostdevalk/Code/rondo/rondo-sync/lib/dashboard-queries.js
- FOUND: /Users/joostdevalk/Code/rondo/rondo-sync/lib/web-server.js
- FOUND: /Users/joostdevalk/Code/rondo/rondo-sync/views/overview.ejs

Commits:
- FOUND: d746305 (feat(quick-23): disable Start button while pipeline is running)
