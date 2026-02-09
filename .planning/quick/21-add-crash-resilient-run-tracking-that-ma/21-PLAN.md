---
phase: quick-21
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/run-tracker.js
autonomous: true
must_haves:
  truths:
    - "If a pipeline crashes with an uncaught exception after startRun(), the run row is marked as failure (not stuck as running)"
    - "If a pipeline crashes with an unhandled promise rejection after startRun(), the run row is marked as failure"
    - "Normal error handling (the inner try/catch in pipelines) continues to work unchanged"
    - "Process handlers are registered at most once, even if multiple RunTracker instances exist"
  artifacts:
    - path: "lib/run-tracker.js"
      provides: "Crash-resilient run tracking via process event handlers"
      contains: "process.once"
  key_links:
    - from: "process uncaughtException handler"
      to: "RunTracker.endRun"
      via: "stored tracker reference"
      pattern: "process\\.once.*uncaughtException"
---

<objective>
Add crash-resilient run tracking so uncaught exceptions and unhandled rejections automatically mark the current run as failed instead of leaving it stuck as "running" forever.

Purpose: Eliminate manual database cleanup when pipelines crash outside their try/catch blocks.
Output: Updated `lib/run-tracker.js` with process crash handlers registered in `startRun()`.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@lib/run-tracker.js
@pipelines/sync-nikki.js (representative pipeline - read-only reference)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add crash safety handlers to RunTracker.startRun()</name>
  <files>lib/run-tracker.js</files>
  <action>
Modify `lib/run-tracker.js` to register process-level crash handlers when `startRun()` is called. This catches uncaught exceptions and unhandled rejections that would otherwise leave the run stuck as "running".

Implementation details:

1. Add a module-level variable `let _crashHandlersRegistered = false;` outside the class (before `class RunTracker`). This prevents duplicate handler registration if multiple trackers exist in the same process.

2. Add a module-level variable `let _activeTracker = null;` to hold a reference to the most recently started tracker (the one whose run should be marked failed on crash).

3. Inside `startRun()`, AFTER the successful `_insertRun.run()` call and `this.runId` assignment (but still inside the `_safe` callback), add:
   - Set `_activeTracker = this;`
   - If `!_crashHandlersRegistered`, register handlers and set the flag to true:

4. The crash handler function (define as a named function at module level for clarity):
   ```javascript
   function _handleCrash(errOrReason) {
     const tracker = _activeTracker;
     if (tracker && tracker.runId && tracker.db) {
       try {
         const finishedAt = nowISO();
         // Compute duration
         let durationMs = 0;
         const runRow = tracker._getRunStart.get(tracker.runId);
         if (runRow && runRow.started_at) {
           durationMs = new Date(finishedAt) - new Date(runRow.started_at);
         }
         // Aggregate step counts
         const totals = tracker._sumSteps.get(tracker.runId);
         // Record the crash as an error
         tracker._insertError.run(
           tracker.runId,
           null,
           'crash',
           null,
           String(errOrReason && errOrReason.message ? errOrReason.message : errOrReason).substring(0, 2000),
           errOrReason && errOrReason.stack ? String(errOrReason.stack).substring(0, 4000) : null,
           finishedAt
         );
         // Update run as failure
         tracker._updateRun.run(
           finishedAt,
           durationMs,
           'failure',
           totals.total_created,
           totals.total_updated,
           totals.total_skipped,
           totals.total_failed,
           JSON.stringify({ crash: true, error: String(errOrReason) }),
           tracker.runId
         );
         tracker.db.close();
         tracker.db = null;
       } catch (dbErr) {
         console.error(`[run-tracker] Failed to record crash: ${dbErr.message}`);
       }
     }
     _activeTracker = null;
   }
   ```

5. Register handlers (inside the `if (!_crashHandlersRegistered)` block):
   ```javascript
   process.once('uncaughtException', (err) => {
     console.error(`[run-tracker] Uncaught exception, marking run as failed: ${err.message}`);
     _handleCrash(err);
     // Re-throw to preserve default Node.js behavior (crash with stack trace)
     // Use process.exit(1) instead of re-throw to avoid infinite loop
     process.exit(1);
   });
   process.once('unhandledRejection', (reason) => {
     console.error(`[run-tracker] Unhandled rejection, marking run as failed: ${reason}`);
     _handleCrash(reason);
     process.exit(1);
   });
   _crashHandlersRegistered = true;
   ```

6. In the existing `endRun()` method, AFTER the successful update, add `_activeTracker = null;` to clear the reference. This prevents the crash handler from double-acting if endRun was already called normally. Place this right before the `this.close()` call, inside the `_safe` callback.

7. In the existing `close()` method, also set `_activeTracker = null` if `_activeTracker === this`, as a safety net.

IMPORTANT: Do NOT use `process.on` -- use `process.once` to avoid stacking handlers. The crash handler uses direct SQL prepared statements (not `endRun`) because `endRun` uses `_safe` which swallows errors -- in a crash handler we want explicit try/catch with console.error so we know if it failed. The handler also records the crash error in `run_errors` for visibility in the dashboard.
  </action>
  <verify>
Run the self-test at the bottom of run-tracker.js to confirm normal operation still works:
```bash
cd /Users/joostdevalk/Code/rondo/rondo-sync && node lib/run-tracker.js
```
Should print "Run tracker test complete" with a run_id.

Then verify the crash handler code is syntactically correct by requiring the module:
```bash
node -e "const { RunTracker } = require('./lib/run-tracker'); console.log('Module loads OK'); const t = new RunTracker('test'); console.log('Constructor OK');"
```
  </verify>
  <done>
    - `lib/run-tracker.js` has module-level `_crashHandlersRegistered` flag, `_activeTracker` reference, and `_handleCrash` function
    - `startRun()` sets `_activeTracker` and registers `process.once('uncaughtException')` and `process.once('unhandledRejection')` handlers (once only)
    - `endRun()` clears `_activeTracker` so crash handler won't double-act after normal completion
    - `close()` clears `_activeTracker` as safety net
    - Crash handler marks run as 'failure', records error in run_errors, closes DB, then exits with code 1
    - Existing self-test passes, module loads without error
    - Normal pipeline error handling (inner try/catch) is unaffected
  </done>
</task>

</tasks>

<verification>
1. `node lib/run-tracker.js` -- self-test completes successfully
2. `node -e "const { RunTracker } = require('./lib/run-tracker'); console.log('OK');"` -- module loads
3. Code review: `process.once` used (not `process.on`), `_crashHandlersRegistered` flag prevents duplicate registration, `_activeTracker` cleared in `endRun()` and `close()`
</verification>

<success_criteria>
- RunTracker registers crash handlers on first `startRun()` call
- Crash handlers mark the run as 'failure' and record the error, then exit
- Normal operation (endRun called successfully) is unchanged
- No duplicate handler registration across multiple tracker instances
</success_criteria>

<output>
After completion, create `.planning/quick/21-add-crash-resilient-run-tracking-that-ma/21-SUMMARY.md`
</output>
