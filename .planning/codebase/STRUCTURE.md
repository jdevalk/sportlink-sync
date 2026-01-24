# Codebase Structure

**Analysis Date:** 2026-01-24

## Directory Layout

```
sportlink-sync/
├── .env                          # Environment config (not committed)
├── .env.example                  # Template for required env vars
├── .gitignore                    # Git exclusions
├── package.json                  # Node.js metadata and scripts
├── package-lock.json             # Dependency lock file
├── README.md                     # Project documentation
├── laposta-sync.sqlite           # SQLite database (generated, not committed)
├── laposta-members.json          # Laposta submission output for list 1 (temp)
├── laposta-members-list2.json    # Laposta submission output for list 2 (temp)
├── laposta-members-list3.json    # Laposta submission output for list 3 (temp)
├── laposta-members-list4.json    # Laposta submission output for list 4 (temp)
├── laposta-submit-errors-listN.json  # Error logs from sync failures (temp)
│
├── download-data-from-sportlink.js   # Stage 1: Sportlink extraction
├── prepare-laposta-members.js        # Stage 2: Data transformation
├── submit-laposta-list.js            # Stage 3: Laposta submission
├── dedupe-laposta-list.js            # Utility: Dedup parent members
├── show-laposta-member.js            # Utility: Query single member
├── show-sportlink-member.js          # Utility: Show raw Sportlink data
├── show-laposta-changes.js           # Utility: Display pending changes
│
├── field-mapping.json            # Sportlink → Laposta field name mapping
├── sportlink-fields.json         # Reference: Sportlink member attribute names
│
└── .planning/                    # GSD planning directory (generated)
    └── codebase/                 # Codebase documentation
        ├── ARCHITECTURE.md
        ├── STRUCTURE.md
        ├── STACK.md
        └── INTEGRATIONS.md
```

## Directory Purposes

**Project Root:**
- Purpose: All files are at root level; no src/ directories
- Contains: Executable scripts (*.js), configuration (*.json, .env), docs (README.md)
- Key files: `download-data-from-sportlink.js` (entry point), `laposta-db.js` (shared module)

## Key File Locations

**Entry Points:**

- `download-data-from-sportlink.js`: Stage 1 - Sportlink extraction via browser automation
  - Trigger: `npm run download`
  - Output: Stores raw JSON in `sportlink_runs` table

- `prepare-laposta-members.js`: Stage 2 - Transform Sportlink → Laposta format
  - Trigger: `npm run prepare-laposta`
  - Output: Upserts to `members` table with computed source hashes

- `submit-laposta-list.js`: Stage 3 - Submit changes to Laposta API
  - Trigger: `npm run sync-laposta [listIndex] [--force]`
  - Output: Updates sync state in DB; writes errors to `laposta-submit-errors-listN.json`

**Configuration:**

- `.env`: Environment variables (Sportlink username/password/OTP, Laposta API key, list IDs)
- `.env.example`: Template showing required variables
- `field-mapping.json`: Declarative mapping between Laposta and Sportlink field names
- `sportlink-fields.json`: Reference documentation of Sportlink member attributes

**Core Logic:**

- `laposta-db.js`: Shared database module
  - Exports: `openDb()`, `upsertMembers()`, `getMembersNeedingSync()`, `computeSourceHash()`, etc.
  - Used by: All other *.js scripts

**Testing:**

- None: No test files present in codebase

**Utilities (Query-Only):**

- `show-laposta-member.js`: Display member and pending changes for given email
- `show-sportlink-member.js`: Display raw Sportlink data for member
- `show-laposta-changes.js`: List all members with pending sync (respects --force/--all)
- `dedupe-laposta-list.js`: Find and optionally delete duplicate parent members in Laposta

## Naming Conventions

**Files:**

- Pattern: kebab-case (e.g., `download-data-from-sportlink.js`)
- Database: sqlite with lowercase suffix (e.g., `laposta-sync.sqlite`)
- Config: lowercase `.json` (e.g., `field-mapping.json`)
- Scripts with single purpose: descriptive names (e.g., `show-laposta-member.js`)

**Functions:**

- Pattern: camelCase (e.g., `buildBaseCustomFields()`, `normalizeEmail()`, `stableStringify()`)
- Predicates: `is*` prefix (e.g., `isValidEmail()`, `isStandaloneParent()`)
- Async functions: Explicitly `async` keyword (e.g., `async function main()`)

**Variables:**

- Pattern: camelCase (e.g., `customFields`, `parentNamesMap`, `sourceHash`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_LISTS = 4`, `EXCLUDED_CUSTOM_FIELDS`)
- Maps/Collections: descriptive names (e.g., `primaryEmailMap`, `parentTeamsMap`)

**Types:**

- No TypeScript; plain JavaScript
- Objects used as structs (e.g., `{ email, custom_fields, source_hash }`)
- Type hints in comments (rare; no JSDoc pattern observed)

## Where to Add New Code

**New Feature/Command:**

- Create new file at root: `/Users/joostdevalk/Code/sportlink-sync/[feature-name].js`
- Import shared utilities: `const { openDb, ... } = require('./laposta-db');`
- Add npm script in `package.json` under `scripts` object
- Follow error handling pattern: `require('dotenv').config()` at top, `.catch()` on `main()`

**New Database Operation:**

- Add function to `laposta-db.js`
- Export from `module.exports` at bottom (line 312)
- Pattern: Use `db.prepare()` for statements, `db.transaction()` for multi-row ops
- Implement stable stringification for values that go into hashes

**New Field Mapping:**

- Add entry to `field-mapping.json` in format: `"laposta_field_name": "SporlinkFieldName"`
- Update exclusions in `prepare-laposta-members.js` if field should be filtered (line 25-30)
- Update gender/enum normalization in `buildBaseCustomFields()` if special handling needed (line 69-79)

**Configuration Values:**

- Add to `.env.example` as template
- Read in scripts via `readEnv('VAR_NAME', 'fallback')` helper function
- Validate required vars at script start before main work begins

## Special Directories

**.planning/ directory:**

- Purpose: GSD tool output (documentation, plans, analysis)
- Generated: Yes, by GSD mapper/planner/executor
- Committed: No, likely in .gitignore

**node_modules/ directory:**

- Purpose: Installed npm dependencies
- Generated: Yes, by `npm install`
- Committed: No (excluded via .gitignore)

## Database File

**laposta-sync.sqlite:**

- Purpose: Persistent state across script runs
- Generated: Yes, created by `laposta-db.js` on first `openDb()` call
- Committed: No (stores sensitive member data, likely in .gitignore)
- Schema: Defined in `initDb()` function (laposta-db.js lines 31-67)

Tables:
- `sportlink_runs`: Raw member JSON exports (history)
- `laposta_fields`: Field definitions cache
- `members`: Current member state with sync tracking

