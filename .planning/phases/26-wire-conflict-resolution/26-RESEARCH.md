# Phase 26: Wire Conflict Resolution to Forward Sync - Research

**Researched:** 2026-01-29
**Domain:** Conflict resolution integration and bidirectional sync orchestration
**Confidence:** HIGH

## Summary

Phase 26 addresses the second critical integration gap from the v2.0 Milestone Audit: the conflict resolution infrastructure built in Phase 21 exists but is never called by forward sync. When both Sportlink and Stadion have modified the same field, forward sync currently overwrites Stadion's value without timestamp comparison, allowing silent data loss.

The conflict resolver (`lib/conflict-resolver.js`) is complete, tested, and ready for integration:
- `resolveFieldConflicts()` performs per-field timestamp comparison with 5-second grace period
- Last-write-wins (LWW) logic with configurable tie-breaker (Sportlink wins within grace period)
- Audit logging to `conflict_resolutions` table
- Email-ready plain text summaries via `generateConflictSummary()`

All infrastructure exists. The gap is purely wiring: `submit-stadion-sync.js` must call `resolveFieldConflicts()` before updating Stadion to detect bidirectional conflicts and apply the winning value.

This is not new feature development - it's connecting two existing, tested modules. The forward sync pipeline already has all the data required (member row from database includes both Sportlink and Stadion timestamps), and the conflict resolver returns resolved values ready to merge into the update payload.

**Primary recommendation:** Integrate `resolveFieldConflicts()` into the `syncPerson()` function in `submit-stadion-sync.js` during UPDATE operations. Fetch current Stadion field values, resolve conflicts, apply winning values to update payload, and append conflict summary to email reports.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lib/conflict-resolver.js | existing | Conflict detection and resolution (Phase 21) | Complete LWW logic with grace period, audit logging, email summaries |
| lib/sync-origin.js | existing | Timestamp utilities and field definitions | Provides TRACKED_FIELDS, compareTimestamps(), createTimestamp() |
| lib/stadion-db.js | existing | Database operations | Provides logConflictResolution() and conflict_resolutions table (Phase 21) |
| submit-stadion-sync.js | existing | Forward sync orchestration | Entry point for member updates to Stadion |
| lib/stadion-client.js | existing | Stadion API client | GET for fetching current values, PUT for applying resolved values |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/logger.js | existing | Dual-stream logging | Shared logger captures conflict resolutions for email reports |
| scripts/send-email.js | existing | Email report delivery | formatAsHtml() handles "CONFLICTS DETECTED" sections automatically |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline conflict resolution | Call conflict-resolver module | Module is cleaner, tested, reusable across forward and reverse sync |
| Resolve in prepare step | Resolve in submit step | Submit step has Stadion ID, can fetch current values for comparison |
| Always favor Sportlink | Timestamp-based LWW | LWW respects user edits in Stadion, prevents silent data loss |
| Skip conflict detection on error | Log error, continue sync | Per CONTEXT.md: skip member on conflict error, don't abort entire sync |

**Installation:**
No new dependencies required - all components already exist.

## Architecture Patterns

### Recommended Integration Structure
```
submit-stadion-sync.js (modify syncPerson function)
├── UPDATE path (when stadion_id exists)
    ├── GET current Stadion data (already done for financial block comparison)
    ├── Extract tracked field values from both systems
    ├── resolveFieldConflicts()  # NEW
    ├── Apply winning values to update payload  # NEW
    ├── PUT to Stadion with resolved payload
    └── Log conflict summary to email report  # NEW
```

