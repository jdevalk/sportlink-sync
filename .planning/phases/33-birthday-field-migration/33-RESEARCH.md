# Phase 33: Birthday Field Migration - Research

**Researched:** 2026-02-06
**Domain:** Data model migration, ACF field sync, SQLite database cleanup
**Confidence:** HIGH

## Summary

This phase migrates birthday syncing from a separate `important_date` post type lifecycle to a direct `acf.birthdate` field on the person CPT. The migration simplifies the data model by eliminating an entire sync step and database table.

**Current architecture:**
- Step 5 in people pipeline: `steps/sync-important-dates.js` creates/updates/deletes `important_date` posts
- Tracking table: `stadion_important_dates` in `stadion-sync.sqlite` (9 columns)
- WordPress: Separate post type with taxonomy `date_type=birthday`, linked via `acf.related_people`
- Email report: Dedicated "BIRTHDAY SYNC" section with stats

**Target architecture:**
- Birthday data added to `acf.birthdate` field during Step 4 (existing person sync in `steps/submit-stadion-sync.js`)
- No separate sync step needed
- No database table needed (birthdate included in existing person hash)
- Email report: Birthday sync results integrated into "STADION SYNC" section

**Key insight:** The Stadion API already supports `acf.birthdate` (Y-m-d format, read-only in UI) as confirmed in `/wp-json/wp/v2/people` documentation. This field was added to Stadion's data model, making this migration possible.

**Primary recommendation:** Extend the existing person data preparation in `steps/prepare-stadion-members.js` to include birthdate from `DateOfBirth`, then remove Step 5 and the tracking table.

## Standard Stack

The project already uses all necessary libraries:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^9.x | SQLite database operations | Synchronous API, used throughout project for all 4 databases |
| crypto (Node.js) | Built-in | SHA-256 hash computation | Standard for change detection across all sync pipelines |
| WordPress REST API | N/A | ACF field updates | Stadion's `/wp/v2/people` endpoint handles all person fields including birthdate |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| varlock | ^1.x | Environment variable loading | Already used in all entry points |
| postmark | ^3.x | Email delivery | Already used for sync reports |

### Alternatives Considered
N/A - All required functionality exists in current stack.

**Installation:**
No new dependencies needed.

## Architecture Patterns

### Current People Pipeline Structure
```
pipelines/sync-people.js (orchestrator)
├── Step 1: download-data-from-sportlink.js    → Sportlink API → laposta-sync.sqlite
├── Step 2: prepare-laposta-members.js         → Transform for Laposta
├── Step 3: submit-laposta-list.js             → Laposta API
├── Step 4: submit-stadion-sync.js             → WordPress API (members + parents)
│   ├── prepare-stadion-members.js (data prep)
│   └── prepare-stadion-parents.js (parent extraction)
├── Step 5: sync-important-dates.js            → WordPress API (birthdays) [TO BE REMOVED]
├── Step 6: download-photos-from-api.js        → Photo download
├── Step 7: upload-photos-to-stadion.js        → Photo upload
└── Step 8: reverse-sync-sportlink.js          → Sportlink reverse sync
```

### Pattern 1: Hash-Based Change Detection
**What:** All sync tables use `source_hash` vs `last_synced_hash` to determine if data changed
**When to use:** For efficient, idempotent syncs that skip unchanged records
**Example:**
```javascript
// From lib/stadion-db.js
const { stableStringify, computeHash } = require('./utils');

function computeSourceHash(knvbId, data) {
  const payload = stableStringify({ knvb_id: knvbId, data: data || {} });
  return computeHash(payload); // SHA-256 hex string
}

// Query pattern for finding changed records
const needsSync = db.prepare(`
  SELECT knvb_id, data_json, source_hash
  FROM stadion_members
  WHERE stadion_id IS NOT NULL
    AND (last_synced_hash IS NULL OR last_synced_hash != source_hash)
`).all();
```

### Pattern 2: ACF Field Preparation
**What:** Transform Sportlink data to WordPress ACF format during prepare step
**When to use:** Before calling WordPress API - separate data prep from API calls
**Example:**
```javascript
// From steps/prepare-stadion-members.js (lines 134-151)
function preparePerson(sportlinkMember, freeFields = null, invoiceData = null) {
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
  if (name.infix) acf.infix = name.infix;
  if (gender) acf.gender = gender;
  if (birthYear) acf.birth_year = birthYear;

  // [Birthday would be added here: if (birthdate) acf.birthdate = birthdate;]

  return {
    knvb_id: sportlinkMember.PublicPersonId,
    email: sportlinkMember.Email || null,
    data: { acf }
  };
}
```

