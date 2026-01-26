# Phase 15: Pipeline Integration - Research

**Researched:** 2026-01-26
**Domain:** Pipeline orchestration, email report generation, non-critical sync integration
**Confidence:** HIGH

## Summary

Phase 15 integrates team sync into the existing daily sync pipeline. The codebase already has well-established patterns for adding non-critical sync operations (photos, birthdays) that provide a clear template. The existing `sync-all.js` orchestrator handles step ordering, error collection, and statistics aggregation. The email report is generated from a plain-text summary that `send-email.js` converts to HTML.

The primary integration pattern is straightforward: add team sync as a new step in `sync-all.js`, collect statistics in the `stats` object following the existing structure, add team sync section to `printSummary()`, and collect errors separately. The email formatting in `send-email.js` parses section headers (ALL CAPS) and key-value pairs automatically.

**Primary recommendation:** Follow the exact pattern used for BIRTHDAY SYNC integration: add require at top, add stats structure, wrap sync call in try-catch for non-critical handling, add section to printSummary(), and collect errors distinctly. The email report HTML will format automatically based on section headers.

## Standard Stack

The established libraries/tools for this domain are already in use.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sync-all.js | Internal | Pipeline orchestrator | Existing step management, error handling, summary generation |
| send-email.js | Internal | Email formatting | Parses plain text into semantic HTML |
| submit-stadion-teams.js | Internal | Team sync execution | Already exports `runSync()` with result stats |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/logger.js | Internal | Dual-stream logging | stdout + file output, verbose mode |
| postmark | ^4.0.5 | Email delivery | Sends formatted HTML email reports |

### Alternatives Considered
None - this phase extends existing infrastructure only.

**Installation:**
No new dependencies required - all modules already exist.

## Architecture Patterns

### Recommended Integration Point in sync-all.js

Team sync should run AFTER member sync (Step 4) and BEFORE photo download (Step 5). This ensures:
1. Teams reference up-to-date member data
2. Team sync failures don't block the critical member sync path

```
Step 1: Download from Sportlink       [CRITICAL - blocks all]
Step 2: Prepare Laposta members       [CRITICAL - blocks Laposta]
Step 3: Submit to Laposta             [Collects errors]
Step 4: Sync to Stadion (members)     [NON-CRITICAL via try-catch]
Step 4b: Team Sync [NEW]              [NON-CRITICAL via try-catch]
Step 5: Photo Download                [NON-CRITICAL via try-catch]
Step 6: Photo Upload/Delete           [NON-CRITICAL via try-catch]
Step 7: Birthday Sync                 [NON-CRITICAL via try-catch]
```

### Pattern 1: Non-Critical Sync Step

**What:** Wrap sync call in try-catch to prevent failure from blocking pipeline.

**When to use:** Any sync operation that should not stop the main pipeline.

**Example:**
```javascript
// Source: sync-all.js lines 408-432 (BIRTHDAY SYNC pattern)
// Step 4b: Team Sync (NON-CRITICAL)
logger.verbose('Syncing teams to Stadion...');
try {
  const teamResult = await runTeamSync({ logger, verbose, force });

  stats.teams = {
    total: teamResult.total,
    synced: teamResult.synced,
    created: teamResult.created,
    updated: teamResult.updated,
    skipped: teamResult.skipped,
    errors: (teamResult.errors || []).map(e => ({
      team_name: e.team_name,
      message: e.message,
      system: 'team-sync'
    }))
  };
} catch (err) {
  logger.error(`Team sync failed: ${err.message}`);
  stats.teams.errors.push({
    message: `Team sync failed: ${err.message}`,
    system: 'team-sync'
  });
}
```

### Pattern 2: Stats Object Structure

**What:** Initialize stats with team section matching existing sync sections.

**When to use:** Storing and aggregating sync results for summary report.

**Example:**
```javascript
// Source: sync-all.js stats object structure (lines 165-218)
const stats = {
  // ... existing fields ...
  teams: {
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    newTeamNames: [],  // For detailed report: "3 new teams: JO11-1, MO13-2..."
    errors: []
  }
};
```

### Pattern 3: Summary Section Format

**What:** Add TEAM SYNC section to printSummary() following exact format of existing sections.

**When to use:** Rendering team stats in console output and email report.

**Example:**
```javascript
// Source: sync-all.js printSummary() pattern (lines 113-128)
logger.log('TEAM SYNC');
logger.log(minorDivider);
const teamSyncText = stats.teams.total > 0
  ? `${stats.teams.synced}/${stats.teams.total}`
  : '0 changes';
logger.log(`Teams synced: ${teamSyncText}`);
if (stats.teams.created > 0) {
  logger.log(`  Created: ${stats.teams.created}`);
  if (stats.teams.newTeamNames.length > 0) {
    const names = stats.teams.newTeamNames.slice(0, 5).join(', ');
    const suffix = stats.teams.newTeamNames.length > 5
      ? ` (+${stats.teams.newTeamNames.length - 5} more)`
      : '';
    logger.log(`  New teams: ${names}${suffix}`);
  }
}
if (stats.teams.updated > 0) {
  logger.log(`  Updated: ${stats.teams.updated}`);
}
logger.log('');
```

