# Phase 25: Wire Change Detection to Reverse Sync - Research

**Researched:** 2026-01-29
**Domain:** Integration wiring and pipeline orchestration
**Confidence:** HIGH

## Summary

Phase 25 addresses a critical integration gap identified in the v2.0 Milestone Audit: the change detection infrastructure built in Phase 22 is never called, causing the reverse sync pipeline to run but find zero changes. All required infrastructure exists and works correctly in isolation - the task is purely wiring these components together in the correct sequence.

The v2.0 milestone audit identified that `detect-stadion-changes.js` has complete functionality but is never invoked:
- No cron entry in `install-cron.sh`
- Not called by `reverse-sync.js` before it queries for changes
- Result: `stadion_change_detections` table stays empty → reverse sync finds nothing to push

The standard approach is:
1. Call `detectChanges()` at the start of `reverse-sync.js` before querying unsynced changes
2. Detection populates `stadion_change_detections` table with actual field changes
3. `runReverseSyncMultiPage()` reads from populated table and pushes to Sportlink
4. Email reports automatically show non-zero statistics when changes exist

This is not new feature development - it's connecting two existing, tested modules that currently run in isolation.

**Primary recommendation:** Add `detectChanges()` call at the start of `runAllFieldsReverseSync()` in `reverse-sync.js` to make detection and sync atomic within the same 15-minute cycle. This is the minimal viable integration that closes all three blocked requirements (RSYNC-01, INTEG-01, INTEG-02).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lib/detect-stadion-changes.js | existing | Change detection module (Phase 22) | Complete, tested, ready for integration |
| reverse-sync.js | existing | Reverse sync entry point | Already runs every 15 minutes via cron |
| lib/reverse-sync-sportlink.js | existing | Multi-page sync implementation | Handles all 7 tracked fields across 3 pages |
| lib/stadion-db.js | existing | Database operations | Provides getUnsyncedChanges() for reading detected changes |
| lib/logger.js | existing | Dual-stream logging | Shared logger instance ensures consistent output |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| scripts/send-email.js | existing | Email report delivery | Already sends reverse sync reports, will show non-zero stats |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline detection in reverse-sync.js | Separate detection cron entry | Inline ensures atomic operation (detection always runs before sync), simpler to maintain, fewer moving parts |
| Separate schedules | Single atomic operation | Separate schedules add complexity, potential race conditions, no benefit since they must run together |
| Modify pipeline wrapper | Direct module integration | Module integration is cleaner, testable, and follows existing sync-*.js patterns |

**Installation:**
No new dependencies required - all components already exist.

## Architecture Patterns

### Recommended Integration Structure
```
reverse-sync.js                    # Entry point (already exists)
├── runAllFieldsReverseSync()     # Main function (modify)
    ├── detectChanges()            # NEW: Call detection first
    └── runReverseSyncMultiPage()  # Existing: Reads detected changes
```

### Pattern 1: Atomic Detection + Sync in Single Entry Point
**What:** Call detection before sync in the same function to ensure they always run together
**When to use:** Every reverse sync run (makes them inseparable)
**Example:**
```javascript
// Source: reverse-sync.js (to be modified)
const { detectChanges } = require('./lib/detect-stadion-changes');
const { runReverseSyncMultiPage } = require('./lib/reverse-sync-sportlink');

async function runAllFieldsReverseSync(options = {}) {
  const { verbose = false, logger: providedLogger } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'reverse' });

  logger.log('Starting reverse sync (Stadion -> Sportlink) for all fields...');

  try {
    // PHASE 25 INTEGRATION: Detect changes before syncing
    logger.verbose('Detecting Stadion changes...');
    await detectChanges({ verbose, logger });

    // Now sync the detected changes
    logger.verbose('Syncing detected changes to Sportlink...');
    const result = await runReverseSyncMultiPage({ verbose, logger });

    if (result.synced === 0 && result.failed === 0) {
      logger.log('No changes to sync');
    } else {
      logger.log(`Reverse sync complete: ${result.synced} members synced, ${result.failed} failed`);
    }

    return result;
  } catch (err) {
    logger.error(`Reverse sync failed: ${err.message}`);
    return { success: false, synced: 0, failed: 0, error: err.message };
  }
}
```

**Benefits:**
- Detection and sync are atomic - always run together
- Single point of failure/debugging (easier to troubleshoot)
- Shared logger instance ensures consistent output
- No race conditions or timing issues
- Follows existing pattern from sync-people.js (sequential pipeline steps)

**Source:** sync-people.js pattern (lines 110-160) shows sequential pipeline execution