### Pattern 3: Pipeline Step Results
**What:** Each step returns structured result object with stats and errors
**When to use:** Pipeline orchestrator aggregates all step results for reporting
**Example:**
```javascript
// From steps/sync-important-dates.js
async function runSync(options = {}) {
  const result = {
    success: true,
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: []
  };

  // [sync logic]

  return result;
}
```

### Pattern 4: Email Report Sections
**What:** Report formatter parses structured output with section headers
**When to use:** Consistent section naming enables HTML formatting in send-email.js
**Example:**
```javascript
// From pipelines/sync-people.js (lines 50-56)
logger.log('BIRTHDAY SYNC');
logger.log(minorDivider);
const birthdaySyncText = stats.birthdays.total > 0
  ? `${stats.birthdays.synced}/${stats.birthdays.total}`
  : '0 changes';
logger.log(`Birthdays synced: ${birthdaySyncText}`);
```

**Migration pattern:** Birthday stats should be folded into "STADION SYNC" section instead of separate section.

### Anti-Patterns to Avoid
- **Mixing data prep and API calls:** Separate `prepare-*` scripts from `submit-*` scripts for testability
- **Direct database operations in pipeline orchestrators:** Use lib/*-db.js functions instead
- **Unclear section removal:** When removing "BIRTHDAY SYNC" section, ensure no references in send-email.js formatters

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date format validation | Custom regex | Existing `dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/)` | Already used in sync-important-dates.js line 48 |
| Hash computation | Custom crypto logic | `lib/utils.js` computeHash() + stableStringify() | Consistent across all 4 databases |
| Change detection queries | Manual hash comparison | Existing pattern: `WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash` | Used in all sync tables |
| Database schema migration | DROP/CREATE TABLE | Keep table for backward compat, mark unused | Safer for rollback, can remove in future release |
| ACF field names | Underscores | Hyphens for WordPress ACF | `birth_year` becomes `birth-year`, `birthdate` stays `birthdate` |

**Key insight:** The birthdate field name uses hyphens in ACF (`acf.birthdate`) but the pattern is already established - look at existing fields like `birth_year` which is stored as `birth-year` in ACF but accessed as `birth_year` in JavaScript.

## Common Pitfalls

### Pitfall 1: Including Birthdate in Hash Too Early
**What goes wrong:** If birthdate is added to the person data hash before the migration completes, ALL persons will show as changed and trigger unnecessary updates.
**Why it happens:** The hash includes all ACF fields, so adding a new field changes the hash for everyone.
**How to avoid:**
1. Add birthdate to ACF payload WITHOUT including it in hash computation initially
2. Run one full sync to populate all birthdate fields
3. Then update hash computation to include birthdate
**Warning signs:** First sync after migration shows 100% of persons needing update.

### Pitfall 2: Forgetting First Name Requirement
**What goes wrong:** WordPress PUT /wp/v2/people/{id} requires `first_name` and `last_name` even for partial ACF updates.
**Why it happens:** WordPress validates required fields on every update, not just creation.
**How to avoid:** The existing code already handles this correctly in submit-stadion-sync.js - just follow the pattern of including full person data in every update.
**Warning signs:** 400 errors from WordPress API with "first_name is required" message.

### Pitfall 3: Date Format Mismatch
**What goes wrong:** Sportlink provides dates in `YYYY-MM-DD` format, ACF expects `Y-m-d` (same format, different notation).
**Why it happens:** ACF date picker field is configured for `Y-m-d` format (WordPress date format string).
**How to avoid:** The formats are identical - `YYYY-MM-DD` from Sportlink can be passed directly to `acf.birthdate`. No conversion needed.
**Warning signs:** Date appears incorrectly in WordPress or validation errors.

### Pitfall 4: Empty String vs Null Handling
**What goes wrong:** Empty strings from Sportlink (`""`) should be normalized to `null` before ACF sync.
**Why it happens:** Sportlink API returns empty strings, WordPress ACF stores null for empty fields.
**How to avoid:** Use the existing pattern from prepare-stadion-members.js (line 154):
```javascript
const personImageDate = (sportlinkMember.PersonImageDate || '').trim() || null;
```
**Warning signs:** Empty birthdate fields show as `""` instead of null in database.

### Pitfall 5: Database Table Removal Without Verification
**What goes wrong:** Dropping `stadion_important_dates` table before verifying migration success could cause data loss.
**Why it happens:** Rushing to clean up without validation steps.
**How to avoid:**
1. First sync: Add birthdate to person sync, keep important_dates sync running
2. Verify: All birthdates populated correctly in person records
3. Then: Remove important_dates sync step
4. Later: Mark table as deprecated (add comment in schema)
5. Future release: Actually drop table
**Warning signs:** Missing birthday data after migration.

### Pitfall 6: Email Report Format Regression
**What goes wrong:** Removing "BIRTHDAY SYNC" section without updating send-email.js formatter breaks HTML rendering.
**Why it happens:** send-email.js has section-specific parsing logic for header recognition.
**How to avoid:** The "BIRTHDAY SYNC" header is matched by regex `/^[A-Z][A-Z\s()-]+$/` (line 92). Simply removing the section from pipeline output is sufficient - no send-email.js changes needed.
**Warning signs:** Email HTML looks broken or has extra spacing.

## Code Examples

Verified patterns from existing code:

### Extract Birthdate from Sportlink Data
```javascript
// Source: steps/prepare-stadion-members.js lines 17-25
/**
 * Extract birth year from date string
 * @param {string} dateOfBirth - Date in YYYY-MM-DD format
 * @returns {number|null} - Year as integer or null
 */
