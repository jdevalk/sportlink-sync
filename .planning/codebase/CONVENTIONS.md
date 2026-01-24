# Coding Conventions

**Analysis Date:** 2026-01-24

## Naming Patterns

**Files:**
- Kebab-case for all files: `download-data-from-sportlink.js`, `prepare-laposta-members.js`, `submit-laposta-list.js`
- Purpose-driven naming: function name describes what the script does
- Data files use descriptive prefixes: `laposta-members.json`, `field-mapping.json`, `sportlink-fields.json`

**Functions:**
- camelCase for all functions: `readEnv()`, `createLogger()`, `parseBool()`, `normalizeEmail()`
- Helper functions describing data transformation: `stableStringify()`, `computeSourceHash()`, `buildBaseCustomFields()`
- Verb-based naming for actions: `insertSportlinkRun()`, `upsertMembers()`, `deleteMembersForList()`
- Predicate functions use "is" or "has" prefix: `hasValue()`, `isValidEmail()`, `isParentMember()`, `isStandaloneParent()`

**Variables:**
- camelCase for all variables: `debugEnabled`, `logDebug`, `baseCustomFields`, `emailUsageMap`
- Descriptive names for maps/collections: `primaryEmailMap`, `parentNamesMap`, `parentTeamsMap`, `parentAgeClassMap`
- Normalized/processed values use explicit suffixes: `normalizedPrimary`, `normalized` (from `normalizeEmail()`)
- Constants in UPPER_SNAKE_CASE: `DEFAULT_DB_PATH`, `MAX_LISTS`, `EMAIL_FIELDS`, `EXCLUDED_CUSTOM_FIELDS`, `LIST_ENV_KEYS`, `ENV_KEYS`

**Types/Objects:**
- Custom field objects use snake_case keys: `custom_fields`, `custom_fields_json`, `last_synced_custom_fields_json`
- Database column names use snake_case: `list_index`, `list_id`, `source_hash`, `last_seen_at`, `created_at`
- API field names follow Laposta API convention (snake_case): `custom_fields`, `member_id`, `field_id`, `custom_name`
- Response/payload objects match API format: `member.email`, `member.custom_fields`, `member.last_synced_hash`

## Code Style

**Formatting:**
- No explicit linter/formatter configured (no eslintrc, prettierrc, or babel config found)
- Indentation: 2 spaces (observed throughout codebase)
- Line length: No hard limit observed, but most lines stay under 100 characters
- Semicolons: Used throughout (not optional)
- String quotes: Single quotes preferred in data strings, but depends on context (uses both)
- Trailing commas: Generally included in multiline structures

**Linting:**
- ESLint directives present: `// eslint-disable-next-line` used for `no-await-in-loop` in acceptable async contexts
- Located in: `submit-laposta-list.js` (line 303), `dedupe-laposta-list.js` (lines 171, 238, 240)
- Pattern: Disable only when unavoidable, with specific rule names

## Import Organization

**Order:**
1. Built-in Node modules: `require('dotenv')`, `require('path')`, `require('crypto')`, `require('https')`
2. Third-party packages: `require('better-sqlite3')`, `require('playwright')`, `require('otplib')`
3. Local modules: `require('./laposta-db')`, `require('./submit-laposta-list')`

**Module Pattern:**
- CommonJS `require()` exclusively (no ES6 import statements)
- Destructuring in require statements: `const { openDb, insertSportlinkRun } = require('./laposta-db');`
- Module exports use `module.exports = { ... }` pattern
- Grouped exports at end of file: See `laposta-db.js` lines 312-329

**Path Aliases:**
- Relative paths only: `./filename` for same-directory, no alias configuration
- Absolute paths for file system operations: `path.join(process.cwd(), 'filename')`

## Error Handling

**Patterns:**
- Explicit error checking with throw new Error(): `throw new Error('Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD');`
- Try/finally blocks for resource cleanup (database connections): See `laposta-db.js` and `prepare-laposta-members.js`
- Error propagation in promises: `.catch()` handlers that call `process.exitCode = 1`
- Error messages include context: `Error: Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD`
- Detailed error logging with console.error() for API failures with status codes and response bodies
- Custom error properties: `error.details` attached for structured error information (see `submit-laposta-list.js` lines 110, 163, 222)
- Graceful degradation for non-critical operations: "Warning: could not fetch Laposta fields" (line 251 of `submit-laposta-list.js`)

## Logging

**Framework:** Built-in `console` module only (no winston, pino, or other logging library)

**Patterns:**
- `console.log()` for normal output and progress messages
- `console.error()` for errors and warnings
- Structured logging for complex data: `JSON.stringify(data, null, 2)` for pretty-printed JSON output
- Debug logging with conditional function wrapper: `createLogger(enabled)` in `download-data-from-sportlink.js` lines 11-17
- Progress tracking format: `Progress list ${listIndex}: ${i + 1}/${members.length}` (line 267 of `submit-laposta-list.js`)
- Silent mode support via environment variable: `DEBUG_LOG` controls debug output (line 42 of `download-data-from-sportlink.js`)

## Comments

**When to Comment:**
- Minimal inline comments observed
- Complex logic gets brief explanations: See "Random between 1-5 seconds" (line 88 of `download-data-from-sportlink.js`)
- Algorithm explanations for non-obvious operations: See deduplication logic in `dedupe-laposta-list.js`
- Section separators for major code blocks: Comment before major operations like API calls or data transformations

**JSDoc/TSDoc:**
- No JSDoc documentation present
- Pure JavaScript without type annotations
- Function purposes inferred from descriptive names

## Function Design

**Size:**
- Generally 20-60 lines for main functions
- Shorter helpers (5-20 lines) for reusable logic: `hasValue()`, `normalizeEmail()`, `parseArgs()`
- Database operations consolidated in separate module: `laposta-db.js` (330 lines) as single responsibility module

**Parameters:**
- Functions accept data objects rather than many positional args: `buildMemberEntry(member, email, emailType, baseCustomFields, parentNamesMap, ...)`
- Optional parameters use defaults: `function readEnv(name, fallback = '')` (line 7 of multiple files)
- Database methods use positional parameters for SQL binding: `getMembersNeedingSync(db, listIndex, force = false)`

**Return Values:**
- Explicit null/empty returns for no-data cases: `if (!row) return null;` (line 93 of `laposta-db.js`)
- Transformed data objects returned: `{ email, custom_fields }` format in `buildMemberEntry()`
- Array returns for collection results, empty arrays for no results: `return [];` pattern
- Promise-based async functions return parsed/structured data from API responses

## Module Design

**Exports:**
- Single file per responsibility: `laposta-db.js` exports all database operations
- Grouped exports at module end: `module.exports = { ...}` with 15+ exports for database module
- No default exports (named exports only)
- Functions exported in logical grouping: initialization, read operations, write operations, state management

**Barrel Files:**
- No barrel exports or index.js files
- Direct requires from specific modules: `require('./laposta-db')` not `require('./lib')`

---

*Convention analysis: 2026-01-24*
