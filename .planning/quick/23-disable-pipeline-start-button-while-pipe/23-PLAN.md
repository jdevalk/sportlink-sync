---
phase: quick-23
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - views/overview.ejs
  - lib/web-server.js
autonomous: true

must_haves:
  truths:
    - "Start button is visually disabled and unclickable when a pipeline has status 'running'"
    - "Clicking a disabled Start button does not trigger a pipeline run"
    - "Server rejects POST /api/pipeline/:name/start with 409 when pipeline is already running"
    - "Start button remains functional for pipelines that are not running"
  artifacts:
    - path: "views/overview.ejs"
      provides: "Disabled Start button when pipeline status is running"
      contains: "disabled"
    - path: "lib/web-server.js"
      provides: "Server-side guard against starting running pipeline"
      contains: "409"
  key_links:
    - from: "views/overview.ejs"
      to: "pipeline.status"
      via: "EJS conditional on button disabled attribute"
      pattern: "pipeline\\.status.*running.*disabled"
---

<objective>
Disable the pipeline Start button while a pipeline is already running, preventing accidental duplicate runs.

Purpose: Users can accidentally click Start while a pipeline is running, spawning a second concurrent sync process that could cause data conflicts.
Output: Disabled Start button in the UI when pipeline status is 'running', plus a server-side guard returning 409 Conflict.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@views/overview.ejs
@lib/web-server.js
@lib/dashboard-queries.js
@public/style.css
</context>

<tasks>

<task type="auto">
  <name>Task 1: Disable Start button in UI and add server-side guard</name>
  <files>views/overview.ejs, lib/web-server.js</files>
  <action>
In `views/overview.ejs`, modify the Start button (line 12) to be conditionally disabled when the pipeline is running:

Replace the current button:
```html
<button class="btn-start" onclick="startPipeline('<%= pipeline.name %>', this); event.preventDefault(); event.stopPropagation();">Start</button>
```

With a button that adds `disabled` attribute and changes text when running:
```html
<button class="btn-start" <% if (pipeline.status === 'running') { %>disabled title="Pipeline is currently running"<% } %> onclick="startPipeline('<%= pipeline.name %>', this); event.preventDefault(); event.stopPropagation();"><%= pipeline.status === 'running' ? 'Running' : 'Start' %></button>
```

The existing CSS already handles `.btn-start:disabled` styling (gray background, not-allowed cursor), so no CSS changes needed.

In `lib/web-server.js`, add a server-side guard in the `POST /api/pipeline/:name/start` handler (around line 221, after the KNOWN_PIPELINES validation). Before spawning the child process, query the database to check if there's a running instance:

```javascript
// Check if pipeline is already running
const { isRunning } = require('./dashboard-queries');
```

Wait -- `dashboard-queries.js` doesn't export an `isRunning` function. Instead, inline the check directly in the route handler using the existing `getPipelineOverview` function, or more efficiently, add a small query. The cleanest approach: query the runs table directly in the route handler.

Add this check right after the KNOWN_PIPELINES validation (line 219), before the try block:

```javascript
// Check if pipeline is already running
const { openDb } = require('./dashboard-db');
```

Actually, the web-server already imports `getPipelineOverview` from `dashboard-queries`. But calling the full overview is wasteful. Instead, add the check inline using a direct DB query. Import `openDb` from `dashboard-db` (already available through the existing require chain).

Simplest correct approach: use the shared db from dashboard-queries. Add a new exported function `isPipelineRunning(name)` to `lib/dashboard-queries.js`:

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

Export it from `dashboard-queries.js`.

Then in `lib/web-server.js`:
1. Add `isPipelineRunning` to the destructured import from `./dashboard-queries` (line 10).
2. In the POST handler, after the KNOWN_PIPELINES check, add:

```javascript
// Prevent starting a pipeline that's already running
if (isPipelineRunning(pipelineName)) {
  return reply.code(409).send({ ok: false, error: 'Pipeline is already running' });
}
```

In the `startPipeline` JavaScript function in `overview.ejs`, handle the 409 response. After `const data = await res.json();`, before checking `data.ok`, add handling for the conflict case:

```javascript
if (res.status === 409) {
  btn.textContent = 'Running';
  btn.disabled = true;
  return;
}
```
  </action>
  <verify>
1. Read the modified files to confirm:
   - `views/overview.ejs` button has conditional `disabled` attribute when `pipeline.status === 'running'`
   - `lib/dashboard-queries.js` exports `isPipelineRunning` function
   - `lib/web-server.js` imports `isPipelineRunning` and returns 409 when pipeline is running
   - The client-side JS handles 409 by showing "Running" and keeping button disabled
2. Run: `node -e "require('./lib/dashboard-queries')" ` to verify no syntax errors in dashboard-queries
3. Run: `node -e "const {buildServer} = require('./lib/web-server')"` to verify no syntax errors in web-server (may fail due to env vars, acceptable)
  </verify>
  <done>
- Start button renders as disabled with text "Running" when pipeline status is 'running'
- Start button renders normally with text "Start" when pipeline is not running
- Server returns 409 Conflict if POST /api/pipeline/:name/start is called for a running pipeline
- Client-side JS gracefully handles 409 by showing "Running" state
- No duplicate pipeline runs can be started through the UI
  </done>
</task>

</tasks>

<verification>
- Review all three modified files for correctness
- Verify no syntax errors with `node -e "require('./lib/dashboard-queries')"`
- Confirm the button disabled CSS already exists in `public/style.css` (it does: `.btn-start:disabled`)
</verification>

<success_criteria>
When a pipeline has `outcome = 'running'` in the database, the Start button on the overview page is disabled and shows "Running". Attempting to start a running pipeline via the API returns 409. Non-running pipelines can still be started normally.
</success_criteria>

<output>
After completion, create `.planning/quick/23-disable-pipeline-start-button-while-pipe/23-SUMMARY.md`
</output>
