# Phase 6: Member Sync - Research

**Researched:** 2026-01-25
**Domain:** WordPress REST API person record synchronization with custom fields and repeaters
**Confidence:** MEDIUM

## Summary

Phase 6 synchronizes Sportlink member data to Stadion WordPress via REST API, creating/updating person records with mapped fields (name, contact, address, dates). The research examined WordPress custom post type APIs, ACF repeater field handling, matching strategies, and the existing hash-based sync pattern from Laposta.

**Key findings:**
- WordPress REST API supports custom post types at `/wp/v2/{post_type}` when `show_in_rest` is enabled
- ACF since v5.11 exposes repeater fields via REST API when "Show in REST API" is enabled per field group
- Matching requires search by custom field using `rest_{post_type}_query` filter hook or GET with query params
- Hash-based change detection pattern from Laposta applies directly to Stadion sync
- No native upsert - must GET by match field, then POST (create) or PUT (update)

**Primary recommendation:** Follow the Laposta sync pattern (`prepare-laposta-members.js` + `submit-laposta-list.js`) but replace bulk operations with individual API calls for search, create, update, and delete person records.

## Standard Stack

The established approach for WordPress custom post type synchronization:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `https` | Built-in | HTTP requests | Matches existing Stadion client pattern |
| better-sqlite3 | latest | Hash-based state tracking | Already used for Laposta sync |
| crypto | Built-in | SHA-256 hashing | Already used in `laposta-db.js` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/stadion-client.js | Phase 5 | WordPress REST API client | All Stadion API calls |
| lib/logger.js | Existing | Dual-stream logging | Sync progress and error tracking |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Individual REST calls | WP-CLI remote commands | Would require SSH access, breaks codebase HTTP pattern |
| ACF repeaters | Native meta fields | ACF provides structured data, better for complex fields like addresses |
| Hash change detection | Timestamp comparison | Hashing detects any field change; timestamps only show "modified" not "what changed" |

**Installation:**
```bash
# No new dependencies needed for Phase 6
# All required libraries already in package.json
```

**Source:** Codebase analysis shows Laposta sync uses `computeSourceHash()` from `laposta-db.js`, which can be reused for Stadion.

## Architecture Patterns

### Recommended Project Structure
```
.
├── lib/
│   ├── logger.js                # Existing: dual-stream logger
│   ├── stadion-client.js        # Phase 5: API client
│   └── stadion-db.js            # New: hash tracking for Stadion (similar to laposta-db.js)
├── prepare-stadion-members.js   # New: transform Sportlink → Stadion format
├── submit-stadion-sync.js       # New: sync to Stadion API
└── laposta-db.js                # Existing: reference for hash patterns
```

### Pattern 1: Field Mapping and Transformation
**What:** Transform Sportlink CSV fields to Stadion WordPress custom fields
**When to use:** All member data preparation before sync
**Example:**
```javascript
// Source: Inferred from field-mapping.json and user decisions
function preparePerson(sportlinkMember) {
  // Basic name fields
  const person = {
    title: `${sportlinkMember.FirstName} ${sportlinkMember.LastName}`.trim(),
    status: 'publish', // WordPress post status
    meta: {
      knvb_id: sportlinkMember.PublicPersonId, // relatiecode for matching
      first_name: sportlinkMember.FirstName || '',
      last_name: [
        sportlinkMember.Infix,
        sportlinkMember.LastName
      ].filter(Boolean).join(' ').trim(), // Merge tussenvoegsel into last name
      gender: mapGender(sportlinkMember.GenderCode), // Male→M, Female→F
      birth_year: extractBirthYear(sportlinkMember.DateOfBirth)
    }
  };

  // Contact info as ACF repeater
  person.acf = {
    contact_info: buildContactInfo(sportlinkMember),
    addresses: buildAddresses(sportlinkMember),
    important_dates: buildImportantDates(sportlinkMember)
  };

  return person;
}

function buildContactInfo(member) {
  const contacts = [];
  if (member.Email) contacts.push({ type: 'email', value: member.Email });
  if (member.Mobile) contacts.push({ type: 'mobile', value: member.Mobile });
  if (member.Telephone) contacts.push({ type: 'phone', value: member.Telephone });
  return contacts;
}

function buildAddresses(member) {
  if (!member.StreetName || !member.City) return [];
  return [{
    street: member.StreetName,
    number: member.AddressNumber || '',
    addition: member.AddressNumberAppendix || '',
    postal_code: member.ZipCode || '',
    city: member.City || ''
  }];
}

function buildImportantDates(member) {
  if (!member.DateOfBirth) return [];
  return [{ type: 'birth_date', date: member.DateOfBirth }];
}
```