### Pattern 1: Conflict Resolution During Update Operation
**What:** Call `resolveFieldConflicts()` before PUT to detect bidirectional edits
**When to use:** Every member UPDATE in forward sync (not CREATE - new members have no Stadion history)
**Example:**
```javascript
// Source: submit-stadion-sync.js (to be modified) + lib/conflict-resolver.js
const { resolveFieldConflicts } = require('./lib/conflict-resolver');

async function syncPerson(member, db, options) {
  const { knvb_id, data, stadion_id } = member;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (() => {});

  if (stadion_id) {
    // UPDATE path - conflict resolution applies here

    // Fetch current Stadion data
    const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
    const stadionData = extractTrackedFieldValues(existing.body);
    const sportlinkData = extractTrackedFieldValues(data);

    // Resolve conflicts using timestamp comparison
    const { resolutions, conflicts } = resolveFieldConflicts(
      member,         // Database row with timestamps
      sportlinkData,  // Current Sportlink values
      stadionData,    // Current Stadion values
      db,             // For audit logging
      options.logger  // For verbose output
    );

    // Apply winning values to update payload
    const resolvedData = applyResolutions(data, resolutions);

    // Update Stadion with resolved data
    await stadionRequest(`wp/v2/people/${stadion_id}`, 'PUT', resolvedData, options);

    // Return conflicts for email reporting
    return { action: 'updated', id: stadion_id, conflicts };
  }

  // CREATE path - no conflict resolution (no existing Stadion data)
  // ... existing CREATE logic unchanged
}
```

**Key decisions:**
- Conflict resolution ONLY during UPDATE (CREATE has no prior Stadion state)
- Fetch current Stadion values before resolution (needed for comparison)
- Apply winning values to update payload (not just log conflicts)
- Return conflicts array for aggregation into email report

### Pattern 2: Extract Tracked Field Values for Comparison
**What:** Convert ACF data structure to flat field map for conflict resolver
**When to use:** Before calling `resolveFieldConflicts()` to normalize data formats
**Example:**
```javascript
// Helper function to extract tracked fields from ACF structure
function extractTrackedFieldValues(aclData) {
  const values = {};
  const acf = aclData.acf || {};

  // Contact fields (from contact_info repeater or direct ACF)
  // Note: Stadion stores in contact_info repeater, Sportlink prep stores as direct ACF
  const contactInfo = acf.contact_info || [];

  values.email = acf.email || contactInfo.find(c => c.contact_type === 'email')?.contact_value || null;
  values.email2 = acf.email2 || contactInfo.find(c => c.contact_type === 'email2')?.contact_value || null;
  values.mobile = acf.mobile || contactInfo.find(c => c.contact_type === 'mobile')?.contact_value || null;
  values.phone = acf.phone || contactInfo.find(c => c.contact_type === 'phone')?.contact_value || null;

  // Direct ACF fields
  values.datum_vog = acf['datum-vog'] || null;
  values.freescout_id = acf['freescout-id'] || null;
  values.financiele_blokkade = acf['financiele-blokkade'] || null;

  return values;
}
```

**Gotcha:** Stadion stores contact fields in `contact_info` repeater array, while prepared Sportlink data may have them as direct ACF fields. The extractor must handle both formats.

**Source:** Similar logic exists in `lib/detect-stadion-changes.js` lines 37-83 (`extractFieldValue()`).

### Pattern 3: Apply Resolutions to Update Payload
**What:** Merge winning values from conflict resolver into ACF update data
**When to use:** After `resolveFieldConflicts()` returns, before PUT to Stadion
**Example:**
```javascript
// Apply conflict resolutions to update payload
function applyResolutions(originalData, resolutions) {
  const resolvedData = JSON.parse(JSON.stringify(originalData)); // Deep clone

  for (const [field, resolution] of resolutions.entries()) {
    const acfFieldName = field.replace('_', '-'); // Convert datum_vog to datum-vog

    // Apply winning value to ACF structure
    // Note: Contact fields may need special handling if stored in contact_info repeater
    resolvedData.acf[acfFieldName] = resolution.value;
  }

  return resolvedData;
}
```

**Important:** Field name mapping - database/resolver uses underscores (`datum_vog`), ACF fields use hyphens (`datum-vog`).

