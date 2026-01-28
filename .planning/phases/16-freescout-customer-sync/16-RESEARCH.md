# Phase 16: FreeScout Customer Sync - Research

**Researched:** 2026-01-28
**Domain:** REST API integration with hash-based change detection
**Confidence:** HIGH

## Summary

FreeScout provides a REST API for customer management with authentication via API key headers. The sync pattern follows the established architecture in this codebase: SQLite tracking database with SHA-256 hash-based change detection, search-before-create logic, and native Node.js HTTPS module for API requests.

The FreeScout Customer API supports creating, updating, and searching customers via email. Custom fields are updated via a separate endpoint. The API returns structured JSON responses with standard HTTP status codes.

This phase reuses proven patterns from Laposta (hash-based sync) and Stadion (search-by-identifier-before-create) syncs. The primary technical challenge is mapping Sportlink member data to FreeScout Customer fields and custom fields, plus handling the FreeScout ID stored in Sportlink's free fields.

**Primary recommendation:** Create `freescout-db.js` tracking database (like `laposta-db.js`) and `submit-freescout-sync.js` script (following `submit-laposta-list.js` patterns). Use native HTTPS module for API calls with proper error handling and timeouts.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | latest | State tracking database | Already used for Laposta and Stadion tracking; proven hash-based change detection |
| node:https | native | HTTP API client | Native Node.js module, zero dependencies, already used in `submit-laposta-list.js` |
| node:crypto | native | SHA-256 hash computation | Native Node.js module, used for change detection in existing sync scripts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| varlock | latest | Environment variable loading | Already used project-wide for `.env` file management |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| native https | axios, got, undici | Higher-level libraries add dependencies and complexity; native module sufficient for simple REST calls |
| better-sqlite3 | other SQLite libraries | better-sqlite3 is synchronous, fast, and already project standard |

**Installation:**
```bash
# No new dependencies required - all libraries already in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
.
├── freescout-db.js              # Database schema and operations (like laposta-db.js)
├── prepare-freescout-customers.js  # Transform Sportlink data (like prepare-laposta-members.js)
├── submit-freescout-sync.js     # Main sync orchestrator (like submit-laposta-list.js)
└── freescout-sync.sqlite        # Tracking database (like laposta-sync.sqlite)
```

### Pattern 1: Hash-Based Change Detection
**What:** Compute SHA-256 hash of customer data; only sync when hash changes
**When to use:** All sync operations to avoid unnecessary API calls

**Example:**
```javascript
// Source: Existing codebase (laposta-db.js)
const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeSourceHash(email, fields) {
  const payload = stableStringify({ email, fields: fields || {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

### Pattern 2: Search Before Create
**What:** Check if customer exists by email before creating new entry
**When to use:** When FreeScout ID not stored in Sportlink (first sync or manual edits)

**Example:**
```javascript
// Source: FreeScout API documentation (https://api-docs.freescout.net/)
async function findCustomerByEmail(email, options) {
  const response = await freescoutRequest(
    `/api/customers?email=${encodeURIComponent(email)}`,
    'GET',
    null,
    options
  );

  const customers = response.body?._embedded?.customers || [];
  return customers.length > 0 ? customers[0].id : null;
}
```

### Pattern 3: Native HTTPS Request Wrapper
**What:** Promisified wrapper around node:https with error handling
**When to use:** All FreeScout API calls

**Example:**
```javascript
// Source: Existing codebase (submit-laposta-list.js, lines 72-121)
function freescoutRequest(endpoint, method, data, options) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.FREESCOUT_API_KEY;
    const baseUrl = process.env.FREESCOUT_BASE_URL;

    if (!apiKey || !baseUrl) {
      reject(new Error('FREESCOUT_API_KEY and FREESCOUT_BASE_URL required'));
      return;
    }

    const url = new URL(endpoint, baseUrl);
    const body = data ? JSON.stringify(data) : null;

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'X-FreeScout-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    };

    if (body) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          const error = new Error(`FreeScout API error (${res.statusCode})`);
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}
```

### Pattern 4: Module/CLI Hybrid
**What:** Export functions for programmatic use AND support CLI execution
**When to use:** All main sync scripts for consistency

**Example:**
```javascript
// Source: Existing codebase (submit-laposta-list.js, lines 339-382)
async function runSubmit(options = {}) {
  const { logger, verbose = false, force = false } = options;
  // ... sync logic
  return { success: true, customers: [...], errors: [] };
}

