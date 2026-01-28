# Phase 18: Financial Block Sync - Research

**Researched:** 2026-01-28
**Domain:** SQLite data access, Stadion WordPress REST API, hash-based change detection, activity logging
**Confidence:** HIGH

## Summary

This phase syncs financial transfer block status from Sportlink (captured in Phase 17) to Stadion WordPress. The implementation reads `has_financial_block` from the `sportlink_member_free_fields` table (already populated by Phase 17), includes it in member data preparation, syncs it to the `financiele-blokkade` ACF field via PUT request, and logs status changes as activities using `wp_insert_comment()` via custom endpoint.

The codebase already has well-established patterns for all required operations: reading free fields from SQLite (`getMemberFreeFieldsByKnvbId`), including optional ACF fields in member preparation (`preparePerson`), hash-based change detection (`computeSourceHash`), and ACF field updates via Stadion API (`stadionRequest`). The new requirement is activity logging, which uses WordPress comments with `comment_type = 'activity'`.

**Primary recommendation:** Extend `preparePerson()` to include financial block status, update hash computation to include the new field, add activity logging after successful field updates when status changes.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 9.x | Read free fields from database | Already used, synchronous API matches codebase patterns |
| lib/stadion-client.js | - | Stadion WordPress REST API client | Project-specific client with auth handling |
| lib/stadion-db.js | - | Database operations and hash computation | Established patterns for change detection |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All required libraries already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Updating hash computation | Separate tracking table | Extra complexity; hash-based detection already proven in codebase |
| WordPress comments for activities | Custom meta table | Comments are native WordPress feature, already used in Stadion |
| Boolean ACF field | String field with "ja"/"nee" | Boolean is cleaner, Stadion frontend can format display |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
prepare-stadion-members.js    # Extend preparePerson() to include financial block
lib/stadion-db.js             # Update computeMemberFreeFieldsHash() to include field
submit-stadion-sync.js        # Add activity logging after field updates
```

### Pattern 1: Optional ACF Field Inclusion
**What:** Conditionally add ACF fields only when they have meaningful values
**When to use:** When syncing optional data that may be null/missing for some members
**Example:**
```javascript
// Source: prepare-stadion-members.js lines 111-127
const acf = {
  first_name: name.first_name,
  last_name: name.last_name,
  // ... required fields
};

// Only add optional fields if they have values
if (gender) acf.gender = gender;
if (birthYear) acf.birth_year = birthYear;