### Pattern 4: Aggregate Conflicts for Email Report
**What:** Collect conflicts from all member syncs and append summary to report
**When to use:** End of `runSync()` after all members processed
**Example:**
```javascript
// In runSync() function
const allConflicts = [];

for (const member of needsSync) {
  const syncResult = await syncPerson(member, db, options);

  if (syncResult.conflicts && syncResult.conflicts.length > 0) {
    allConflicts.push(...syncResult.conflicts);
  }
}

// Generate and log conflict summary for email report
if (allConflicts.length > 0) {
  const { generateConflictSummary } = require('./lib/conflict-resolver');
  const summary = generateConflictSummary(allConflicts);

  logger.log(''); // Blank line separator
  logger.log(summary); // Outputs "CONFLICTS DETECTED AND RESOLVED" section
}

return {
  success: true,
  synced,
  created,
  updated,
  conflicts: allConflicts.length
};
```

**Benefits:**
- Conflicts grouped by member in email report
- All-caps header "CONFLICTS DETECTED AND RESOLVED" triggers `formatAsHtml()` H2 styling
- Summary includes per-field details: field name, both values, winner, timestamp comparison
- Zero conflicts = no section in email (graceful)

**Source:** `generateConflictSummary()` in `lib/conflict-resolver.js` lines 129-168.

### Pattern 5: Skip Member on Conflict Resolution Error
**What:** Catch conflict resolution errors, log details, continue with next member
**When to use:** Every member sync to prevent single bad record from aborting entire sync
**Example:**
```javascript
// Per CONTEXT.md error handling requirements
for (const member of needsSync) {
  try {
    const syncResult = await syncPerson(member, db, options);
    result.synced++;
    if (syncResult.conflicts) {
      allConflicts.push(...syncResult.conflicts);
    }
  } catch (error) {
    // Log detailed error for skipped member
    logger.error(`Failed to sync ${member.knvb_id}: ${error.message}`);
    if (error.stack) {
      logger.verbose(`Stack trace: ${error.stack}`);
    }

    result.errors.push({
      knvb_id: member.knvb_id,
      email: member.email,
      message: error.message,
      phase: 'conflict_resolution'
    });

    // Continue with next member - don't throw
  }
}
```

**Critical:** Don't throw from error handler - would abort remaining members. Log and continue per CONTEXT.md requirement.

### Anti-Patterns to Avoid
- **Resolving conflicts in prepare step:** Too early - no Stadion ID yet, can't fetch current values
- **Resolving during CREATE:** New members have no Stadion history, no conflict possible
- **Not returning conflicts array:** Email report would miss conflict details
- **Throwing on conflict resolution error:** Aborts entire sync instead of skipping one member
- **Hardcoding field names:** Use `TRACKED_FIELDS` constant from `sync-origin.js`
- **Ignoring grace period:** Without 5-second tolerance, clock drift causes false conflicts

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timestamp comparison | Custom date math | compareTimestamps() from sync-origin.js | Handles NULL timestamps, grace period, clock drift edge cases |
| Conflict detection logic | Custom field-by-field checks | resolveFieldConflicts() from conflict-resolver.js | Complete LWW implementation with audit logging and tie-breaker rules |
| Conflict summary formatting | Custom text formatting | generateConflictSummary() from conflict-resolver.js | Pre-formatted for email system, groups by member, handles zero conflicts |
| Audit logging | Direct SQL inserts | logConflictResolution() from stadion-db.js | Prepared statement, correct schema, indexed for queries |
| Field name mapping | Hardcoded field lists | TRACKED_FIELDS constant | Single source of truth, maintained in sync-origin.js |

**Key insight:** Phase 21 built complete conflict resolution infrastructure. Integration requires wiring, not reimplementation. The resolver handles all edge cases (NULL timestamps, grace period, value equality checks, audit logging).

## Common Pitfalls

### Pitfall 1: Not Fetching Current Stadion Values
**What goes wrong:** Conflict resolver compares Sportlink to stale Stadion data from database
**Why it happens:** Database stores previous sync state, not current Stadion values
**How to avoid:** Always GET current Stadion data before calling `resolveFieldConflicts()`
**Warning signs:** Conflicts detected for fields that haven't actually changed

**Example - WRONG:**
```javascript
// Using data from member.data (stale Sportlink preparation)
const stadionData = member.data; // This is Sportlink data, not current Stadion!
const { resolutions } = resolveFieldConflicts(member, sportlinkData, stadionData, db);
```