module.exports = { runSubmit };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runSubmit({ verbose, force })
    .then(result => {
      console.log(`Synced: ${result.customers.length}`);
      if (result.errors.length > 0) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
```

### Anti-Patterns to Avoid
- **Syncing without hash check:** Always compare source_hash to last_synced_hash to avoid redundant API calls
- **Missing timeout on HTTPS requests:** Always set timeout to prevent hanging connections
- **Creating without search:** If FreeScout ID missing from Sportlink, search by email first to avoid duplicates
- **Ignoring 409 Conflict errors:** FreeScout returns 409 when email already exists; handle gracefully

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client | Custom request wrapper with retries | Native https + simple wrapper (existing pattern) | Native module handles edge cases; retries add complexity for idempotent operations already tracked in DB |
| JSON sorting for hashing | Custom recursive sorter | `stableStringify` (existing util) | Deterministic JSON serialization is tricky; existing solution handles all edge cases |
| Database migrations | Manual ALTER TABLE | Schema check + dynamic column addition (existing pattern) | stadion-db.js shows proper SQLite schema migration pattern |
| Rate limiting | Sleep between all requests | Sleep only when batch processing (existing pattern) | Single customer updates don't need rate limiting; batch operations do |
| Error recovery | Complex retry logic | Hash-based sync state (existing pattern) | Database tracks sync state; failed syncs retry on next run automatically |

**Key insight:** This codebase has mature patterns for all common sync problems. Reuse them rather than reimplementing.

## Common Pitfalls

### Pitfall 1: Missing FreeScout ID Tracking
**What goes wrong:** FreeScout ID not saved in Sportlink free fields, causing duplicate customer creation on every sync
**Why it happens:** Sportlink has a FreeScout ID field but it's not automatically populated after first sync
**How to avoid:** After creating customer, store FreeScout ID back to tracking database; implement search-by-email fallback for missing IDs
**Warning signs:** Duplicate customers in FreeScout with same email; "customer already exists" API errors

### Pitfall 2: Custom Field ID Mismatch
**What goes wrong:** Custom field IDs are numeric and installation-specific; hard-coding field IDs breaks on different FreeScout instances
**Why it happens:** Assuming field 1 is always "UnionTeams" across all installations
**How to avoid:** Environment variables for custom field IDs (FREESCOUT_FIELD_UNION_TEAMS=1) or fetch field definitions from API
**Warning signs:** 400 Bad Request errors on custom field updates; fields not appearing in FreeScout

### Pitfall 3: Timeout on Native HTTPS Without Abort
**What goes wrong:** Request hangs indefinitely without timeout handling
**Why it happens:** Native https module doesn't have default timeout; must be set explicitly and request destroyed on timeout
**How to avoid:** Always set `timeout` option and handle 'timeout' event by calling `req.destroy()`
**Warning signs:** Script hangs during sync; no response from API calls

### Pitfall 4: Photo URL Sync Without Verification
**What goes wrong:** Setting photoUrl to Stadion URL that doesn't exist yet or isn't public
**Why it happens:** Stadion photos sync separately; timing issue between person sync and photo sync
**How to avoid:** Only set photoUrl if photo_state === 'synced' in stadion_members table
**Warning signs:** Broken image placeholders in FreeScout; 404 errors in FreeScout logs

### Pitfall 5: Nikki Contribution Data Mismatch
**What goes wrong:** Most recent year's Nikki data not available or incorrect
**Why it happens:** Nikki contributions downloaded separately; timing dependency between downloads
**How to avoid:** Require Nikki download before FreeScout sync in orchestration; handle missing data gracefully
**Warning signs:** Custom fields 7 and 8 (Nikki saldo/status) empty or outdated in FreeScout

## Code Examples

Verified patterns from existing codebase:

### SQLite Tracking Database Schema
```javascript
// Source: Existing codebase patterns (laposta-db.js, stadion-db.js)
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS freescout_customers (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      freescout_id INTEGER,
      data_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_freescout_customers_hash
      ON freescout_customers (source_hash, last_synced_hash);

    CREATE INDEX IF NOT EXISTS idx_freescout_customers_email
      ON freescout_customers (email);
  `);
}
```

### Sync State Update After Success
```javascript
// Source: Existing codebase (stadion-db.js, lines 440-448)
function updateSyncState(db, knvbId, sourceHash, freescoutId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE freescout_customers
    SET last_synced_at = ?, last_synced_hash = ?, freescout_id = ?
    WHERE knvb_id = ?
  `);
  stmt.run(now, sourceHash, freescoutId || null, knvbId);
}
```

### FreeScout Custom Fields Update
```javascript
// Source: FreeScout API documentation (https://api-docs.freescout.net/)
async function updateCustomerFields(freescoutId, customFields, options) {
  // Custom fields array format: [{ id: 1, value: "..." }, ...]
  const data = { customerFields: customFields };

  return await freescoutRequest(
    `/api/customers/${freescoutId}/customer_fields`,
    'PUT',
    data,
    options
  );
}

// Example usage:
const customFields = [
  { id: 1, value: member.union_teams || '' },           // UnionTeams
  { id: 4, value: member.knvb_id },                     // PublicPersonId (KNVB ID)
  { id: 5, value: member.member_since || '' },          // MemberSince
  { id: 7, value: member.nikki_saldo || '' },           // Nikki saldo (most recent year)
  { id: 8, value: member.nikki_status || '' }           // Nikki status (most recent year)
];
await updateCustomerFields(freescoutId, customFields, options);
```

### Error Handling Pattern
```javascript
// Source: Existing codebase (submit-stadion-sync.js, lines 39-61)
try {
  const response = await freescoutRequest(endpoint, 'PUT', data, options);
  updateSyncState(db, knvbId, sourceHash, freescoutId);
  return { action: 'updated', id: freescoutId };
} catch (error) {
  // Handle 404 - customer deleted from FreeScout
  if (error.message && error.message.includes('404')) {
    updateSyncState(db, knvbId, null, null); // Clear freescout_id
    // Fall through to create new customer
  } else if (error.details?.code === 409) {
    // Conflict - customer already exists, search by email
    const existingId = await findCustomerByEmail(email, options);
    if (existingId) {
      updateSyncState(db, knvbId, sourceHash, existingId);
      return { action: 'linked', id: existingId };
    }
  } else {
    console.error(`API Error: ${error.message}`);
    if (error.details) {
      console.error(`Details: ${JSON.stringify(error.details)}`);
    }
    throw error;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bulk API with all members | Individual requests with hash check | Early 2025 (existing pattern) | Only changed members sync; faster, fewer API calls |
| Store API data in JSON files | SQLite tracking database | Early 2025 (existing pattern) | Better query performance, atomic operations, change detection |
| Manual ID tracking in spreadsheet | FreeScout ID in Sportlink free fields | Phase 16 requirement | Bidirectional reference; easier troubleshooting |
| Simple request/response | Search before create + error recovery | Existing Stadion pattern | Prevents duplicates, handles edge cases |

**Deprecated/outdated:**
- JSON file-based state: SQLite databases (laposta-sync.sqlite, stadion-sync.sqlite) replaced JSON for state tracking
- Synchronous fs operations: Modern codebase uses synchronous better-sqlite3 but async for file I/O

## Open Questions

Things that couldn't be fully resolved:

1. **Custom field ID mapping**
   - What we know: FreeScout custom field IDs are installation-specific (1, 4, 5, 7, 8 in requirements)
   - What's unclear: Should we fetch field definitions from API to validate IDs, or trust environment variables?
   - Recommendation: Use environment variables for field IDs with validation on first sync; fail fast if fields don't exist

2. **Photo URL format**
   - What we know: FreeScout accepts photoUrl field pointing to external image
   - What's unclear: Does FreeScout cache the photo or hotlink? Will Stadion URLs work (authentication)?
   - Recommendation: Test with Stadion public photo URLs; may need to verify photo accessibility before setting

3. **Nikki contribution timing**
   - What we know: Custom fields 7 and 8 need "most recent year" Nikki data
   - What's unclear: What defines "most recent year"? Calendar year, membership year, or latest download?
   - Recommendation: Document assumption (calendar year) and implement clear error if Nikki data missing

4. **Rate limiting**
   - What we know: FreeScout API docs don't mention rate limits
   - What's unclear: Are there undocumented rate limits? Should we add delays?
   - Recommendation: Start without rate limiting; add 1-2 second delays between requests if 429 errors occur

## Sources

### Primary (HIGH confidence)
- [FreeScout API Documentation](https://api-docs.freescout.net/) - Customer endpoints, authentication, request/response formats
- Existing codebase:
  - `submit-laposta-list.js` - HTTPS request wrapper, hash-based sync
  - `submit-stadion-sync.js` - Search-before-create pattern, error handling
  - `laposta-db.js` - Database schema, hash computation
  - `stadion-db.js` - Tracking database patterns

### Secondary (MEDIUM confidence)
- [Node.js HTTPS Module Documentation](https://nodejs.org/api/https.html) - Native HTTPS module API
- [Better Stack: Timeouts in Node.js](https://betterstack.com/community/guides/scaling-nodejs/nodejs-timeouts/) - Timeout best practices
- [Medium: Building Resilient Systems with API Retry Mechanisms](https://medium.com/@devharshgupta.com/building-resilient-systems-with-api-retry-mechanisms-in-node-js-a-guide-to-handling-failure-d6d9021b172a) - Retry patterns
- [SQLite Forum: Detecting database changes](https://sqlite.org/forum/forumpost/2798df4be8) - Hash-based change detection patterns

### Tertiary (LOW confidence)
- [Make.com: FreeScout Integration](https://www.make.com/en/integrations/freescout) - Third-party integration examples (not official)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, proven patterns
- Architecture: HIGH - Directly mirrors existing Laposta and Stadion sync architecture
- Pitfalls: MEDIUM - Based on existing codebase experience and API documentation; actual FreeScout behavior may vary
- Custom field mapping: MEDIUM - Requirements specify field IDs but installation-specific nature uncertain

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days - FreeScout API stable, patterns established)

**Dependencies:**
- Sportlink member data download (Phase 1)
- Stadion person sync with photo tracking (Phase 10-11)
- Nikki contribution download (Phase 15)
- Sportlink free fields download (stores FreeScout ID)
