# Testing Patterns

**Analysis Date:** 2026-01-24

## Test Framework

**Status:** Not detected

**Details:**
- No test framework installed (jest, vitest, mocha, or other not found in `package.json`)
- No test configuration files present (jest.config.js, vitest.config.ts, mocha.opts, etc.)
- No test files found in codebase (*.test.js, *.spec.js, __tests__ directories)
- No testing dependencies listed in `package.json` (lines 18-23)

**Current Dependencies:**
```json
{
  "better-sqlite3": "latest",
  "dotenv": "latest",
  "otplib": "latest",
  "playwright": "latest"
}
```

## Testing Approach

**Observation:**
This is a CLI automation tool without automated tests. Testing is manual via:
1. Direct script execution: `npm run download`, `npm run prepare-laposta`, `npm run sync-laposta`
2. Verification scripts: `npm run show-laposta-member`, `npm run show-sportlink-member`, `npm run show-laposta-changes`
3. Database inspection: Direct SQLite queries via output JSON

## Manual Testing Pattern

**Validation Scripts:**

The codebase includes several verification/inspection scripts that function as manual testing tools:

`show-laposta-member.js` (lines 1-40):
```javascript
// Inspect prepared member data for specific email
// Usage: npm run show-laposta-member -- someone@example.com
// Usage: npm run show-laposta-member -- someone@example.com 2 (specific list)
function parseArgs(argv) {
  const email = argv[2];
  const listIndex = argv[3] ? Number.parseInt(argv[3], 10) : null;
  return { email, listIndex };
}
// Returns: JSON array of member records with custom_fields and list_index
```

`show-laposta-changes.js` (lines 1-60):
```javascript
// Show pending Laposta sync members with diffs
// Usage: npm run show-laposta-changes [listIndex] [--all]
function parseArgs(argv) {
  const listIndex = argv[2] ? Number.parseInt(argv[2], 10) : null;
  const force = argv.includes('--force') || argv.includes('--all');
  return { listIndex, force };
}
// Returns: JSON with email, custom_fields, and diff of changes
// Diffs show field-by-field before/after values: { from: ..., to: ... }
```

`show-sportlink-member.js`:
```javascript
// Inspect raw Sportlink member data for specific email
// Usage: npm run show-sportlink-member -- someone@example.com
// Returns: JSON with matched_fields and full member record
```

## Integration Points for Testing

**Error Scenarios - Tested Manually:**

Database operations (`laposta-db.js`):
- Transaction rollback: `db.transaction()` wrapper ensures atomicity (line 125)
- Migration handling: Column existence checks with `PRAGMA table_info()` (line 69)
- Conflict resolution: `ON CONFLICT ... DO UPDATE` patterns (lines 118-122)

API request handling (`submit-laposta-list.js`):
```javascript
// Lines 94-128: Response status checking
if (res.statusCode >= 200 && res.statusCode < 300) {
  resolve({ status: res.statusCode, body: parsed });
} else {
  const error = new Error(`Laposta API error (${res.statusCode})`);
  error.details = parsed;  // Include response body in error
  reject(error);
}

// Error logging (lines 283-287)
if (errors.length > 0) {
  const errorPath = path.join(process.cwd(), `laposta-submit-errors-list${listIndex}.json`);
  await fs.writeFile(errorPath, JSON.stringify(errors, null, 2));
  console.error(`Completed with ${errors.length} errors.`);
}
```

## Data Validation Patterns

**Input Validation:**

Email validation (`prepare-laposta-members.js` lines 56-59):
```javascript
function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.includes('@');
}
```

Environment variable parsing (`download-data-from-sportlink.js` lines 19-31):
```javascript
function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
```

Argument parsing (`submit-laposta-list.js` lines 51-55):
```javascript
function parseArgs(argv) {
  const listIndex = argv[2] ? Number.parseInt(argv[2], 10) : null;
  const force = argv.includes('--force') || argv.includes('--all');
  return { listIndex, force };
}
```

## Known Testing Gaps

**Areas Without Automated Tests:**