**Example - CORRECT:**
```javascript
// Fetch current Stadion state
const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
const stadionData = extractTrackedFieldValues(existing.body);
const { resolutions } = resolveFieldConflicts(member, sportlinkData, stadionData, db);
```

### Pitfall 2: Field Name Mismatches (Underscores vs Hyphens)
**What goes wrong:** `resolveFieldConflicts()` returns `datum_vog`, but ACF field is `datum-vog`
**Why it happens:** Database columns use underscores, ACF field names use hyphens
**How to avoid:** Convert field names when applying resolutions to ACF payload
**Warning signs:** 400 errors from Stadion API about unknown fields

**Mapping:**
- `datum_vog` → `datum-vog`
- `freescout_id` → `freescout-id`
- `financiele_blokkade` → `financiele-blokkade`
- Contact fields (email, email2, mobile, phone) → no change

**Source:** Field naming convention from `lib/sync-origin.js` (underscores) and ACF schema (hyphens).

### Pitfall 3: Resolving Conflicts During CREATE
**What goes wrong:** Conflict resolution called for new members with no Stadion history
**Why it happens:** Forgetting to check if operation is CREATE vs UPDATE
**How to avoid:** Only call `resolveFieldConflicts()` in UPDATE path (when `stadion_id` exists)
**Warning signs:** Errors fetching Stadion data for new members, unnecessary API calls

**Correct logic:**
```javascript
if (stadion_id) {
  // UPDATE path - conflict resolution applies
  const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
  const { resolutions, conflicts } = resolveFieldConflicts(member, sportlinkData, stadionData, db);
  // ... apply resolutions
} else {
  // CREATE path - skip conflict resolution
  // New member has no Stadion history, nothing to conflict with
}
```

### Pitfall 4: Not Handling Contact Info Repeater Structure
**What goes wrong:** `extractTrackedFieldValues()` fails because Stadion stores contact fields differently than prepared Sportlink data
**Why it happens:** Stadion uses `contact_info` repeater array, Sportlink prep uses direct ACF fields
**How to avoid:** Check both locations when extracting field values (see Pattern 2)
**Warning signs:** Conflicts detected even when values are identical, NULL values when data exists

**Evidence:** `lib/detect-stadion-changes.js` lines 37-83 shows correct extraction logic handling both formats.

### Pitfall 5: Conflict Summary Not in Email Report
**What goes wrong:** Conflicts are resolved but operator never sees them in email
**Why it happens:** `generateConflictSummary()` output not logged through shared logger
**How to avoid:** Log conflict summary through same logger instance used for sync
**Warning signs:** Audit table has conflict records but email reports don't mention them

**Correct pattern:**
```javascript
// After all members synced
if (allConflicts.length > 0) {
  const { generateConflictSummary } = require('./lib/conflict-resolver');
  const summary = generateConflictSummary(allConflicts);
  logger.log(''); // Blank line
  logger.log(summary); // Goes to email via shared logger
}
```

**Result:** Email report gets "CONFLICTS DETECTED AND RESOLVED" section automatically formatted as H2 header by `formatAsHtml()`.

### Pitfall 6: Grace Period Configuration Confusion
**What goes wrong:** Different grace periods used in different places, inconsistent behavior
**Why it happens:** Grace period passed as parameter, could be varied accidentally
**How to avoid:** Always use 5000ms (5 seconds) - this is the standard set in Phase 21
**Warning signs:** Some conflicts resolved differently than others, tests fail intermittently

**Per CONTEXT.md:** Grace period is at Claude's discretion. Standard is 5 seconds (5000ms) from Phase 21.

**Source:** `lib/conflict-resolver.js` line 65 uses 5000ms as default.

### Pitfall 7: Required ACF Fields on Partial Updates
**What goes wrong:** PUT request fails with 400 error when updating conflict-resolved fields
**Why it happens:** Stadion API requires `first_name` and `last_name` even for partial ACF updates
**How to avoid:** Always include required fields in update payload, even when not modified
**Warning signs:** 400 errors with message about missing required fields

