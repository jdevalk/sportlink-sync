# Phase 31: Sync Discipline Cases to Stadion - Research

**Researched:** 2026-02-03
**Domain:** WordPress REST API sync, SQLite state tracking, taxonomy management
**Confidence:** HIGH

## Summary

This phase syncs discipline case data from the local SQLite database (populated by Phase 30) to Stadion WordPress as `discipline-cases` custom post type. The implementation follows established patterns already used in this codebase for teams, commissies, and important-dates syncs.

The sync requires:
1. Reading cases from `discipline-sync.sqlite`
2. Looking up person `stadion_id` from `stadion-sync.sqlite` via `knvb_id` (PublicPersonId)
3. Managing season taxonomy terms via WordPress REST API
4. Creating/updating discipline-cases posts with ACF fields
5. Tracking sync state with hash-based change detection

**Primary recommendation:** Follow the established sync pattern from `submit-stadion-teams.js` and `submit-stadion-commissies.js`, extending `discipline-db.js` with sync tracking columns rather than modifying `stadion-db.js`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | SQLite database access | Already used throughout codebase |
| crypto (Node built-in) | n/a | SHA-256 hash computation | Already used in `*-db.js` modules |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| varlock | existing | Environment variable loading | Auto-load at script start |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate discipline-sync.sqlite | Add to stadion-sync.sqlite | Separate is cleaner for modular syncs, follows existing nikki-sync pattern |

**Installation:**
No new packages needed - all dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── discipline-db.js       # Extended with sync tracking columns + functions
├── stadion-client.js      # Existing - HTTP client for WordPress API
└── stadion-db.js          # Existing - getAllTrackedMembers() for person lookup

