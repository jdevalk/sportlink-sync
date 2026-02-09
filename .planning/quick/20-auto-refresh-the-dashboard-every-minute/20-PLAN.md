---
phase: quick-20
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - views/partials/head.ejs
autonomous: true
must_haves:
  truths:
    - "Dashboard pages auto-refresh every 60 seconds without user interaction"
    - "Login page does NOT auto-refresh"
  artifacts:
    - path: "views/partials/head.ejs"
      provides: "Meta refresh tag for auto-reload"
      contains: "http-equiv=\"refresh\""
  key_links: []
---

<objective>
Add auto-refresh to the dashboard so it updates every 60 seconds.

Purpose: The dashboard shows pipeline run status and timing info. Auto-refresh keeps it current without requiring manual browser refreshes, which is especially useful when monitoring running syncs.
Output: Updated head.ejs partial with meta refresh tag.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@views/partials/head.ejs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add meta refresh tag to dashboard layout</name>
  <files>views/partials/head.ejs</files>
  <action>
    Add a `<meta http-equiv="refresh" content="60">` tag to the `<head>` section of `views/partials/head.ejs`, after the existing viewport meta tag (line 5).

    This is the correct approach because:
    - The `head.ejs` partial is used by all authenticated dashboard pages (overview, run-history, run-detail, errors, error-detail).
    - The login page (`views/login.ejs`) has its own standalone HTML and does NOT include this partial, so it will NOT be affected.
    - A meta refresh is simpler and more reliable than JavaScript-based refresh. It works even if JS fails, and there is no interactive state on the dashboard that would be lost on refresh.

    The resulting head section should look like:
    ```
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="60">
    <title>...
    ```
  </action>
  <verify>
    1. Read `views/partials/head.ejs` and confirm it contains `<meta http-equiv="refresh" content="60">`.
    2. Read `views/login.ejs` and confirm it does NOT contain any refresh meta tag.
  </verify>
  <done>All dashboard pages (overview, pipeline history, run detail, errors) include a meta refresh tag that reloads the page every 60 seconds. The login page is unaffected.</done>
</task>

</tasks>

<verification>
- `views/partials/head.ejs` contains `<meta http-equiv="refresh" content="60">`
- `views/login.ejs` does NOT contain any refresh meta tag
- No other files are modified
</verification>

<success_criteria>
Dashboard pages auto-refresh every 60 seconds. Login page does not refresh.
</success_criteria>

<output>
After completion, create `.planning/quick/20-auto-refresh-the-dashboard-every-minute/20-SUMMARY.md`
</output>