**Per CLAUDE.md Stadion API Gotchas:**
```javascript
// WRONG - will return 400 error
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: { email: resolvedEmail }
});

// CORRECT - include required fields
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: {
    first_name: existing.body.acf.first_name,  // Required
    last_name: existing.body.acf.last_name,    // Required
    email: resolvedEmail                        // Updated field
  }
});
```

**Note:** This is already handled in current `syncPerson()` implementation - the `data` object includes all required fields from Sportlink preparation. Just ensure not to strip them when applying resolutions.

## Code Examples

Verified patterns from official sources and existing codebase:

### Integration Point in submit-stadion-sync.js
```javascript
// Source: submit-stadion-sync.js (to be modified) + lib/conflict-resolver.js
const { resolveFieldConflicts, generateConflictSummary } = require('./lib/conflict-resolver');
const { TRACKED_FIELDS } = require('./lib/sync-origin');

/**
 * Extract tracked field values from ACF data structure
 * Handles both contact_info repeater (Stadion) and direct ACF fields (Sportlink)
 */
function extractTrackedFieldValues(aclData) {
  const values = {};
  const acf = aclData.acf || {};
  const contactInfo = acf.contact_info || [];

  // Contact fields - check both repeater and direct ACF
  values.email = acf.email || contactInfo.find(c => c.contact_type === 'email')?.contact_value || null;
  values.email2 = acf.email2 || contactInfo.find(c => c.contact_type === 'email2')?.contact_value || null;
  values.mobile = acf.mobile || contactInfo.find(c => c.contact_type === 'mobile')?.contact_value || null;
  values.phone = acf.phone || contactInfo.find(c => c.contact_type === 'phone')?.contact_value || null;

  // Direct ACF fields (use hyphens for actual field names)
  values.datum_vog = acf['datum-vog'] || null;
  values.freescout_id = acf['freescout-id'] || null;
  values.financiele_blokkade = acf['financiele-blokkade'] || null;

  return values;
}

/**
 * Apply conflict resolutions to update payload
 * Converts field names (underscores to hyphens) and merges winning values
 */
function applyResolutions(originalData, resolutions) {
  const resolvedData = JSON.parse(JSON.stringify(originalData)); // Deep clone

  for (const [field, resolution] of resolutions.entries()) {
    // Convert field name: datum_vog -> datum-vog
    const acfFieldName = field.replace(/_/g, '-');

    // Apply winning value
    if (resolvedData.acf) {
      resolvedData.acf[acfFieldName] = resolution.value;
    }
  }

  return resolvedData;
}

/**
 * Sync a single member to Stadion (create or update)
 * PHASE 26: Now includes conflict resolution for UPDATE operations
 */
async function syncPerson(member, db, options) {
  const { knvb_id, data, source_hash } = member;
  let { stadion_id } = member;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (() => {});
  let conflicts = [];

  if (stadion_id) {
    // UPDATE existing person
    logVerbose(`Updating existing person: ${stadion_id}`);

    try {
      // Fetch current Stadion data for conflict detection
      const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);

      // PHASE 26: Resolve conflicts before updating
      const stadionData = extractTrackedFieldValues(existing.body);
      const sportlinkData = extractTrackedFieldValues(data);

      const { resolutions, conflicts: detectedConflicts } = resolveFieldConflicts(
        member,         // Database row with timestamps
        sportlinkData,  // Current Sportlink values
        stadionData,    // Current Stadion values
        db,             // For audit logging
        options.logger  // For verbose output
      );

      conflicts = detectedConflicts;

      if (conflicts.length > 0) {
        logVerbose(`  Resolved ${conflicts.length} conflict(s) for ${knvb_id}`);
      }

      // Apply winning values to update payload
      const resolvedData = applyResolutions(data, resolutions);

      // Update Stadion with resolved data
      await stadionRequest(`wp/v2/people/${stadion_id}`, 'PUT', resolvedData, options);
      updateSyncState(db, knvb_id, source_hash, stadion_id);

      // Financial block activity logging (existing code)
      // ... keep existing financial block comparison logic

      return { action: 'updated', id: stadion_id, conflicts };

    } catch (error) {
      // Handle 404 (person deleted) - existing error handling unchanged
      // ... keep existing 404 handling logic
      throw error;
    }
  }

  // CREATE new person - no conflict resolution (no Stadion history)
  // ... existing CREATE logic unchanged
  return { action: 'created', id: newId, conflicts: [] };
}
```