// Free fields from Sportlink /other tab
if (freeFields) {
  if (freeFields.freescout_id) acf['freescout-id'] = freeFields.freescout_id;
  if (freeFields.vog_datum) acf['datum-vog'] = freeFields.vog_datum;
  // Add: if (freeFields.has_financial_block !== undefined) acf['financiele-blokkade'] = freeFields.has_financial_block === 1;
}
```

### Pattern 2: Hash-Based Change Detection
**What:** Include all sync-relevant fields in hash computation to trigger updates when data changes
**When to use:** Any field that should trigger a re-sync when changed
**Example:**
```javascript
// Source: lib/stadion-db.js lines 1981-1991
function computeMemberFreeFieldsHash(knvbId, freescoutId, vogDatum, hasFinancialBlock, photoUrl, photoDate) {
  const payload = stableStringify({
    knvb_id: knvbId,
    freescout_id: freescoutId,
    vog_datum: vogDatum,
    has_financial_block: hasFinancialBlock,  // Already included in Phase 17
    photo_url: photoUrl,
    photo_date: photoDate
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

### Pattern 3: Activity Logging via WordPress Comments
**What:** Use WordPress native comments system with custom comment_type to log activities
**When to use:** When tracking historical events on a person (status changes, sync events, etc.)
**Example:**
```javascript
// Based on: Stadion class-comment-types.php patterns
// POST request to custom endpoint that calls wp_insert_comment
await stadionRequest(
  'stadion/v1/people/456/activity',
  'POST',
  {
    content: 'Financiële blokkade ingesteld',
    date: new Date().toISOString()
  },
  options
);

// WordPress backend implementation:
// wp_insert_comment([
//   'comment_post_ID'  => $person_id,
//   'comment_content'  => $content,
//   'comment_type'     => 'activity',
//   'user_id'          => get_current_user_id(),
//   'comment_approved' => 1,
// ]);
```

### Pattern 4: Safe Boolean Handling Across Systems
**What:** Convert SQLite integer (0/1) to JavaScript boolean, then to WordPress boolean field
**When to use:** Syncing boolean data from SQLite to WordPress ACF
**Example:**
```javascript
// Read from SQLite (returns 0 or 1)
const freeFields = getMemberFreeFieldsByKnvbId(db, knvbId);

// Convert to boolean for ACF (expects true/false)
if (freeFields && freeFields.has_financial_block !== undefined) {
  acf['financiele-blokkade'] = freeFields.has_financial_block === 1;
}
```

### Pattern 5: Tracking Previous Values for Change Detection
**What:** Store previous field value in database to detect changes and decide whether to log activity
**When to use:** When you need to log activities only on actual changes, not on every sync
**Example:**
```javascript
// Option 1: Read existing Stadion person before update (cleaner, current approach)
const existingPerson = await stadionRequest(`wp/v2/people/${stadionId}`, 'GET', null, options);
const previousBlockStatus = existingPerson.body.acf?.['financiele-blokkade'] || false;
const currentBlockStatus = data.acf['financiele-blokkade'];

if (previousBlockStatus !== currentBlockStatus) {
  // Log activity
  const activityText = currentBlockStatus
    ? 'Financiële blokkade ingesteld'
    : 'Financiële blokkade opgeheven';
  await logActivity(stadionId, activityText, options);
}

// Option 2: Track in database (more complex, adds column)
// ALTER TABLE stadion_members ADD COLUMN last_synced_financial_block INTEGER
```

### Anti-Patterns to Avoid
- **Logging activities on every sync:** Creates noise, only log actual changes
- **Failing sync if activity logging fails:** Activity logging is nice-to-have, field sync is critical
- **Hardcoding activity text:** Use descriptive Dutch text matching Stadion's conventions
- **Forgetting to update hash computation:** New fields must be included in hash or changes won't trigger updates

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Change detection | Custom "last updated" timestamps | Hash-based comparison with `computeSourceHash` | Already proven, handles complex nested objects |
| Activity logging | Custom meta fields or logs | WordPress comments with `comment_type = 'activity'` | Native WP feature, Stadion already uses this pattern |
| Boolean storage in SQLite | String "true"/"false" | INTEGER 0/1 with JavaScript boolean conversion | SQLite standard, already used in codebase |
| ACF field updates | Direct database updates | Stadion REST API PUT requests | Handles validation, triggers WP hooks correctly |

**Key insight:** This phase extends existing patterns (free fields, hash-based sync, ACF updates) with one new capability (activity logging). All technical challenges already solved in the codebase.

## Common Pitfalls

### Pitfall 1: Missing Required ACF Fields on Partial Update
**What goes wrong:** PUT request to update ACF field returns 400 error "first_name required"
**Why it happens:** WordPress ACF requires certain fields even for partial updates
**How to avoid:** Always include `first_name` and `last_name` in ACF updates, even when only updating other fields
**Warning signs:** "Required field missing" errors on PUT requests
**Code example:**
```javascript
// WRONG - will fail
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: { 'financiele-blokkade': true }
});

// CORRECT - include required fields from existing person
const existing = await stadionRequest(`wp/v2/people/${id}`, 'GET', null, options);
await stadionRequest(`wp/v2/people/${id}`, 'PUT', {
  acf: {
    first_name: existing.body.acf.first_name,
    last_name: existing.body.acf.last_name,
    'financiele-blokkade': true
  }
});
```

### Pitfall 2: Activity Logging Creates Infinite Sync Loop
**What goes wrong:** Every sync logs activity, which triggers another sync, creating infinite loop
**Why it happens:** Activity creation is misinterpreted as data change requiring sync
**How to avoid:** Log activities only when field value actually changes (compare previous vs current)
**Warning signs:** Sync runs continuously, hundreds of duplicate activities logged

### Pitfall 3: Null/Undefined Boolean Interpretation
**What goes wrong:** Treating missing financial block data as "blocked" instead of "not blocked"
**Why it happens:** Null/undefined boolean logic errors
**How to avoid:** Explicitly treat null/undefined/0 as false (not blocked)
**Code example:**
```javascript
// WRONG - treats undefined as truthy in some contexts
const isBlocked = freeFields?.has_financial_block;

// CORRECT - explicit falsy handling
const isBlocked = (freeFields?.has_financial_block === 1);
```

### Pitfall 4: Forgetting Hash Update
**What goes wrong:** Financial block status changes in Sportlink but Stadion never updates
**Why it happens:** `computeMemberFreeFieldsHash()` doesn't include `has_financial_block`
**How to avoid:** Ensure new field is already included in hash computation (Phase 17 should have done this)
**Warning signs:** Manual force sync works but automatic sync doesn't detect changes

### Pitfall 5: Activity Endpoint Doesn't Exist
**What goes wrong:** POST to `/stadion/v1/people/{id}/activity` returns 404
**Why it happens:** Assuming activity endpoint exists without verification
**How to avoid:** Check Stadion REST API implementation first, may need to use note endpoint or create custom endpoint
**Warning signs:** 404 errors when trying to log activities

## Code Examples

Verified patterns from existing codebase and Stadion documentation:

### Extend preparePerson to Include Financial Block
```javascript
// Location: prepare-stadion-members.js, preparePerson function
function preparePerson(sportlinkMember, freeFields = null) {
  const name = buildName(sportlinkMember);
  const gender = mapGender(sportlinkMember.GenderCode);
  const birthYear = extractBirthYear(sportlinkMember.DateOfBirth);

  const acf = {
    first_name: name.first_name,
    last_name: name.last_name,
    'knvb-id': sportlinkMember.PublicPersonId,
    contact_info: buildContactInfo(sportlinkMember),
    addresses: buildAddresses(sportlinkMember)
  };

  // Only add optional fields if they have values
  if (gender) acf.gender = gender;
  if (birthYear) acf.birth_year = birthYear;

  // Free fields from Sportlink /other tab
  if (freeFields) {
    if (freeFields.freescout_id) acf['freescout-id'] = freeFields.freescout_id;
    if (freeFields.vog_datum) acf['datum-vog'] = freeFields.vog_datum;

    // NEW: Add financial block status (convert SQLite integer to boolean)
    if (freeFields.has_financial_block !== undefined) {
      acf['financiele-blokkade'] = (freeFields.has_financial_block === 1);
    }
  }

  return {
    knvb_id: sportlinkMember.PublicPersonId,
    email: (sportlinkMember.Email || '').trim().toLowerCase() || null,
    person_image_date: personImageDate,
    data: {
      status: 'publish',
      acf: acf
    }
  };
}
```

### Activity Logging After Field Update
```javascript
// Location: submit-stadion-sync.js, syncPerson function
async function syncPerson(member, db, options) {
  const { knvb_id, data, source_hash, stadion_id } = member;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  if (stadion_id) {
    // Get existing person to compare financial block status
    let existingBlockStatus = false;
    try {
      const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
      existingBlockStatus = existing.body.acf?.['financiele-blokkade'] || false;
    } catch (error) {
      // Handle 404 (person deleted) - will fall through to create path
      if (error.message && error.message.includes('404')) {
        logVerbose(`Person ${stadion_id} no longer exists (404) - will create fresh`);
        updateSyncState(db, knvb_id, null, null);
        // Fall through to create path
      } else {
        throw error;
      }
    }

    // UPDATE existing person
    const endpoint = `wp/v2/people/${stadion_id}`;
    logVerbose(`Updating existing person: ${stadion_id}`);

    try {
      const response = await stadionRequest(endpoint, 'PUT', data, options);
      updateSyncState(db, knvb_id, source_hash, stadion_id);

      // Check if financial block status changed
      const newBlockStatus = data.acf?.['financiele-blokkade'] || false;
      if (existingBlockStatus !== newBlockStatus) {
        const activityText = newBlockStatus
          ? 'Financiële blokkade ingesteld'
          : 'Financiële blokkade opgeheven';

        // Log activity (non-blocking - field update is critical, activity is nice-to-have)
        try {
          await logFinancialBlockActivity(stadion_id, activityText, options);
          logVerbose(`  Logged activity: ${activityText}`);
        } catch (activityError) {
          logVerbose(`  Warning: Could not log activity: ${activityError.message}`);
          // Continue - field was updated successfully
        }
      }

      return { action: 'updated', id: stadion_id };
    } catch (error) {
      // ... error handling
    }
  }

  // CREATE new person path...
}
```

### Activity Logging Helper Function
```javascript
// Location: submit-stadion-sync.js (new helper function)
/**
 * Log financial block status change as activity on person
 * @param {number} stadionId - WordPress person post ID
 * @param {string} activityText - Activity description
 * @param {Object} options - Logger and verbose options
 */
async function logFinancialBlockActivity(stadionId, activityText, options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  // Check if activity endpoint exists, otherwise use note endpoint
  // Based on Stadion implementation patterns
  try {
    await stadionRequest(
      `stadion/v1/people/${stadionId}/activity`,
      'POST',
      {
        content: activityText,
        date: new Date().toISOString()
      },
      options
    );
  } catch (error) {
    // If activity endpoint doesn't exist (404), try note endpoint or direct comment creation
    if (error.details?.data?.status === 404) {
      logVerbose(`  Activity endpoint not found, trying note endpoint`);
      await stadionRequest(
        `stadion/v1/people/${stadionId}/note`,
        'POST',
        {
          content: activityText
        },
        options
      );
    } else {
      throw error;
    }
  }
}
```

### Hash Already Includes Financial Block (Phase 17)
```javascript
// Location: lib/stadion-db.js
// This function was already updated in Phase 17 to include has_financial_block
function computeMemberFreeFieldsHash(knvbId, freescoutId, vogDatum, hasFinancialBlock, photoUrl, photoDate) {
  const payload = stableStringify({
    knvb_id: knvbId,
    freescout_id: freescoutId,
    vog_datum: vogDatum,
    has_financial_block: hasFinancialBlock,  // Already included
    photo_url: photoUrl,
    photo_date: photoDate
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Used in upsertMemberFreeFields:
const rows = records.map((record) => ({
  knvb_id: record.knvb_id,
  freescout_id: record.freescout_id || null,
  vog_datum: record.vog_datum || null,
  has_financial_block: record.has_financial_block !== undefined ? record.has_financial_block : 0,
  photo_url: record.photo_url || null,
  photo_date: record.photo_date || null,
  source_hash: computeMemberFreeFieldsHash(
    record.knvb_id,
    record.freescout_id,
    record.vog_datum,
    record.has_financial_block !== undefined ? record.has_financial_block : 0,
    record.photo_url,
    record.photo_date
  ),
  last_seen_at: now,
  created_at: now
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No financial block tracking | Sync from MemberHeader API | Phase 17-18 (v1.7 milestone) | New visibility into blocked members |
| Manual status tracking | Automated sync with activity log | Phase 18 | Historical record of block changes |

**Deprecated/outdated:**
- None for this phase (new functionality)

## Open Questions

Things that couldn't be fully resolved:

1. **Activity Logging Endpoint**
   - What we know: Stadion uses WordPress comments with `comment_type = 'activity'` for activity logging
   - What's unclear: Exact REST API endpoint for creating activities (may need custom endpoint or use notes endpoint)
   - Recommendation: Check Stadion source code for `/stadion/v1/people/{id}/activity` endpoint, implement if missing

2. **Initial State Activity Logging**
   - What we know: Context doc says "Log initial state on first sync"
   - What's unclear: How to distinguish first sync from subsequent syncs (could use last_synced_at === null)
   - Recommendation: Log activity on first sync when `last_synced_at IS NULL AND has_financial_block = 1`

3. **Parent Financial Block Status**
   - What we know: Context doc says "Sync financial block status for both members AND parents"
   - What's unclear: Whether parents (non-members) can have financial blocks in Sportlink
   - Recommendation: If free fields are available for parents, apply same logic; otherwise skip

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `prepare-stadion-members.js` - Free fields integration pattern (lines 129-133)
- Codebase analysis: `lib/stadion-db.js` - Hash computation with all 6 free fields (lines 1981-1991)
- Codebase analysis: `submit-stadion-sync.js` - Person sync and update patterns (lines 30-87)
- Stadion codebase: `includes/class-comment-types.php` - Activity logging via wp_insert_comment
- Project documentation: `.planning/phases/18-financial-block-sync/18-CONTEXT.md`

### Secondary (MEDIUM confidence)
- Stadion documentation: `~/Code/stadion/docs/api-leden-crud.md` - ACF update patterns
- Stadion documentation: `~/Code/stadion/docs/rest-api.md` - API endpoint structure
- Project documentation: `.planning/ROADMAP.md` - Phase 18 requirements

### Tertiary (LOW confidence)
- Activity REST endpoint structure - Inferred from WordPress patterns, needs verification in Stadion codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries and patterns established in existing codebase
- Architecture: HIGH - Direct extension of proven patterns (free fields, ACF sync, hash-based detection)
- Pitfalls: HIGH - Based on documented gotchas (ACF required fields) and WordPress patterns
- Activity logging implementation: MEDIUM - Pattern verified in Stadion, but exact endpoint needs confirmation

**Research date:** 2026-01-28
**Valid until:** Indefinitely (internal codebase patterns, not external libraries)