### Pattern 2: Hash-Based Change Detection (Reuse Laposta Pattern)
**What:** Compute hash of member data, compare to last synced hash to skip unchanged records
**When to use:** Before every sync to determine if API call is needed
**Example:**
```javascript
// Source: laposta-db.js lines 20-23 (existing pattern)
const { computeSourceHash } = require('./lib/stadion-db');

// In prepare phase
const sourceHash = computeSourceHash(member.knvb_id, memberData);

// In submit phase
const db = openDb();
const needsSync = getMembersNeedingSync(db, force);
// Only members where source_hash !== last_synced_hash
```

### Pattern 3: Match by KNVB ID with Email Fallback
**What:** Search Stadion for existing person by KNVB ID first, fall back to email if no match
**When to use:** Before create/update decision
**Example:**
```javascript
// Source: Inferred from requirements and WordPress REST API search patterns
async function findExistingPerson(member, options) {
  const { logger, verbose } = options;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

  // Primary match: KNVB ID in custom field
  // WordPress REST API search by meta field requires custom endpoint or filter
  // Approach: GET /wp/v2/person?meta_key=knvb_id&meta_value={relatiecode}
  try {
    const knvbResponse = await stadionRequest(
      `person?meta_key=knvb_id&meta_value=${encodeURIComponent(member.knvb_id)}`,
      'GET',
      null,
      options
    );
    if (knvbResponse.body && knvbResponse.body.length > 0) {
      logVerbose(`Matched by KNVB ID: ${member.knvb_id}`);
      return knvbResponse.body[0]; // Return first match
    }
  } catch (error) {
    logVerbose(`KNVB ID search failed: ${error.message}`);
  }

  // Fallback match: Email
  if (!member.email) return null;
  try {
    const emailResponse = await stadionRequest(
      `person?meta_key=email&meta_value=${encodeURIComponent(member.email)}`,
      'GET',
      null,
      options
    );
    if (emailResponse.body && emailResponse.body.length > 0) {
      logVerbose(`Matched by email: ${member.email}`);
      // Backfill KNVB ID if matched by email
      const existing = emailResponse.body[0];
      if (!existing.meta?.knvb_id && member.knvb_id) {
        logVerbose(`Backfilling KNVB ID: ${member.knvb_id}`);
        // Will be written in update call
      }
      return existing;
    }
  } catch (error) {
    logVerbose(`Email search failed: ${error.message}`);
  }

  return null; // No match found
}
```

### Pattern 4: Create or Update Decision (No Native Upsert)
**What:** WordPress REST API has no upsert endpoint - must explicitly POST (create) or PUT (update)
**When to use:** After matching logic determines if person exists
**Example:**
```javascript
// Source: WordPress REST API patterns from search results
async function syncPerson(member, sourceHash, options) {
  const existing = await findExistingPerson(member, options);

  if (existing) {
    // Update: PUT /wp/v2/person/{id}
    const response = await stadionRequest(
      `person/${existing.id}`,
      'PUT',
      member,
      options
    );
    updateSyncState(db, member.knvb_id, sourceHash, 'updated');
    return { action: 'updated', id: existing.id };
  } else {
    // Create: POST /wp/v2/person
    const response = await stadionRequest(
      'person',
      'POST',
      member,
      options
    );
    updateSyncState(db, member.knvb_id, sourceHash, 'created');
    return { action: 'created', id: response.body.id };
  }
}
```

### Pattern 5: Graceful Error Handling (Continue on Failure)
**What:** Individual member sync failures don't stop the entire sync, collect errors and continue
**When to use:** All sync loops
**Example:**
```javascript
// Source: submit-laposta-list.js lines 295-331 (existing pattern)
const result = {
  total: members.length,
  synced: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: []
};

for (const member of members) {
  try {
    const syncResult = await syncPerson(member, member.source_hash, options);
    result.synced += 1;
    if (syncResult.action === 'created') result.created += 1;
    if (syncResult.action === 'updated') result.updated += 1;
  } catch (error) {
    result.errors.push({
      knvb_id: member.knvb_id,
      email: member.email,
      message: error.message
    });
    // Continue with next member
  }
}

return result;
```