**Key changes:**
1. Import conflict resolver functions at top of file
2. Add `extractTrackedFieldValues()` helper
3. Add `applyResolutions()` helper
4. In UPDATE path: fetch current Stadion data, resolve conflicts, apply winning values
5. Return conflicts array for aggregation
6. CREATE path unchanged (no conflict resolution for new members)

### Conflict Summary in Email Report
```javascript
// Source: submit-stadion-sync.js runSync() function (to be modified)
async function runSync(options = {}) {
  const { logger, verbose = false } = options;
  const logVerbose = logger?.verbose.bind(logger) || (() => {});

  const result = {
    success: true,
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    conflicts: 0,  // NEW: Track conflict count
    errors: []
  };

  const allConflicts = [];  // NEW: Collect conflicts from all members

  try {
    const db = openDb();

    // ... existing member preparation logic

    // Sync each member
    for (let i = 0; i < needsSync.length; i++) {
      const member = needsSync[i];
      logVerbose(`Syncing ${i + 1}/${needsSync.length}: ${member.knvb_id}`);

      try {
        const syncResult = await syncPerson(member, db, options);
        result.synced++;
        if (syncResult.action === 'created') result.created++;
        if (syncResult.action === 'updated') result.updated++;

        // NEW: Collect conflicts
        if (syncResult.conflicts && syncResult.conflicts.length > 0) {
          allConflicts.push(...syncResult.conflicts);
        }
      } catch (error) {
        // Error handling per CONTEXT.md: skip member, continue sync
        logger.error(`Failed to sync ${member.knvb_id}: ${error.message}`);
        result.errors.push({
          knvb_id: member.knvb_id,
          message: error.message
        });
      }
    }

    // NEW: Log conflict summary for email report
    if (allConflicts.length > 0) {
      const { generateConflictSummary } = require('./lib/conflict-resolver');
      const summary = generateConflictSummary(allConflicts);

      logger.log(''); // Blank line separator
      logger.log(summary); // "CONFLICTS DETECTED AND RESOLVED" section

      result.conflicts = allConflicts.length;
    }

    db.close();
    result.success = result.errors.length === 0;
    return result;

  } catch (error) {
    logger.error(`Sync error: ${error.message}`);
    return { success: false, errors: [{ message: error.message }] };
  }
}
```

**Changes:**
1. Add `allConflicts` array to collect conflicts from all members
2. Check each `syncResult.conflicts` and append to array
3. After all members synced, generate and log conflict summary
4. Add `conflicts` count to result object

