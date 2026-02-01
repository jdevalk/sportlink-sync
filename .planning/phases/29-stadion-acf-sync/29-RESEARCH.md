# Phase 29: Stadion ACF Sync - Research

**Researched:** 2026-02-01
**Domain:** WordPress REST API / ACF Field Updates
**Confidence:** HIGH

## Summary

Phase 29 syncs per-year Nikki contribution data from SQLite to Stadion WordPress ACF fields. The codebase already has a working sync pattern (`sync-nikki-to-stadion.js`) that updates the `nikki-contributie-status` WYSIWYG field with HTML. This phase extends that pattern to sync individual per-year fields (`_nikki_{year}_total`, `_nikki_{year}_saldo`, `_nikki_{year}_status`).

Key findings:
- WordPress ACF PUT updates require `first_name` and `last_name` fields even for partial updates (documented gotcha)
- Existing `sync-nikki-to-stadion.js` already implements the required GET-then-PUT pattern with retry logic
- SQLite database schema supports per-year data with 4-year retention window
- No new dependencies required - all infrastructure exists

**Primary recommendation:** Extend `sync-nikki-to-stadion.js` to write per-year ACF fields in addition to the HTML summary field. Use same change detection, retry logic, and error handling patterns already proven in production.

## Standard Stack

### Core (Already in Project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | Current | SQLite database access | Official SQLite bindings, synchronous API matches use case |
| crypto (Node.js) | Built-in | SHA-256 hashing for change detection | Native, no dependencies, proven pattern |
| https (Node.js) | Built-in | REST API requests | Native, matches existing stadion-client.js |

### Supporting (Already in Project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| varlock | Current | .env file loading | Auto-load pattern at top of files |
| lib/logger.js | Custom | Dual-stream logging | All sync scripts use createSyncLogger |
| lib/stadion-client.js | Custom | WordPress API client | All Stadion API requests |
| lib/nikki-db.js | Custom | Nikki SQLite operations | Reading contribution data |
| lib/stadion-db.js | Custom | Stadion SQLite operations | KNVB → Stadion ID mapping |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending sync-nikki-to-stadion.js | New standalone script | New script duplicates 80% of existing code (GET-PUT pattern, retry logic, KNVB→Stadion mapping) |
| Hash-based change detection | Always update | Wastes API calls, increases Stadion load (500ms delays between updates) |
| Sequential updates | Parallel updates | Parallel risks overwhelming Stadion server; existing pattern uses 500ms delay between members |

**Installation:**
No new packages required. All dependencies already installed.

## Architecture Patterns

### Recommended Project Structure

```
lib/
├── nikki-db.js              # Read contributions by KNVB ID
├── stadion-db.js            # KNVB → Stadion ID mapping
├── stadion-client.js        # HTTP requests with Basic Auth
└── logger.js                # Logging infrastructure

sync-nikki-to-stadion.js     # Main sync script (EXTEND THIS)
```

### Pattern 1: GET-then-PUT for ACF Updates

**What:** Always fetch existing person data before updating ACF fields

**When to use:** Every time you update ACF fields (required by WordPress/ACF)

**Why:** WordPress ACF PUT endpoint requires `first_name` and `last_name` even for partial updates. This is a documented Stadion API gotcha.

**Example:**
```javascript
// Source: sync-nikki-to-stadion.js lines 149-176
// CORRECT pattern - already implemented
const response = await stadionRequestWithRetry(
  `wp/v2/people/${stadionId}?_fields=acf`,
  'GET',
  null,
  { verbose: false }
);

const existingFirstName = response.body?.acf?.first_name || '';
const existingLastName = response.body?.acf?.last_name || '';

// Now safe to PUT with ACF updates
await stadionRequestWithRetry(
  `wp/v2/people/${stadionId}`,
  'PUT',
  {
    acf: {
      first_name: existingFirstName,  // REQUIRED
      last_name: existingLastName,    // REQUIRED
      '_nikki_2025_total': 150.00,    // New field
      '_nikki_2025_saldo': 50.00,     // New field
      '_nikki_2025_status': 'Debet'   // New field
    }
  },
  { verbose: false }
);
```

### Pattern 2: Retry with Exponential Backoff

**What:** Retry transient 5xx errors with increasing delays (1s, 2s, 4s)