### Pattern 4: Error Collection for Distinct Section

**What:** Collect team errors separately from other sync errors for clear reporting.

**When to use:** When user decisions require separate error sections in report.

**Example:**
```javascript
// Source: sync-all.js lines 130-147 (error collection pattern)
// In printSummary(), add team errors to allErrors array
const allErrors = [
  ...stats.errors,
  ...stats.stadion.errors,
  ...stats.photos.download.errors,
  ...stats.photos.upload.errors,
  ...stats.photos.delete.errors,
  ...stats.birthdays.errors,
  ...stats.teams.errors  // [NEW]
];

// Or for separate section per CONTEXT.md decision:
if (stats.teams.errors.length > 0) {
  logger.log(`TEAM SYNC ERRORS (${stats.teams.errors.length})`);
  logger.log(minorDivider);
  stats.teams.errors.forEach(error => {
    const identifier = error.team_name || 'system';
    logger.log(`- ${identifier}: ${error.message}`);
  });
  logger.log('');
}
```

### Anti-Patterns to Avoid

- **Modifying send-email.js HTML parsing:** The existing parser handles ALL CAPS headers and key:value lines automatically. Don't change it; format your output to match.

- **Blocking pipeline on team sync failure:** Use try-catch wrapper. Team sync failures should log errors but not stop photo or birthday sync.

- **Duplicating team prepare/sync logic:** The existing `submit-stadion-teams.js` already handles preparation internally. Just call `runSync()`.

- **Calling team sync before member sync:** Members must sync first so team relationships can reference valid Stadion person IDs.

## Don't Hand-Roll

Problems that look simple but have existing solutions.

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email HTML formatting | Custom HTML generator | send-email.js parser | Automatically converts plain text with headers/dividers to styled HTML |
| Error aggregation | Manual error list building | Spread operator pattern | Existing pattern at lines 130-137 collects from multiple sources |
| Non-critical failure handling | Custom error propagation | try-catch wrapper | Pattern used 4 times already in sync-all.js |
| New team detection | Compare team lists manually | Use created count from submit-stadion-teams.js result | Already calculated during sync |

**Key insight:** The codebase has solved all pipeline integration problems already. Phase 15 is about reusing existing patterns, not inventing new solutions.

## Common Pitfalls

### Pitfall 1: Team Sync Order Relative to Member Sync

**What goes wrong:** Team sync runs before member sync, causing work history assignments to fail because members don't have Stadion IDs yet.

**Why it happens:** Inserting new step in wrong position in pipeline.

**How to avoid:**
- Insert team sync AFTER Step 4 (Stadion member sync)
- Verify members have stadion_id before attempting team operations
- Test with fresh database to catch ordering issues

**Warning signs:**
- Work history sync shows many "skipped: not yet synced to Stadion" messages
- Teams created but member assignments fail

### Pitfall 2: Forgetting to Add to allErrors Array

**What goes wrong:** Team sync errors exist but don't show in ERRORS section or affect exit code.

**Why it happens:** Stats structure created but not included in error aggregation.

**How to avoid:**
- Add `...stats.teams.errors` to allErrors array (line 137)
- Check success calculation includes team errors (line 448)

**Warning signs:**
- Team sync has errors but sync-all reports success
- Email shows 0 errors when team sync failed

### Pitfall 3: Empty Stats Object on Exception

**What goes wrong:** Team sync throws before populating result, stats.teams fields are undefined.

**Why it happens:** Not initializing stats.teams in stats object declaration.

**How to avoid:**
- Initialize stats.teams with all fields at declaration (lines 165-218)
- Default all arrays to [] and numbers to 0

**Warning signs:**
- TypeError: Cannot read property 'errors' of undefined
- printSummary() throws during error case

### Pitfall 4: Email Section Not Appearing

**What goes wrong:** Team sync runs and logs correctly, but email report doesn't show TEAM SYNC section.

**Why it happens:** Section header not in ALL CAPS or missing from printSummary().

**How to avoid:**
- Use exactly 'TEAM SYNC' as header (all caps)
- Add section to printSummary() function before logger.close()

**Warning signs:**
- Console shows team stats but email doesn't
- Email shows BIRTHDAY SYNC but no TEAM SYNC

## Code Examples

Verified patterns from existing codebase.

### Example 1: Import Pattern

```javascript
// Source: sync-all.js lines 1-11
const { runSync: runTeamSync } = require('./submit-stadion-teams');
```

### Example 2: Stats Initialization

```javascript
// Source: sync-all.js lines 165-218, adapted for teams
const stats = {
  // ... existing fields ...
  teams: {
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    newTeamNames: [],
    errors: []
  }
};
```