**Email output:**
```
STADION SYNC

Total members: 150
Synced: 3
Created: 0
Updated: 3
Skipped: 147

CONFLICTS DETECTED AND RESOLVED

Total conflicts: 5
Members affected: 2

RESOLUTION DETAILS

- KNVB123456: 2 field(s)
  email: stadion won (stadion newer)
  mobile: sportlink won (sportlink newer)
- KNVB789012: 3 field(s)
  email2: stadion won (stadion newer)
  phone: sportlink won (grace period sportlink wins)
  datum-vog: sportlink won (only sportlink has history)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No conflict detection | Per-field timestamp comparison | Phase 21 infrastructure | Detects bidirectional edits accurately |
| Last sync wins (overwrite) | Last-write-wins (LWW) | Phase 21 logic | Respects user edits in both systems |
| Silent data loss | Audit logging + email notification | Phase 21 + Phase 26 integration | Operator visibility into conflicts |
| No grace period | 5-second tolerance | Phase 21 default | Handles clock drift, simultaneous edits |
| Forward-only sync | Bidirectional with conflict resolution | Phase 21-26 complete | True bidirectional sync without data loss |

**Deprecated/outdated:**
- Overwrite-based forward sync: Use conflict resolution instead
- Separate forward and reverse pipelines without coordination: Use integrated conflict detection
- Manual conflict resolution: Automated LWW with audit trail

## Open Questions

1. **Grace Period Duration**
   - What we know: Phase 21 uses 5000ms (5 seconds) as default tolerance for clock drift
   - What's unclear: Is 5 seconds appropriate for production environment?
   - Recommendation: Keep 5 seconds - matches Phase 21 implementation, balances clock drift vs real conflicts
   - Trade-off: Shorter = more false conflicts from clock drift, longer = miss near-simultaneous edits
   - Per CONTEXT.md: Claude's discretion - recommend keeping Phase 21 default

2. **Exact Integration Point Within syncPerson()**
   - What we know: Must be in UPDATE path after fetching current Stadion data
   - What's unclear: Before or after financial block status comparison?
   - Recommendation: Before financial block check - resolve all conflicts first, then compare statuses
   - Rationale: Conflict resolution may change `financiele-blokkade` field, want to log activity with final value
   - Per CONTEXT.md: Claude's discretion - recommend before financial block comparison for consistency

3. **Conflict Summary Verbosity in Email**
   - What we know: `generateConflictSummary()` outputs per-field details for all conflicts
   - What's unclear: Is this too verbose if many members have conflicts?
   - Recommendation: Keep full details per CONTEXT.md requirement ("show each conflict: field name, both values, which system won, timestamp comparison")
   - Evidence: Email requirement explicitly asks for per-field details for operator review
   - Alternative: Could add summary-only mode if emails become too long in practice

4. **Performance Impact of Extra GET Request**
   - What we know: UPDATE path already does GET for financial block comparison (line 76 in current code)
   - What's unclear: Will conflict resolution add overhead?
   - Recommendation: No additional overhead - reuse existing GET, extract both financial block and tracked fields from same response
   - Evidence: Current code already fetches full person record at line 76-77

## Sources

### Primary (HIGH confidence)
- lib/conflict-resolver.js - Complete conflict resolution implementation (lines 1-174)
- lib/sync-origin.js - Timestamp utilities and TRACKED_FIELDS constant (lines 1-107)
- lib/stadion-db.js - Audit logging and conflict_resolutions table (lines 328-343, 2301-2327)
- submit-stadion-sync.js - Forward sync orchestration needing modification (lines 1-712)
- v2.0-MILESTONE-AUDIT.md - Gap analysis identifying orphaned conflict resolver (lines 102-116)
- .planning/phases/26-wire-conflict-resolution/26-CONTEXT.md - User decisions and requirements (complete file)
- lib/detect-stadion-changes.js - Field extraction pattern for tracked fields (lines 37-83)

### Secondary (MEDIUM confidence)
- .planning/phases/25-wire-change-detection/25-RESEARCH.md - Integration pattern reference (complete file)
- .planning/phases/21-conflict-resolution/21-VERIFICATION.md - Conflict resolver testing (if exists)
- scripts/send-email.js - Email formatting for conflict summaries (lines 52-150)
- CLAUDE.md - Stadion API required fields gotcha (lines 68-88)

### Tertiary (LOW confidence)
- None - all findings based on existing codebase and explicit user requirements

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already exist, tested in Phase 21
- Architecture: HIGH - Similar integration pattern to Phase 25 (proven approach)
- Pitfalls: HIGH - Based on existing code patterns and known API gotchas
- Integration point: HIGH - Clear from code structure and user decisions

**Research date:** 2026-01-29
**Valid until:** 90 days (stable codebase, no external dependencies)

**Complexity assessment:** MEDIUM
- Lines of code to add: ~80 (two helper functions + integration logic + summary logging)
- New files needed: 0
- New dependencies: 0
- Risk level: Low-Medium (touching core sync logic but isolated to UPDATE path)
- Estimated implementation time: 30-45 minutes
- Testing requirement: HIGH (affects data integrity, must verify conflict resolution correctness)