**When to use:** All Stadion API requests (server can be slow/overloaded)

**Example:**
```javascript
// Source: sync-nikki-to-stadion.js lines 58-81
// Already implemented as stadionRequestWithRetry()
async function stadionRequestWithRetry(endpoint, method, body, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await stadionRequest(endpoint, method, body, options);
    } catch (error) {
      lastError = error;
      const status = error.message?.match(/\((\d+)\)/)?.[1];
      if (!status || parseInt(status, 10) < 500) {
        throw error; // Don't retry 4xx (client errors)
      }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
```

### Pattern 3: Hash-based Change Detection

**What:** Compute hash of field values, skip update if unchanged

**When to use:** Reducing unnecessary API calls (Stadion updates take 500ms each)

**Example:**
```javascript
// Source: sync-nikki-to-stadion.js lines 44-46, 163-169
function computeContentHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data) || '').digest('hex');
}

// In sync loop
const currentHash = computeContentHash(currentValue);
const newHash = computeContentHash(newValue);
if (currentHash === newHash) {
  logger.verbose('No changes, skipping');
  result.skipped++;
  continue;
}
```

### Pattern 4: KNVB → Stadion ID Mapping

**What:** Use local SQLite mapping instead of searching WordPress API

**When to use:** Every sync operation (avoids expensive API searches)

**Example:**
```javascript
// Source: sync-nikki-to-stadion.js lines 114-122
const stadionDb = openStadionDb();
const trackedMembers = getAllTrackedMembers(stadionDb);
const knvbIdToStadionId = new Map();
for (const member of trackedMembers) {
  if (member.knvb_id && member.stadion_id) {
    knvbIdToStadionId.set(member.knvb_id, member.stadion_id);
  }
}

// Later: O(1) lookup instead of API search
const stadionId = knvbIdToStadionId.get(knvbId);
```

### Pattern 5: Sequential Member Updates with Delays

**What:** Process members one at a time with 500ms delay between updates

**When to use:** All bulk Stadion syncs (prevents server overload)

**Example:**
```javascript
// Source: sync-nikki-to-stadion.js lines 129-221
for (const [knvbId, contributions] of contributionsByMember) {
  // ... update logic ...

  // Delay between requests
  if (processed < contributionsByMember.size) {
    await new Promise(r => setTimeout(r, 500));
  }
}
```

### Anti-Patterns to Avoid

- **Parallel Stadion updates:** Server can't handle concurrent requests well, use sequential with delays
- **Skipping GET before PUT:** Will fail with 400 error (missing required first_name/last_name)
- **Retrying 4xx errors:** Client errors (bad request) won't fix themselves, fail fast
- **Hardcoded field names without year:** Use template literals for dynamic field names (`_nikki_${year}_total`)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Change detection | String comparison or manual diffing | crypto.createHash('sha256') (Node.js built-in) | Edge cases: null vs empty string, object key order, floating point precision |
| Exponential backoff | Custom delay calculation | `Math.pow(2, attempt) * 1000` pattern from sync-nikki-to-stadion.js | Already tested in production, matches Stadion's timeout behavior |
| ACF field updates | Direct PUT requests | GET-then-PUT pattern with required fields | WordPress ACF API requires first_name/last_name even for partial updates |
| SQLite transactions | Manual BEGIN/COMMIT | better-sqlite3 db.transaction() wrapper | Automatic rollback on error, performance optimization |
| KNVB → Stadion mapping | API search on each sync | SQLite mapping table (stadion_members) | API search is slow (100ms+), mapping is instant (local SQLite) |

**Key insight:** WordPress ACF API is quirky - always fetch current data before updating. The codebase has already solved these problems in `sync-nikki-to-stadion.js`.

## Common Pitfalls

### Pitfall 1: Missing Required Fields on ACF Updates

**What goes wrong:** 400 Bad Request when updating ACF fields without first_name/last_name

**Why it happens:** WordPress ACF validates required fields even on partial updates (PUT requests)

**How to avoid:**
1. Always GET current person data first
2. Extract existing `first_name` and `last_name`
3. Include them in every PUT request's ACF payload

**Warning signs:**
- Error message: "rest_invalid_param" or "Invalid parameter(s): acf"
- Status code: 400
- Only happens on PUT, not POST