### Example 3: Non-Critical Sync Wrapper

```javascript
// Source: sync-all.js lines 408-432 (birthday pattern)
// Step 4b: Team Sync (NON-CRITICAL)
logger.verbose('Syncing teams to Stadion...');
try {
  const teamResult = await runTeamSync({ logger, verbose, force });

  stats.teams.total = teamResult.total;
  stats.teams.synced = teamResult.synced;
  stats.teams.created = teamResult.created;
  stats.teams.updated = teamResult.updated;
  stats.teams.skipped = teamResult.skipped;

  // Collect new team names for detailed report
  // Note: submit-stadion-teams.js would need to return newTeamNames
  // if this level of detail is required

  if (teamResult.errors?.length > 0) {
    stats.teams.errors = teamResult.errors.map(e => ({
      team_name: e.team_name,
      message: e.message,
      system: 'team-sync'
    }));
  }
} catch (err) {
  logger.error(`Team sync failed: ${err.message}`);
  stats.teams.errors.push({
    message: `Team sync failed: ${err.message}`,
    system: 'team-sync'
  });
}
```

### Example 4: Summary Section

```javascript
// Source: sync-all.js printSummary() lines 113-128 adapted
logger.log('TEAM SYNC');
logger.log(minorDivider);
if (stats.teams.total > 0) {
  logger.log(`Teams synced: ${stats.teams.synced}/${stats.teams.total}`);
  if (stats.teams.created > 0) {
    logger.log(`  Created: ${stats.teams.created}`);
  }
  if (stats.teams.updated > 0) {
    logger.log(`  Updated: ${stats.teams.updated}`);
  }
  if (stats.teams.skipped > 0) {
    logger.log(`  Skipped: ${stats.teams.skipped} (unchanged)`);
  }
} else {
  logger.log('Teams synced: 0 changes');
}
logger.log('');
```

### Example 5: Updated Success Calculation

```javascript
// Source: sync-all.js lines 447-454 adapted
return {
  success: stats.errors.length === 0 &&
           stats.stadion.errors.length === 0 &&
           stats.photos.download.errors.length === 0 &&
           stats.photos.upload.errors.length === 0 &&
           stats.photos.delete.errors.length === 0 &&
           stats.birthdays.errors.length === 0 &&
           stats.teams.errors.length === 0,  // [NEW]
  stats
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual HTML email | Auto-formatting from plain text | Phase 7 | Add sections by matching ALL CAPS pattern |
| Stop on any error | Non-critical steps wrapped in try-catch | Phase 8 | Pipeline continues despite individual failures |
| Single error list | Per-system error collection with `system` field | Phase 8 | Clear error attribution in reports |

**Deprecated/outdated:**
- None - pipeline patterns are stable and well-tested.

## Open Questions

Things that couldn't be fully resolved.

1. **New team names for detailed report**
   - What we know: CONTEXT.md requests "3 new teams: JO11-1, MO13-2, JO15-1" format
   - What's unclear: `submit-stadion-teams.js` returns created count but not team names
   - Recommendation: Modify `submit-stadion-teams.js` to return `newTeamNames: []` array, or query database after sync to find recently created teams. Low effort modification.

2. **Member assignment breakdown format**
   - What we know: CONTEXT.md requests per-team breakdown ("JO11-1: 12 members")
   - What's unclear: This data comes from work_history sync, not team sync. Phase 14 was work history sync which would have this data.
   - Recommendation: This may be out of scope for Phase 15 unless work history sync is integrated into pipeline. Check if Phase 14 work history sync is also being integrated.

3. **Report section ordering**
   - What we know: CONTEXT.md marks this as Claude's discretion
   - What's unclear: Where TEAM SYNC section should appear relative to others
   - Recommendation: Place after STADION SYNC and before PHOTO SYNC to follow data dependency order.

## Sources

### Primary (HIGH confidence)
- `/Users/joostdevalk/Code/sportlink-sync/sync-all.js` - Pipeline orchestration, non-critical sync pattern, summary format
- `/Users/joostdevalk/Code/sportlink-sync/scripts/send-email.js` - Email HTML formatting logic
- `/Users/joostdevalk/Code/sportlink-sync/submit-stadion-teams.js` - Team sync implementation and result structure

### Secondary (MEDIUM confidence)
- `/Users/joostdevalk/Code/sportlink-sync/sync-important-dates.js` - Similar non-critical sync pattern
- `/Users/joostdevalk/Code/sportlink-sync/lib/logger.js` - Logging API

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All code exists and is verified in codebase
- Architecture: HIGH - Exact patterns visible in sync-all.js lines 334-432
- Pitfalls: HIGH - Based on direct code analysis of existing integration points

**Research date:** 2026-01-26
**Valid until:** 90 days (pipeline patterns are stable; no external dependencies)