### Anti-Patterns to Avoid
- **Bulk endpoints:** Don't assume WordPress has bulk create/update - it doesn't (unlike Laposta)
- **Timestamp-only change detection:** Don't use LastUpdate field alone - use hash of entire record
- **Throw on API error:** Don't throw - collect errors in result object
- **Overwrite unmapped fields:** Only update fields in the mapping, leave others untouched

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hash computation | Custom MD5/checksum | `computeSourceHash()` from laposta-db.js | Already handles stable object serialization |
| Database for state tracking | JSON files | better-sqlite3 pattern from laposta-db.js | Handles concurrent access, transactions, indexes |
| Matching members | String comparison loops | SQLite queries with WHERE clause | Faster, handles case-insensitive matching |
| Gender code mapping | If/else chains | Lookup object `{Male: 'M', Female: 'F'}` | Clearer, easier to extend |
| Name field merging | String concatenation | `[infix, lastName].filter(Boolean).join(' ')` | Handles null/undefined gracefully |
| Change detection | Compare every field | Hash entire object, compare hashes | Single comparison, detects any change |

**Key insight:** The Laposta sync already solved hash-based change detection, error collection, and database state tracking. Reuse these patterns rather than rebuilding them.

## Common Pitfalls

### Pitfall 1: ACF Field Group Not Exposed to REST API
**What goes wrong:** POST/PUT requests succeed but custom fields aren't saved or returned
**Why it happens:** ACF field groups have "Show in REST API" disabled by default
**How to avoid:** Verify field groups have REST API enabled before sync (Phase 8 setup task)
**Warning signs:** API returns 200 OK but custom fields missing from GET response
**Source:** [ACF WP REST API Integration](https://www.advancedcustomfields.com/resources/wp-rest-api-integration/) - "By default, field groups are not visible in the WP REST API. You must opt-in."

### Pitfall 2: Repeater Field Update Replaces Instead of Merges
**What goes wrong:** Updating a person with contact_info repeater replaces all contacts, not just changed ones
**Why it happens:** ACF repeater fields are arrays - PUT replaces the entire array
**How to avoid:** Always send complete repeater array, not just changed items
**Warning signs:** Old contact methods disappear after update
**Source:** [ACF Repeater REST API discussion](https://support.advancedcustomfields.com/forums/topic/acf-repeater-rest-api/) - PUT behavior replaces entire repeater

### Pitfall 3: Missing Custom Post Type REST API Filter
**What goes wrong:** Cannot search by custom field (KNVB ID, email) - returns empty results
**Why it happens:** WordPress removed default meta_query support from REST API for security
**How to avoid:** Stadion must implement `rest_person_query` filter to enable meta_key/meta_value parameters
**Warning signs:** GET `/wp/v2/person?meta_key=knvb_id&meta_value=123` returns all persons, ignoring filter
**Source:** [GitHub WP-API Issue #2452](https://github.com/WP-API/WP-API/issues/2452) - "WordPress core team decided to remove filter parameter"

### Pitfall 4: Empty Field Handling (Clearing vs Omitting)
**What goes wrong:** Empty Sportlink fields don't clear Stadion fields - old data persists
**Why it happens:** WordPress doesn't distinguish between "omit field" and "clear field" in PUT
**How to avoid:** Explicitly set empty fields to empty string `''` or `null` to clear them
**Warning signs:** Deleted phone number in Sportlink still shows in Stadion
**Source:** User decision in CONTEXT.md - "Empty Sportlink fields: Clear corresponding Stadion fields"

### Pitfall 5: Rate Limiting Unknown
**What goes wrong:** Many consecutive API calls might hit hosting limits, causing 429 or timeouts
**Why it happens:** WordPress has no built-in rate limiting, but hosting providers add it
**How to avoid:** Add conservative delay between requests (2-5 seconds), test with full dataset
**Warning signs:** First 50 succeed, rest fail with 429 or timeout
**Source:** MEDIUM confidence - hosting-dependent, needs testing in Phase 8

### Pitfall 6: Person Delete Without Cascade
**What goes wrong:** Deleting person from Stadion might leave orphaned parent relationships (Phase 7)
**Why it happens:** WordPress doesn't automatically clean up post meta or relationships
**How to avoid:** Phase 7 concern - document that parent cleanup must be handled
**Warning signs:** Deleted child's parents still reference child in `oudervan` field
**Source:** WordPress post deletion doesn't cascade to meta fields

## Code Examples

Verified patterns from official sources and existing codebase:

### WordPress Custom Post Type Create
```javascript
// Source: WordPress REST API Posts reference
// https://developer.wordpress.org/rest-api/reference/posts/
const personData = {
  title: 'John Doe',
  status: 'publish',
  meta: {
    knvb_id: 'VGPP123',
    first_name: 'John',
    last_name: 'Doe'
  },
  acf: {
    contact_info: [
      { type: 'email', value: 'john@example.com' },
      { type: 'mobile', value: '06-12345678' }
    ],
    addresses: [
      {
        street: 'Main Street',
        number: '123',
        postal_code: '1234 AB',
        city: 'Amsterdam'
      }
    ]
  }
};

const response = await stadionRequest('person', 'POST', personData, options);
// Response: { status: 201, body: { id: 456, title: 'John Doe', ... } }
```

### WordPress Custom Post Type Update
```javascript
// Source: WordPress REST API Posts reference
// https://developer.wordpress.org/rest-api/reference/posts/
const personId = 456;
const updates = {
  meta: {
    first_name: 'Jonathan' // Changed name
  },
  acf: {
    contact_info: [
      { type: 'email', value: 'jonathan@example.com' }, // Updated email
      { type: 'mobile', value: '06-12345678' }
    ]
  }
};

const response = await stadionRequest(`person/${personId}`, 'PUT', updates, options);
// Response: { status: 200, body: { id: 456, title: 'Jonathan Doe', ... } }
```

### WordPress Custom Post Type Delete
```javascript
// Source: WordPress REST API Posts reference
// User decision: "Deleted from Sportlink: Delete person from Stadion"
const personId = 456;
const response = await stadionRequest(`person/${personId}`, 'DELETE', null, options);
// Response: { status: 200, body: { deleted: true, previous: { ... } } }
```

### Hash-Based Change Detection (Existing Pattern)
```javascript
// Source: laposta-db.js lines 20-23 (existing code)
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

function computeSourceHash(identifier, data) {
  const payload = stableStringify({ identifier, data });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Usage
const member = preparePerson(sportlinkMember);
const hash = computeSourceHash(member.meta.knvb_id, member);
// Store hash in database, compare on next sync
```

### Field Mapping: Gender Code Transform
```javascript
// Source: Inferred from field-mapping.json and user decisions
function mapGender(sportlinkGender) {
  const mapping = {
    'Male': 'M',
    'Female': 'F'
  };
  return mapping[sportlinkGender] || ''; // Empty if not recognized
}

// Usage
const stadionPerson = {
  meta: {
    gender: mapGender(sportlinkMember.GenderCode) // "Male" → "M"
  }
};
```

### Field Mapping: Birth Year Extraction
```javascript
// Source: User decision "Extract birth year from geboortedatum"
function extractBirthYear(dateOfBirth) {
  if (!dateOfBirth) return '';
  // DateOfBirth format: "1945-09-10" (ISO date)
  const year = dateOfBirth.split('-')[0];
  return year || '';
}

// Usage
const stadionPerson = {
  meta: {
    birth_year: extractBirthYear(sportlinkMember.DateOfBirth) // "1945-09-10" → "1945"
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct SQL updates | WordPress REST API | WordPress 4.7 (Dec 2016) | Type-safe, respects hooks and validation |
| Timestamp comparison | Hash-based change detection | Modern sync pattern (2020+) | Detects any field change, not just "modified" flag |
| Manual meta field queries | ACF REST API exposure | ACF 5.11 (2020) | Structured repeater/group field access |
| Separate meta update calls | Include meta/acf in POST/PUT body | WordPress 5.5+ | Single atomic update |
| WP_Query meta searches | REST API meta_key filter | Requires custom hook | Must be implemented server-side |

**Deprecated/outdated:**
- **Direct database writes:** Bypasses validation, breaks caching, skips post meta hooks
- **XML-RPC API:** Deprecated in WordPress 5.9, REST API is the modern standard
- **Separate meta update endpoints:** Modern approach includes meta in main POST/PUT

## Open Questions

Things that couldn't be fully resolved:

1. **Exact Custom Post Type Name**
   - What we know: Stadion uses custom post type for person records, exposed via REST API
   - What's unclear: The exact CPT slug (e.g., "person", "stadion_person", "member")
   - Recommendation: Add STADION_PERSON_TYPE env variable, default to "person", document in README
   - Confidence: LOW - needs Phase 8 verification

2. **ACF Field Names**
   - What we know: Contact info, addresses, important dates should be ACF repeater fields
   - What's unclear: Exact field names (e.g., `contact_info` vs `contactInfo` vs `contacts`)
   - Recommendation: Create field mapping config similar to `field-mapping.json` for Stadion fields
   - Confidence: LOW - needs Stadion instance inspection in Phase 8

3. **Meta Query Filter Availability**
   - What we know: WordPress removed default meta_query from REST API, requires custom filter
   - What's unclear: Whether Stadion WordPress has `rest_person_query` filter implemented
   - Recommendation: Test search endpoint early, document that Stadion must add filter if missing
   - Confidence: MEDIUM - likely needs server-side code in Stadion

4. **Rate Limiting Thresholds**
   - What we know: WordPress has no built-in rate limits, hosting providers add them
   - What's unclear: Stadion hosting provider's specific limits (requests/minute, concurrent connections)
   - Recommendation: Add configurable delay between requests (default 2 seconds), adjust after testing
   - Confidence: LOW - hosting-dependent

5. **Delete Behavior**
   - What we know: User decided "Deleted from Sportlink: Delete person from Stadion"
   - What's unclear: Should deleted persons be soft-deleted (trash) or hard-deleted (permanent)?
   - Recommendation: Use soft delete (move to trash), document that Stadion admin can permanently delete later
   - Confidence: MEDIUM - WordPress default is soft delete

## Sources

### Primary (HIGH confidence)
- [WordPress REST API Posts Reference](https://developer.wordpress.org/rest-api/reference/posts/) - Official create/update/delete patterns
- [ACF WP REST API Integration](https://www.advancedcustomfields.com/resources/wp-rest-api-integration/) - ACF repeater field exposure
- [WordPress REST API Custom Post Types](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-rest-api-support-for-custom-content-types/) - CPT REST API support
- Codebase file: `laposta-db.js` - Hash computation and state tracking pattern
- Codebase file: `submit-laposta-list.js` - Sync loop and error collection pattern

### Secondary (MEDIUM confidence)
- [WordPress REST API Meta Query Filtering](https://kayart.dev/wp-rest-api-how-to-filter-posts-by-a-meta-field/) - Custom field search patterns
- [Data Synchronization Patterns](https://hasanenko.medium.com/data-synchronization-patterns-c222bd749f99) - Hash-based change detection
- [WordPress REST API Upsert Pattern](https://www.timsanteford.com/posts/how-to-create-and-update-wordpress-pages-using-the-wp-rest-api-in-typescript/) - Search-then-create-or-update approach
- [ACF Repeater REST API Discussion](https://support.advancedcustomfields.com/forums/topic/acf-repeater-rest-api/) - Repeater update behavior

### Tertiary (LOW confidence)
- [GitHub WP-API Meta Query Issue](https://github.com/WP-API/WP-API/issues/2452) - Meta query filter removal history
- [Data Sync Best Practices 2025](https://www.oneio.cloud/blog/data-sync-strategy) - Modern sync patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Reuses existing codebase patterns (Laposta sync, Stadion client)
- Architecture: HIGH - Patterns proven in existing code (hash detection, error collection)
- WordPress REST API: HIGH - Official documentation for create/update/delete
- ACF integration: MEDIUM - Official docs exist but Stadion field names unknown
- Matching/search: MEDIUM - Requires server-side filter that may not exist in Stadion
- Pitfalls: MEDIUM - ACF behaviors documented, rate limiting hosting-specific

**Research date:** 2026-01-25
**Valid until:** 60 days (WordPress REST API stable, ACF patterns established)

**Requirements coverage:**
- STAD-01 (create new person): Covered - POST endpoint pattern
- STAD-02 (update existing person): Covered - PUT endpoint pattern
- STAD-05 (map name fields): Covered - tussenvoegsel merge pattern
- STAD-06 (map contact fields): Covered - ACF repeater pattern
- STAD-07 (map address fields): Covered - ACF repeater with structured fields
- STAD-08 (map gender): Covered - Male→M, Female→F mapping
- STAD-09 (extract birth year): Covered - split ISO date pattern
- STAD-10 (store KNVB ID): Covered - custom meta field
- STAD-11 (match by KNVB ID/email): Covered - search pattern with fallback
- STAD-12 (hash-based change detection): Covered - reuse laposta-db.js pattern

**Open questions for Phase 8:**
- Custom post type name (env variable solution proposed)
- ACF field names (mapping config solution proposed)
- Meta query filter availability (test early, document requirement)
- Rate limiting thresholds (configurable delay solution proposed)
- Delete behavior (soft delete recommendation)