**Example:**
```javascript
// WRONG - will return 400
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: { '_nikki_2025_total': 150 }
});

// CORRECT
const current = await stadionRequest(`wp/v2/people/${id}?_fields=acf`, 'GET');
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: {
    first_name: current.body.acf.first_name,
    last_name: current.body.acf.last_name,
    '_nikki_2025_total': 150
  }
});
```

### Pitfall 2: Year-Specific Field Name Bugs

**What goes wrong:** Typos in field names (`_nikki_2025_totaal` vs `_nikki_2025_total`), wrong year in field name

**Why it happens:** Dynamic field names constructed from year variable, easy to swap template literal parts

**How to avoid:**
1. Define field suffix constants at top of file
2. Use template literals consistently: `_nikki_${year}_${suffix}`
3. Add unit tests for field name generation

**Warning signs:**
- Fields don't appear in Stadion
- Updates succeed but no visible changes
- Field names in database don't match Stadion schema

**Example:**
```javascript
// GOOD - constants prevent typos
const FIELD_SUFFIXES = {
  TOTAL: 'total',
  SALDO: 'saldo',
  STATUS: 'status'
};

// Template literal pattern
const fieldName = `_nikki_${year}_${FIELD_SUFFIXES.TOTAL}`;
```

### Pitfall 3: Null vs Empty String Handling

**What goes wrong:** ACF fields set to empty string instead of null, or vice versa

**Why it happens:** JavaScript coerces null/undefined/empty string differently, ACF stores them differently

**How to avoid:**
1. Be explicit: `value ?? null` for missing data
2. Never use empty string for numeric fields (use null)
3. Check existing sync-nikki-to-stadion.js pattern (line 158: `|| ''` for name fields)

**Warning signs:**
- Fields show empty value in Stadion when should be null
- Numeric fields show "0" instead of blank
- Change detection triggers on null → "" transitions

### Pitfall 4: Floating Point Precision in Change Detection

**What goes wrong:** Hash changes even when values are "the same" (1.5 vs 1.50000001)

**Why it happens:** European currency parsing, floating point arithmetic, toFixed() rounding

**How to avoid:**
1. Round values before hashing: `parseFloat(value.toFixed(2))`
2. Store as integers (cents) if possible
3. Use existing parseEuroAmount() function from download-nikki-contributions.js

**Warning signs:**
- Change detection always triggers updates
- Values look identical in logs but hash differs
- Updates happen on every sync run