### Pattern 2: Shared Logger for Consistent Output
**What:** Pass same logger instance to both detection and sync for unified reporting
**When to use:** Every integration where multiple modules contribute to same report
**Example:**
```javascript
// Source: sync-people.js (lines 110-160)
const logger = createSyncLogger({ verbose });

// All steps share the logger
const downloaded = await runDownload({ verbose, logger });
const prepared = await runPrepare({ verbose, logger });
const synced = await runSubmit({ verbose, logger });

// Logger accumulates all output for email report
```

**Benefits:**
- Single log stream contains all operations
- Email report includes both detection and sync statistics
- No log interleaving issues
- Consistent timestamp format

### Pattern 3: Error Handling Preserves Partial Results
**What:** If detection fails, log error and return zero results (don't crash entire sync)
**When to use:** Any multi-step pipeline where later steps depend on earlier ones
**Example:**
```javascript
try {
  const detectedChanges = await detectChanges({ verbose, logger });
  logger.verbose(`Detected ${detectedChanges.length} changes`);
} catch (detectionError) {
  logger.error(`Change detection failed: ${detectionError.message}`);
  // Continue with sync (will find zero changes, which is safe)
  // This allows sync to run even if detection has issues
}

// Sync always runs, but will process zero changes if detection failed
const result = await runReverseSyncMultiPage({ verbose, logger });
```

**Benefits:**
- Graceful degradation (sync runs even if detection fails)
- Clear error reporting (logs show where failure occurred)
- No cascading failures
- Follows fail-safe principle

**Source:** Existing error handling pattern in sync-people.js

### Anti-Patterns to Avoid
- **Separate cron entries for detection and sync:** Creates timing dependencies, race conditions, harder to debug
- **Not passing logger to both modules:** Results in split logs, incomplete email reports
- **Crashing entire sync on detection failure:** Prevents sync from running at all, even for previously detected changes
- **Assuming detection will always succeed:** Network issues, database locks, or API errors can occur
- **Forgetting to update email report format:** Detection statistics should appear in reports

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pipeline orchestration | Custom scheduler or queue system | Simple function call sequence | Detection and sync are lightweight, run sequentially in seconds, no need for complexity |
| Change detection | Re-implement detection logic | Phase 22 detectChanges() module | Already tested, handles pagination, false positive filtering, and audit logging |
| Logging aggregation | Custom log merging | Pass shared logger instance | Built-in pattern in existing sync pipelines |
| Error reporting | Custom error handling | Existing try/catch with graceful degradation | Proven pattern from sync-people.js |

**Key insight:** The infrastructure is complete. The only work is adding 2 lines of code (import + function call) and ensuring the logger is passed through correctly.

## Common Pitfalls

### Pitfall 1: Not Passing Logger to detectChanges()
**What goes wrong:** Detection logs go to stdout but not to file, email report is incomplete
**Why it happens:** detectChanges() creates its own logger if none provided
**How to avoid:** Always pass logger parameter to both detectChanges() and runReverseSyncMultiPage()
**Warning signs:** Email report shows reverse sync stats but no detection stats

**Example - WRONG:**
```javascript
// Detection creates own logger, logs don't merge
await detectChanges({ verbose });  // Missing logger parameter
const result = await runReverseSyncMultiPage({ verbose, logger });
```

**Example - CORRECT:**
```javascript
// Both use same logger, all output merged
await detectChanges({ verbose, logger });
const result = await runReverseSyncMultiPage({ verbose, logger });
```

### Pitfall 2: Stopping on Detection Failure
**What goes wrong:** Entire reverse sync fails if Stadion API has temporary issue
**Why it happens:** Uncaught exception in detectChanges() crashes entire script
**How to avoid:** Wrap detection in try/catch, log error, continue with sync
**Warning signs:** Reverse sync cron job exits with error code, no sync attempted

**Example handling:**
```javascript
try {
  await detectChanges({ verbose, logger });
} catch (error) {
  logger.error(`Change detection failed: ${error.message}`);
  // Don't throw - allow sync to continue with previously detected changes
}

// Sync always runs
const result = await runReverseSyncMultiPage({ verbose, logger });
```

**Trade-off:** This allows sync to process previously detected changes even if new detection fails. If you want to fail-fast instead, remove the try/catch.

### Pitfall 3: Detection Running Multiple Times Per Sync
**What goes wrong:** Detection is called twice (once in reverse-sync.js, once elsewhere)
**Why it happens:** Misunderstanding of where integration should occur
**How to avoid:** Detection should ONLY be called from runAllFieldsReverseSync(), nowhere else
**Warning signs:** Logs show duplicate detection runs, timestamps conflict

**Correct call site:**
- ✅ Inside `runAllFieldsReverseSync()` in reverse-sync.js (atomic with sync)
- ❌ Not in scripts/sync.sh wrapper (wrong level of abstraction)
- ❌ Not as separate cron entry (creates timing dependencies)
- ❌ Not in lib/reverse-sync-sportlink.js (too deep, breaks separation of concerns)

### Pitfall 4: Email Report Doesn't Show Detection Statistics
**What goes wrong:** Report shows "0 synced" but doesn't say if detection ran
**Why it happens:** Email report template doesn't include detection output
**How to avoid:** Detection logs go through same logger, so they automatically appear in report
**Warning signs:** Report is confusing when no changes detected (is detection running?)

**Verification:**
```javascript
// Detection logs via shared logger
logger.log('Detecting Stadion changes...');
logger.log(`Detected ${changes.length} field changes`);

// These logs automatically appear in email report via send-email.js
// No template changes needed - formatAsHtml() handles structured output
```

**Note:** The existing email report format in scripts/send-email.js already handles structured sync output. Detection logs will appear naturally as new sections.

### Pitfall 5: Forgetting Error Propagation to CLI Exit Code
**What goes wrong:** Cron job shows success even when detection fails
**Why it happens:** runAllFieldsReverseSync() catches detection error but still returns success
**How to avoid:** If detection fails, set result.success = false in return value
**Warning signs:** Email shows detection errors but cron job doesn't mark as failed

**Example:**
```javascript
async function runAllFieldsReverseSync(options = {}) {
  let detectionFailed = false;

  try {
    await detectChanges({ verbose, logger });
  } catch (error) {
    logger.error(`Change detection failed: ${error.message}`);
    detectionFailed = true;
  }

  const result = await runReverseSyncMultiPage({ verbose, logger });

  // If detection failed, mark entire operation as partial failure
  if (detectionFailed && result.success) {
    return { ...result, success: false, warning: 'Detection failed but sync completed' };
  }

  return result;
}
```

## Code Examples

Verified patterns from official sources and existing codebase:

### Integration Point in reverse-sync.js
```javascript
// Source: reverse-sync.js (to be modified)
// Add import at top of file
const { detectChanges } = require('./lib/detect-stadion-changes');

/**
 * Run full reverse sync for all fields (Stadion -> Sportlink)
 * Syncs contact fields (/general), free fields (/other), and financial toggle (/financial)
 * PHASE 25: Now includes change detection before sync
 */
async function runAllFieldsReverseSync(options = {}) {
  const { verbose = false, logger: providedLogger } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'reverse' });

  logger.log('Starting reverse sync (Stadion -> Sportlink) for all fields...');
  logger.log('Fields: email, email2, mobile, phone, datum-vog, freescout-id, financiele-blokkade');

  try {
    // PHASE 25: Detect changes before syncing
    logger.verbose('Detecting Stadion changes...');
    const detectedChanges = await detectChanges({ verbose, logger });
    logger.verbose(`Detection found ${detectedChanges.length} field change(s)`);

    // Now sync the detected changes
    logger.verbose('Syncing detected changes to Sportlink...');
    const result = await runReverseSyncMultiPage({ verbose, logger });

    if (result.synced === 0 && result.failed === 0) {
      logger.log('No changes to sync');
    } else {
      logger.log(`Reverse sync complete: ${result.synced} members synced, ${result.failed} failed`);
    }

    return result;
  } catch (err) {
    logger.error(`Reverse sync failed: ${err.message}`);
    return { success: false, synced: 0, failed: 0, error: err.message };
  }
}
```

**Changes required:**
1. Add import: `const { detectChanges } = require('./lib/detect-stadion-changes');`
2. Add detection call before sync: `await detectChanges({ verbose, logger });`
3. That's it. No other changes needed.

**Impact:**
- `detectChanges()` populates `stadion_change_detections` table
- `getUnsyncedChanges()` (called by runReverseSyncMultiPage) now finds actual changes
- Email report shows detection output + sync results
- RSYNC-01, INTEG-01, INTEG-02 requirements automatically satisfied

### Error Handling with Graceful Degradation
```javascript
// Source: sync-people.js pattern (lines 134-180)
async function runAllFieldsReverseSync(options = {}) {
  const { verbose = false, logger: providedLogger } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'reverse' });

  logger.log('Starting reverse sync (Stadion -> Sportlink) for all fields...');

  let detectionError = null;

  try {
    // Try to detect changes
    logger.verbose('Detecting Stadion changes...');
    await detectChanges({ verbose, logger });
  } catch (err) {
    // Log error but continue - sync can still process previously detected changes
    logger.error(`Change detection failed: ${err.message}`);
    detectionError = err;
  }

  // Sync always runs (will find zero changes if detection failed)
  try {
    const result = await runReverseSyncMultiPage({ verbose, logger });

    // Include detection error in result if it occurred
    if (detectionError) {
      return {
        ...result,
        success: false,
        warning: 'Detection failed, only synced previously detected changes',
        detectionError: detectionError.message
      };
    }

    return result;
  } catch (err) {
    logger.error(`Reverse sync failed: ${err.message}`);
    return {
      success: false,
      synced: 0,
      failed: 0,
      error: err.message,
      detectionError: detectionError?.message
    };
  }
}
```

**Benefits:**
- Sync runs even if detection fails
- All errors logged and included in return value
- Email report shows both detection and sync status
- Cron job marks as failed if either step fails

### Verification Test (Manual)
```javascript
// Source: Pattern for testing integration
// Run manually on production server to verify wiring

// Test 1: Verify detection runs
const { detectChanges } = require('./lib/detect-stadion-changes');
const { createSyncLogger } = require('./lib/logger');

const logger = createSyncLogger({ verbose: true });
detectChanges({ verbose: true, logger })
  .then(changes => {
    console.log(`\n✓ Detection successful: ${changes.length} changes detected`);
  })
  .catch(err => {
    console.error(`✗ Detection failed: ${err.message}`);
  });

// Test 2: Verify detection + sync integration
const { runAllFieldsReverseSync } = require('./reverse-sync');

runAllFieldsReverseSync({ verbose: true })
  .then(result => {
    console.log('\n✓ Integration test complete');
    console.log(`  Detection ran: ${result.detectionError ? 'failed' : 'success'}`);
    console.log(`  Sync result: ${result.synced} synced, ${result.failed} failed`);
  })
  .catch(err => {
    console.error(`✗ Integration test failed: ${err.message}`);
  });

// Test 3: Verify email report includes detection output
// scripts/sync.sh reverse
// Check logs/cron/sync-reverse-*.log for detection output
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Detection and sync separate | Atomic detection + sync | Phase 25 | Ensures detection always runs before sync, no timing issues |
| Manual cron scheduling | Integrated pipeline | Phase 25 | Simpler maintenance, fewer failure modes |
| Split logs | Shared logger | Existing pattern | Complete email reports with all operations |
| No change detection | Hash-based field detection | Phase 22 | Efficient, accurate change identification |

**Deprecated/outdated:**
- Separate cron entries for detection: Use atomic integration instead
- Detection as standalone operation: Always pair with sync for consistency

## Open Questions

1. **Detection Failure Handling Strategy**
   - What we know: Detection can fail due to network, database, or API issues
   - What's unclear: Should entire reverse sync fail if detection fails?
   - Recommendation: Log error and continue with sync (processes previously detected changes), mark operation as partial failure
   - Trade-off: Graceful degradation vs fail-fast - recommend graceful for production

2. **Detection Statistics in Email Report**
   - What we know: scripts/send-email.js formats structured log output
   - What's unclear: Will detection logs automatically appear in report?
   - Recommendation: Yes, shared logger ensures all output goes to email. Verify with test run.
   - Evidence: formatAsHtml() in scripts/send-email.js handles any structured log output (lines 52-209)

3. **Performance Impact**
   - What we know: Detection queries Stadion API with modified_after filter
   - What's unclear: Will detection add significant time to 15-minute sync cycle?
   - Recommendation: Detection is incremental (only modified members) and runs in seconds. No performance concern.
   - Evidence: Phase 22 verification showed detection completes in <10 seconds even for full scan

## Sources

### Primary (HIGH confidence)
- v2.0-MILESTONE-AUDIT.md - Gap analysis identifying disconnected components (complete file)
- lib/detect-stadion-changes.js - Phase 22 implementation (complete, tested, lines 1-275)
- reverse-sync.js - Current entry point needing modification (lines 1-59)
- lib/reverse-sync-sportlink.js - Multi-page sync implementation (lines 580-682, runReverseSyncMultiPage)
- lib/stadion-db.js - Database operations including getUnsyncedChanges() (lines 2491-2503)
- sync-people.js - Sequential pipeline pattern (lines 110-180)
- scripts/send-email.js - Email report formatting (lines 52-209, formatAsHtml)

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md - Blocked requirements RSYNC-01, INTEG-01, INTEG-02 (lines 24-33)
- STATE.md - Phase 24 completion, v2.0 status (lines 1-100)
- Phase 22 RESEARCH.md - Change detection architecture (complete file)
- Phase 23 RESEARCH.md - Reverse sync patterns (complete file)

### Tertiary (LOW confidence)
- None - all findings based on existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already exist and are tested
- Architecture: HIGH - Simple function call integration following existing patterns
- Pitfalls: HIGH - Based on common integration mistakes in existing codebase
- Performance: HIGH - Detection is incremental and fast

**Research date:** 2026-01-29
**Valid until:** 90 days (stable codebase, no external dependencies)

**Complexity assessment:** LOW
- Lines of code to add: ~3 (import + function call + log line)
- New files needed: 0
- New dependencies: 0
- Risk level: Very low (connecting two tested components)
- Estimated implementation time: 5 minutes