submit-stadion-discipline.js   # New sync script (follows submit-stadion-teams.js pattern)
```

### Pattern 1: Hash-Based Change Detection
**What:** Compute SHA-256 hash of source data, compare with last synced hash to skip unchanged records
**When to use:** Always - avoids unnecessary API calls
**Example:**
```javascript
// Source: lib/stadion-db.js computeSourceHash pattern
function computeCaseHash(caseData) {
  const payload = stableStringify({
    dossier_id: caseData.dossier_id,
    public_person_id: caseData.public_person_id,
    // ... all fields that would change the WordPress post
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

### Pattern 2: Local ID Tracking (dossier_id -> stadion_id)
**What:** Store WordPress post ID locally after creation to enable reliable updates
**When to use:** Always for POST/PUT distinction
**Example:**
```javascript
// Source: submit-stadion-teams.js pattern
if (stadion_id) {
  // UPDATE existing - PUT /wp/v2/discipline-cases/{id}
  await stadionRequest(`wp/v2/discipline-cases/${stadion_id}`, 'PUT', payload, options);
} else {
  // CREATE new - POST /wp/v2/discipline-cases
  const response = await stadionRequest('wp/v2/discipline-cases', 'POST', payload, options);
  stadion_id = response.body.id;
}
updateSyncState(db, dossier_id, source_hash, stadion_id);
```

### Pattern 3: Cross-Database Person Lookup
**What:** Read person mapping from `stadion-sync.sqlite` to link cases to persons
**When to use:** When linking discipline cases to persons via relationship field
**Example:**
```javascript
// Source: submit-stadion-sync.js getAllTrackedMembers pattern
const stadionDb = require('./lib/stadion-db').openDb();
const allMembers = stadionDb.prepare(`
  SELECT knvb_id, stadion_id FROM stadion_members
  WHERE stadion_id IS NOT NULL
`).all();
const knvbToStadionId = new Map(allMembers.map(m => [m.knvb_id, m.stadion_id]));
stadionDb.close();
```

### Pattern 4: Taxonomy Term Creation via REST API
**What:** Create season terms if they don't exist, get term ID for post assignment
**When to use:** Before creating/updating posts that need taxonomy assignment
**Example:**
```javascript
// Source: sync-important-dates.js getBirthdayTermId pattern
async function getOrCreateSeasonTermId(seasonName, options) {
  // Try to get existing term
  const response = await stadionRequest(
    `wp/v2/seizoen?slug=${seasonName}`,
    'GET',
    null,
    options
  );

  if (response.body && response.body.length > 0) {
    return response.body[0].id;
  }

  // Create if not exists
  const createResponse = await stadionRequest(
    'wp/v2/seizoen',
    'POST',
    { name: seasonName, slug: seasonName },
    options
  );
  return createResponse.body.id;
}
```

### Pattern 5: Module/CLI Hybrid
**What:** Export function for programmatic use AND support CLI execution
**When to use:** Always - enables both pipeline integration and manual testing
**Example:**
```javascript
// Source: submit-stadion-teams.js
async function runSync(options = {}) { /* ... */ }

module.exports = { runSync };

if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runSync({ verbose }).then(result => {
    console.log(`Synced: ${result.synced}/${result.total}`);
  });
}
```

### Anti-Patterns to Avoid
- **Querying WordPress to find existing posts by field:** Use local stadion_id tracking instead - much faster and avoids rate limits
- **Modifying stadion-sync.sqlite for discipline tracking:** Keep discipline-sync.sqlite separate for modularity
- **Creating orphan cases (person doesn't exist):** Skip and report - case will sync on next run when person exists

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON hashing for change detection | Custom serializer | `stableStringify()` from existing `*-db.js` | Object key ordering must be deterministic |
| HTTP requests to WordPress | Raw fetch/https | `stadionRequest()` from `lib/stadion-client.js` | Handles auth, timeout, error parsing |
| Database transactions | Manual BEGIN/COMMIT | `db.transaction()` from better-sqlite3 | Cleaner API, auto-rollback on error |
| Season date logic | Manual date parsing | `Date` object with month comparison | August 1 boundary is simple |

**Key insight:** This codebase already has robust patterns for WordPress sync. The discipline sync should follow them exactly.

## Common Pitfalls

### Pitfall 1: Person Not Yet Synced
**What goes wrong:** Discipline case references a PublicPersonId that doesn't have a stadion_id yet
**Why it happens:** Person sync runs separately, case might be downloaded before person sync completes
**How to avoid:** Skip cases where person lookup fails, log to report, retry on next sync run
**Warning signs:** "skipped due to missing person" count in sync report

### Pitfall 2: Taxonomy Term Not Exposed to REST API
**What goes wrong:** `GET /wp/v2/seizoen` returns 404 or empty
**Why it happens:** Taxonomy not registered with `show_in_rest: true` in Stadion
**How to avoid:** Stadion-side configuration must include `show_in_rest: true` for `seizoen` taxonomy
**Warning signs:** "Cannot create season term" errors during sync

### Pitfall 3: ACF Required Fields Missing
**What goes wrong:** 400 error when updating/creating posts
**Why it happens:** Stadion ACF configuration requires certain fields (noted in CLAUDE.md: `first_name` and `last_name` required for person ACF updates)
**How to avoid:** For discipline-cases, verify no required ACF fields exist or include them all in payload
**Warning signs:** "rest_invalid_param" errors with ACF field names

### Pitfall 4: Duplicate Entries from Local vs Server Execution
**What goes wrong:** Running sync locally creates duplicates because local SQLite has different stadion_id mappings
**Why it happens:** CLAUDE.md documents this - each machine has its own SQLite tracking
**How to avoid:** Enforce server-only execution like other sync scripts
**Warning signs:** Duplicate discipline cases with same dossier-id in WordPress

### Pitfall 5: Season Boundary Edge Cases
**What goes wrong:** Case from July 31 assigned to wrong season
**Why it happens:** Date comparison logic error
**How to avoid:** Use clear boundary logic: `month >= 8` (August) = new season
**Warning signs:** Cases appearing in wrong season category

## Code Examples

Verified patterns from this codebase:

### Season Calculation from Match Date
```javascript
// Derived from CONTEXT.md decision: August 1 is season boundary
function getSeasonFromDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed, so August = 7

  // August (7) or later = new season starting that year
  // July (6) or earlier = season started previous year
  if (month >= 7) { // August = 7
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}
// Examples:
// "2026-01-15" -> "2025-2026" (January is in prior season)
// "2026-08-01" -> "2026-2027" (August starts new season)
// "2026-07-31" -> "2025-2026" (July is still prior season)
```

### Building Case Title
```javascript
// Source: CONTEXT.md decision for title format
function buildCaseTitle(personName, matchDescription, matchDate) {
  // Format: "Jan Jansen - JO11-1 vs Ajax - 2026-01-15"
  return `${personName} - ${matchDescription} - ${matchDate}`;
}
```

### Discipline Database Schema Extension
```javascript
// Pattern from lib/stadion-db.js schema migrations
function initDb(db) {
  // Existing table from Phase 30
  db.exec(`
    CREATE TABLE IF NOT EXISTS discipline_cases (
      -- existing columns from Phase 30...
    );
  `);

  // Add sync tracking columns if not present
  const columns = db.prepare('PRAGMA table_info(discipline_cases)').all();

  if (!columns.some(col => col.name === 'stadion_id')) {
    db.exec('ALTER TABLE discipline_cases ADD COLUMN stadion_id INTEGER');
  }
  if (!columns.some(col => col.name === 'last_synced_hash')) {
    db.exec('ALTER TABLE discipline_cases ADD COLUMN last_synced_hash TEXT');
  }
  if (!columns.some(col => col.name === 'last_synced_at')) {
    db.exec('ALTER TABLE discipline_cases ADD COLUMN last_synced_at TEXT');
  }
  if (!columns.some(col => col.name === 'season')) {
    db.exec('ALTER TABLE discipline_cases ADD COLUMN season TEXT');
  }
}
```

### Cases Needing Sync Query
```javascript
// Pattern from lib/stadion-db.js getMembersNeedingSync
function getCasesNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
        SELECT * FROM discipline_cases
        ORDER BY match_date DESC
      `)
    : db.prepare(`
        SELECT * FROM discipline_cases
        WHERE last_synced_hash IS NULL
           OR last_synced_hash != source_hash
        ORDER BY match_date DESC
      `);
  return stmt.all();
}
```

### WordPress Payload Structure
```javascript
// Based on 31-STADION-REQUIREMENTS.md
const payload = {
  title: buildCaseTitle(personName, case.match_description, case.match_date),
  status: 'publish',
  seizoen: [seasonTermId], // Taxonomy term ID array
  acf: {
    'dossier-id': case.dossier_id,
    'person': personStadionId, // Relationship field (single ID)
    'match-date': case.match_date,
    'match-description': case.match_description,
    'team-name': case.team_name,
    'charge-codes': case.charge_codes, // JSON string if array
    'charge-description': case.charge_description,
    'sanction-description': case.sanction_description,
    'processing-date': case.processing_date,
    'administrative-fee': case.administrative_fee,
    'is-charged': case.is_charged === 1
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Query WordPress by meta to find existing | Local stadion_id tracking | Phase 5 | Faster, fewer API calls |
| Single monolithic sync | Separate pipelines per domain | Phase 12 | Better modularity, scheduling |

**Deprecated/outdated:**
- Using WordPress meta queries to find existing posts (use local ID tracking instead)

## Open Questions

Things that couldn't be fully resolved:

1. **Person Name Retrieval for Title**
   - What we know: Case title needs person name, we have `stadion_id` from lookup
   - What's unclear: Should we fetch person name from WordPress API or store it locally?
   - Recommendation: Fetch from WordPress during sync (GET /wp/v2/people/{id}) - adds 1 API call per case but ensures current name. Could cache in memory during single sync run.

2. **Taxonomy REST Endpoint Name**
   - What we know: Taxonomy slug is `seizoen`
   - What's unclear: WordPress REST API may use different endpoint (could be `/wp/v2/seizoen` or `/wp/v2/seizoenen` depending on registration)
   - Recommendation: Test endpoint during Stadion-side implementation, document actual path

3. **Rate Limiting Between API Calls**
   - What we know: Existing syncs don't implement explicit rate limiting
   - What's unclear: Whether discipline sync (potentially many cases) needs throttling
   - Recommendation: Start without throttling (matches existing pattern), add if WordPress shows 429 errors

## Sources

### Primary (HIGH confidence)
- `/Users/joostdevalk/Code/sportlink-sync/submit-stadion-teams.js` - Sync pattern reference
- `/Users/joostdevalk/Code/sportlink-sync/submit-stadion-commissies.js` - Sync pattern reference
- `/Users/joostdevalk/Code/sportlink-sync/sync-important-dates.js` - Taxonomy term lookup pattern
- `/Users/joostdevalk/Code/sportlink-sync/lib/stadion-db.js` - Database schema and hash patterns
- `/Users/joostdevalk/Code/sportlink-sync/lib/discipline-db.js` - Existing discipline database
- `/Users/joostdevalk/Code/sportlink-sync/CLAUDE.md` - Codebase patterns and gotchas
- `/Users/joostdevalk/Code/stadion/docs/api-leden-crud.md` - Stadion REST API patterns

### Secondary (MEDIUM confidence)
- Phase 31 CONTEXT.md - User decisions on field mapping, season logic, sync behavior
- Phase 31 STADION-REQUIREMENTS.md - Expected Stadion-side configuration

### Tertiary (LOW confidence)
- None - all findings based on codebase analysis and existing patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses only existing codebase libraries
- Architecture: HIGH - Follows established sync patterns exactly
- Pitfalls: HIGH - Based on documented codebase gotchas and similar sync implementations

**Research date:** 2026-02-03
**Valid until:** N/A - Based on stable codebase patterns, not external dependencies