**Example:**
```javascript
// Source: lib/nikki-db.js lines 27-37
function computeContributionHash(knvbId, year, nikkiId, saldo, hoofdsom, status) {
  const payload = stableStringify({
    knvb_id: knvbId,
    year: year,
    nikki_id: nikkiId,
    saldo: saldo,           // Already rounded by parseEuroAmount()
    hoofdsom: hoofdsom,     // Already rounded by parseEuroAmount()
    status: status
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

## Code Examples

Verified patterns from existing codebase:

### Sync Loop with Change Detection

```javascript
// Source: sync-nikki-to-stadion.js lines 129-221
for (const [knvbId, contributions] of contributionsByMember) {
  processed++;
  const stadionId = knvbIdToStadionId.get(knvbId);

  if (!stadionId) {
    logger.verbose(`${knvbId}: No Stadion ID, skipping`);
    result.noStadionId++;
    continue;
  }

  // Fetch current data (required for first_name/last_name)
  let existingFirstName = '';
  let existingLastName = '';
  let skipUpdate = false;

  try {
    const response = await stadionRequestWithRetry(
      `wp/v2/people/${stadionId}?_fields=acf`,
      'GET',
      null,
      { verbose: false }
    );

    existingFirstName = response.body?.acf?.first_name || '';
    existingLastName = response.body?.acf?.last_name || '';

    // Change detection
    if (!force) {
      const currentValue = response.body?.acf?.['nikki-contributie-status'] || '';
      const currentHash = computeContentHash(currentValue);
      const newHash = computeContentHash(newValue);

      if (currentHash === newHash) {
        result.skipped++;
        skipUpdate = true;
      }
    }
  } catch (error) {
    logger.error(`Could not fetch current data: ${error.message}`);
    result.errors++;
    continue;
  }

  if (skipUpdate) continue;

  // Update Stadion
  try {
    await stadionRequestWithRetry(
      `wp/v2/people/${stadionId}`,
      'PUT',
      {
        acf: {
          first_name: existingFirstName,
          last_name: existingLastName,
          'new-field': newValue
        }
      },
      { verbose: false }
    );
    result.updated++;
  } catch (error) {
    result.errors++;
    logger.error(`Update failed - ${error.message}`);
  }

  // Rate limiting
  if (processed < total) {
    await new Promise(r => setTimeout(r, 500));
  }
}
```

### Reading Per-Year Contribution Data

```javascript
// Source: lib/nikki-db.js lines 208-231
function getContributionsGroupedByMember(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, year, nikki_id, saldo, hoofdsom, status
    FROM nikki_contributions
    ORDER BY knvb_id ASC, year DESC
  `);
  const rows = stmt.all();

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.knvb_id)) {
      grouped.set(row.knvb_id, []);
    }
    grouped.get(row.knvb_id).push({
      year: row.year,
      nikki_id: row.nikki_id,
      saldo: row.saldo,
      hoofdsom: row.hoofdsom,
      status: row.status
    });
  }

  return grouped;
}
```

### Building Per-Year ACF Payload

```javascript
// NEW CODE - pattern to implement
function buildPerYearAcfPayload(contributions, existingFirstName, existingLastName) {
  const acf = {
    first_name: existingFirstName,
    last_name: existingLastName
  };

  // Add year-specific fields
  for (const contrib of contributions) {
    const year = contrib.year;
    acf[`_nikki_${year}_total`] = contrib.hoofdsom;
    acf[`_nikki_${year}_saldo`] = contrib.saldo;
    acf[`_nikki_${year}_status`] = contrib.status;
  }

  return acf;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single HTML field (nikki-contributie-status) | Per-year individual fields | Phase 29 (2026-02-01) | Enables structured queries, field-specific display |
| Update all members always | Hash-based change detection | Phase 27 (existing) | Reduces API load, faster syncs |
| Manual error handling | Retry with exponential backoff | Implemented in sync-nikki-to-stadion.js | Handles transient server errors |
| Fixed year retention | 4-year rolling window | Phase 28 (2026-01-31) | Prevents unbounded database growth |

**Deprecated/outdated:**
- None - all patterns are current and in production use

## Open Questions

Things that couldn't be fully resolved:

1. **Change detection strategy for per-year fields**
   - What we know: Current code hashes HTML field value for change detection
   - What's unclear: Should we hash all years together or per-year? Hash all 3 fields together or separately?
   - Recommendation: Hash all year fields together (simpler, matches current pattern). Store single hash per member in sync state.

2. **Field value for years with no data**
   - What we know: Context says "leave empty/null (don't set field if no data exists)"
   - What's unclear: Does "don't set field" mean omit from PUT payload, or explicitly set to null?
   - Recommendation: Omit from PUT payload (cleaner, matches WordPress convention). Only include years present in database.

3. **Stadion ACF field registration**
   - What we know: Context says "dynamic field names — no ACF registration needed in Stadion"
   - What's unclear: Will Stadion accept arbitrary `_nikki_*` fields without field group definition?
   - Recommendation: Test with one member first. If WordPress rejects, may need to pre-register field pattern in Stadion ACF field groups.

## Sources

### Primary (HIGH confidence)

- `/Users/joostdevalk/Code/sportlink-sync/sync-nikki-to-stadion.js` - Production sync script with proven patterns
- `/Users/joostdevalk/Code/sportlink-sync/lib/nikki-db.js` - SQLite schema and data access
- `/Users/joostdevalk/Code/sportlink-sync/lib/stadion-client.js` - WordPress API client implementation
- `/Users/joostdevalk/Code/sportlink-sync/CLAUDE.md` - Documented gotchas (first_name/last_name requirement)
- `/Users/joostdevalk/Code/stadion/docs/api-leden-crud.md` - Official Stadion API documentation

### Secondary (MEDIUM confidence)

- Phase 28 planning docs - 4-year retention window decision
- Phase 29 CONTEXT.md - Field naming conventions and sync behavior

### Tertiary (LOW confidence)

- None - all findings verified from codebase and official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, proven in production
- Architecture: HIGH - Patterns extracted from working sync-nikki-to-stadion.js
- Pitfalls: HIGH - Documented gotchas from CLAUDE.md and code review

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - stable domain, no fast-moving dependencies)