1. **Playwright Automation** (`download-data-from-sportlink.js`):
   - Login flow not tested
   - OTP generation and submission not verified
   - Network request interception not validated
   - Selector changes would cause runtime failures

2. **Data Transformation** (`prepare-laposta-members.js`):
   - Field mapping logic (lines 61-84) untested
   - Gender normalization (Male/Female → M/V) untested
   - Parent name building and merging logic (lines 86-181) untested
   - Team deduplication and normalization untested
   - Email assignment distribution to 4 lists untested

3. **Database Operations** (`laposta-db.js`):
   - Stable hash computation (lines 7-18) untested
   - Transaction atomicity untested
   - Index effectiveness untested
   - Migration logic untested

4. **API Integration** (`submit-laposta-list.js`, `dedupe-laposta-list.js`):
   - Laposta API response parsing untested
   - Network error handling untested
   - Auth header construction untested
   - Bulk vs individual request handling untested

5. **Edge Cases:**
   - Empty/null field handling
   - Special characters in names
   - Unicode in email addresses
   - Very large member lists (performance)
   - Concurrent requests
   - Rate limiting

## Environment-Based Testing

**Test Credentials Required:**
- `.env` file setup (see README.md lines 92-104)
- Valid Sportlink credentials: `SPORTLINK_USERNAME`, `SPORTLINK_PASSWORD`, `SPORTLINK_OTP_SECRET`
- Valid Laposta API key: `LAPOSTA_API_KEY`
- Valid Laposta list IDs: `LAPOSTA_LIST`, `LAPOSTA_LIST2`, `LAPOSTA_LIST3`, `LAPOSTA_LIST4`

**Manual Test Steps:**

1. Setup: Create `.env` with all required credentials
2. Download: `npm run download` - verifies Sportlink login and data fetch
3. Prepare: `npm run prepare-laposta` - verifies field mapping and member assignment
4. Verify: `npm run show-laposta-member -- test@example.com` - inspect prepared data
5. Sync: `npm run sync-laposta -- 1` - verify API integration (dry run safe with list 1)
6. Dedupe: `npm run dedupe-laposta` - find duplicate parent emails

## Recommended Testing Structure (If Implemented)

**Unit Test Organization:**

```
tests/
├── unit/
│   ├── laposta-db.test.js        # Database operations
│   ├── prepare-laposta.test.js    # Field mapping and transformation
│   ├── utils.test.js              # Helper functions (normalizeEmail, hasValue, etc)
│   └── validate.test.js           # Input validation (isValidEmail, parseBool, etc)
├── integration/
│   ├── sportlink-download.test.js # Playwright automation (requires live env)
│   ├── laposta-api.test.js        # API calls (would need mocking)
│   └── database-sync.test.js      # Full sync workflow
└── fixtures/
    ├── sportlink-response.json    # Mock Sportlink API response
    ├── laposta-fields.json        # Mock Laposta fields response
    └── test-members.json          # Test member datasets
```

**Example Test Pattern (Not Currently Used):**

```javascript
// Unit test structure if Jest were added
describe('prepare-laposta-members', () => {
  describe('buildBaseCustomFields', () => {
    it('should map Sportlink fields to Laposta custom fields', () => {
      const member = { FirstName: 'John', LastName: 'Doe', ... };
      const mapping = { voornaam: 'FirstName', achternaam: 'LastName', ... };
      const result = buildBaseCustomFields(member, mapping);
      expect(result.voornaam).toBe('John');
      expect(result.achternaam).toBe('Doe');
    });

    it('should normalize gender Male to M', () => {
      const member = { Gender: 'Male' };
      const result = buildBaseCustomFields(member, { geslacht: 'Gender' });
      expect(result.geslacht).toBe('M');
    });
  });

  describe('normalizeEmail', () => {
    it('should lowercase and trim email', () => {
      expect(normalizeEmail('  Test@Example.COM  ')).toBe('test@example.com');
    });
    it('should handle null/undefined', () => {
      expect(normalizeEmail(null)).toBe('');
      expect(normalizeEmail(undefined)).toBe('');
    });
  });
});
```

---

*Testing analysis: 2026-01-24*