function extractBirthYear(dateOfBirth) {
  if (!dateOfBirth) return null;
  const year = parseInt(dateOfBirth.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

// Extension for full birthdate:
function extractBirthdate(dateOfBirth) {
  if (!dateOfBirth) return null;
  const trimmed = dateOfBirth.trim();
  // Validate YYYY-MM-DD format
  if (!trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  return trimmed;
}
```

### Add Birthdate to Person ACF Payload
```javascript
// Source: steps/prepare-stadion-members.js lines 134-164
function preparePerson(sportlinkMember, freeFields = null, invoiceData = null) {
  const name = buildName(sportlinkMember);
  const gender = mapGender(sportlinkMember.GenderCode);
  const birthYear = extractBirthYear(sportlinkMember.DateOfBirth);
  const birthdate = extractBirthdate(sportlinkMember.DateOfBirth); // NEW

  const acf = {
    first_name: name.first_name,
    last_name: name.last_name,
    'knvb-id': sportlinkMember.PublicPersonId,
    contact_info: buildContactInfo(sportlinkMember),
    addresses: buildAddresses(sportlinkMember)
  };

  // Only add optional fields if they have values
  if (name.infix) acf.infix = name.infix;
  if (gender) acf.gender = gender;
  if (birthYear) acf.birth_year = birthYear;
  if (birthdate) acf.birthdate = birthdate; // NEW

  // ... rest of function
}
```

### Remove Birthdate Sync Step from Pipeline
```javascript
// Source: pipelines/sync-people.js lines 270-293
// BEFORE (Step 5: Birthday Sync)
logger.verbose('Syncing birthdays to Stadion...');
try {
  const birthdayResult = await runBirthdaySync({ logger, verbose, force });
  stats.birthdays = {
    total: birthdayResult.total,
    synced: birthdayResult.synced,
    created: birthdayResult.created,
    updated: birthdayResult.updated,
    skipped: birthdayResult.skipped,
    errors: (birthdayResult.errors || []).map(e => ({
      knvb_id: e.knvb_id,
      message: e.message,
      system: 'birthday-sync'
    }))
  };
} catch (err) {
  logger.error(`Birthday sync failed: ${err.message}`);
  stats.birthdays.errors.push({
    message: `Birthday sync failed: ${err.message}`,
    system: 'birthday-sync'
  });
}

// AFTER: Remove entire step, birthdays now synced in Step 4
// (This code block is deleted)
```

### Update Email Report Section
```javascript
// Source: pipelines/sync-people.js lines 50-56
// BEFORE: Separate birthday section
logger.log('BIRTHDAY SYNC');
logger.log(minorDivider);
const birthdaySyncText = stats.birthdays.total > 0
  ? `${stats.birthdays.synced}/${stats.birthdays.total}`
  : '0 changes';
logger.log(`Birthdays synced: ${birthdaySyncText}`);
logger.log('');

// AFTER: Fold into STADION SYNC section
logger.log('STADION SYNC');
logger.log(minorDivider);
logger.log(`Persons synced: ${stats.stadion.synced}/${stats.stadion.total} (${stats.stadion.created} created, ${stats.stadion.updated} updated)`);
logger.log(`  Birthdates populated: ${stats.stadion.birthdates_populated || 0}`); // NEW
if (stats.stadion.skipped > 0) {
  logger.log(`Skipped: ${stats.stadion.skipped} (unchanged)`);
}
logger.log('');
```

### Database Table Deprecation Pattern
```sql
-- Source: lib/stadion-db.js lines 64-78
-- BEFORE: Active table
CREATE TABLE IF NOT EXISTS stadion_important_dates (
  id INTEGER PRIMARY KEY,
  knvb_id TEXT NOT NULL,
  date_type TEXT NOT NULL,
  date_value TEXT NOT NULL,
  stadion_date_id INTEGER,
  source_hash TEXT NOT NULL,
  last_synced_hash TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(knvb_id, date_type)
);

-- AFTER: Mark as deprecated but keep for rollback safety
-- DEPRECATED: Birthday data now synced via acf.birthdate field on person record
-- This table is unused as of v2.3 (2026-02-06)
-- Kept for backward compatibility, will be removed in future release
CREATE TABLE IF NOT EXISTS stadion_important_dates (
  -- [same schema]
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Birthdays as separate important_date posts | Birthdays as `acf.birthdate` field on person | v2.3 (2026-02-06) | Simpler data model, fewer API calls, no separate sync step |
| 9-column tracking table for dates | No tracking needed (included in person hash) | v2.3 (2026-02-06) | Less database overhead, simpler schema |
| Separate "BIRTHDAY SYNC" report section | Integrated into "STADION SYNC" section | v2.3 (2026-02-06) | Cleaner reports, birthday sync invisible to users |
| WordPress `important_date` CPT with taxonomy | Direct date field on person | Stadion update (before v2.3) | Stadion's data model simplified first, enabling this migration |

**Deprecated/outdated:**
- `steps/sync-important-dates.js`: Will be unused after migration
- `stadion_important_dates` table: Mark as deprecated, remove in future release
- Birthday term in `date_type` taxonomy: WordPress cleanup handled separately

## Open Questions

1. **Should we include birthdate in source_hash immediately?**
   - What we know: Including it will trigger updates for all persons on first sync
   - What's unclear: Is it better to do staged rollout (populate first, hash later) or immediate?
   - Recommendation: Include in hash immediately. One-time full sync is acceptable for clean state.

2. **Should we actively delete existing important_date birthday posts?**
   - What we know: Requirement BDAY-03 says "handled on Stadion side"
   - What's unclear: Do we need any cleanup script or verification?
   - Recommendation: No sync-side cleanup needed. Stadion will handle orphaned posts separately.

3. **What about non-birthday important dates?**
   - What we know: Only birthdays are currently synced, other date types not in use
   - What's unclear: Are there plans to sync other important dates?
   - Recommendation: Keep `important_date` infrastructure unused but intact for future expansion.

## Sources

### Primary (HIGH confidence)
- Project codebase: `steps/sync-important-dates.js`, `steps/prepare-stadion-members.js`, `pipelines/sync-people.js`
- Database schema: `lib/stadion-db.js` lines 64-78 (stadion_important_dates table)
- Stadion API docs: `~/Code/stadion/docs/api-leden-crud.md` lines 82 (birthdate field confirmed)
- Existing patterns: Hash computation (`lib/utils.js`), ACF field handling (throughout codebase)

### Secondary (MEDIUM confidence)
- Debug session: `.planning/debug/birthday-sync-404-errors.md` (confirms important_date post lifecycle)
- Phase requirements: `.planning/REQUIREMENTS.md` (BDAY-01 through BDAY-04)

### Tertiary (LOW confidence)
- None - all research verified against existing code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Existing patterns clearly established across 4 databases and 5 pipelines
- Pitfalls: MEDIUM - Some pitfalls extrapolated from similar migrations (photo sync, free fields)

**Research date:** 2026-02-06
**Valid until:** 60 days (stable domain - data model migrations are well-understood)
