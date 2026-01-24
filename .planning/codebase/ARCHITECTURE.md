# Architecture

**Analysis Date:** 2026-01-24

## Pattern Overview

**Overall:** Multi-stage ETL pipeline with persistent state management

**Key Characteristics:**
- Sequential pipeline: Sportlink extraction → Laposta preparation → Laposta submission
- SQLite-based state tracking across runs
- Stateless CLI scripts coordinated by npm run targets
- Change-tracking via content hashing (SHA256)
- Multi-list support (4 independent Laposta lists)

## Layers

**Data Acquisition (Extraction):**
- Purpose: Authenticate to Sportlink club management system and fetch member data
- Location: `download-data-from-sportlink.js`
- Contains: Playwright-based browser automation, TOTP generation, network request handling
- Depends on: Playwright browser, Sportlink API/web portal, .env credentials
- Used by: Manual invocation via `npm run download`

**Data Persistence:**
- Purpose: Manage SQLite database for caching and state tracking
- Location: `laposta-db.js`
- Contains: Database schema initialization, CRUD operations for members and sync state
- Depends on: better-sqlite3, Node crypto module
- Used by: All scripts that need to store or retrieve member data

**Data Transformation (Preparation):**
- Purpose: Convert Sportlink member data to Laposta format with multi-list distribution
- Location: `prepare-laposta-members.js`
- Contains: Field mapping, parent/child association logic, email deduplication, team merging
- Depends on: laposta-db.js, field-mapping.json
- Used by: Manual invocation via `npm run prepare-laposta`

**Data Synchronization (Submission):**
- Purpose: Submit prepared member changes to Laposta API
- Location: `submit-laposta-list.js`
- Contains: Laposta API client, change detection, rate-limited submission
- Depends on: laposta-db.js, Node https module
- Used by: Manual invocation via `npm run sync-laposta`

**Utility/Query Layer:**
- Purpose: Inspect current state without modifying
- Locations: `show-laposta-member.js`, `show-sportlink-member.js`, `show-laposta-changes.js`, `dedupe-laposta-list.js`
- Contains: Read-only queries, diff computation, Laposta duplicate detection
- Depends on: laposta-db.js, Node https module

## Data Flow

**Full Sync Workflow (npm run sync-all):**

1. Download stage: Browser automation logs into Sportlink → captures member search response → stores raw JSON in `sportlink_runs` table
2. Prepare stage: Reads latest Sportlink run JSON → transforms members with field mapping → deduplicates across 4 lists → computes source hash for each member → upserts to `members` table
3. Submit stage: Queries members where `source_hash != last_synced_hash` → fetches Laposta fields for each list → submits unchanged members one-by-one via HTTPS → updates `last_synced_hash` on success

**State Management:**

Database schema (`laposta-sync.sqlite`):
- `sportlink_runs`: Raw member export JSON from Sportlink (immutable history)
- `laposta_fields`: Cached field definitions from Laposta for reference
- `members`: Current member state with tracking
  - `source_hash`: SHA256 of email + custom_fields (from latest Sportlink data)
  - `last_synced_hash`: SHA256 of what was last submitted to Laposta
  - `last_synced_custom_fields_json`: Previous state for diff display
  - Change detection: `source_hash != last_synced_hash` indicates pending sync

**Change Detection Strategy:**

Uses content hashing instead of timestamps:
1. Sportlink extraction: No change tracking, always stores fresh data
2. Preparation: Computes `source_hash` = SHA256(email + custom_fields) for each member
3. Submission: Only syncs members where `source_hash != last_synced_hash`
4. Completion: Updates `last_synced_hash = source_hash` after successful API submission

This allows re-running preparation without re-downloading if Sportlink data is stale.

## Key Abstractions

**Database Module (laposta-db.js):**
- Purpose: Isolate all SQLite interactions
- Examples: `openDb()`, `upsertMembers()`, `getMembersNeedingSync()`, `computeSourceHash()`
- Pattern: Exports pure functions; handles transaction logic internally; stable stringification for consistent hashing

**Field Mapping:**
- Purpose: Declarative mapping between Laposta custom field names and Sportlink member attributes
- Examples: `field-mapping.json` maps Laposta "voornaam" → Sportlink "FirstName"
- Pattern: JSON config consumed by prepare-laposta-members.js

**Member Entity Transformation:**
- Purpose: Convert single Sportlink member (child) into 1-4 Laposta member entries (child + up to 2 parents + parent email-only variants)
- Examples: Child member with parent emails becomes 3 entries if all emails unique
- Pattern: Complex multi-pass algorithm in `prepare-laposta-members.js` (lines 309-432)

## Entry Points

**download-data-from-sportlink.js:**
- Location: `download-data-from-sportlink.js` (main export in package.json)
- Triggers: `npm run download`
- Responsibilities: Read SPORTLINK_USERNAME/PASSWORD/OTP_SECRET from .env → authenticate via Playwright → fetch SearchMembers API → store in database

**prepare-laposta-members.js:**
- Location: `prepare-laposta-members.js`
- Triggers: `npm run prepare-laposta`
- Responsibilities: Read latest Sportlink data from DB → apply field mapping → transform into Laposta format → handle multi-list distribution → detect changes → upsert to DB

**submit-laposta-list.js:**
- Location: `submit-laposta-list.js`
- Triggers: `npm run sync-laposta` (optional list index, optional --force)
- Responsibilities: Fetch changed members from DB → call Laposta API per member → update sync state on success → log errors

**Query/Utility Entry Points:**
- `show-laposta-member.js`: CLI interface to `getMembersByEmail()` with diff display
- `show-sportlink-member.js`: Display raw Sportlink member from latest run
- `show-laposta-changes.js`: Display all pending changes with diffs (respects --all flag)
- `dedupe-laposta-list.js`: Fetch all members from Laposta API → find duplicate parent entries → optionally delete via API

## Error Handling

**Strategy:** Fail fast on initialization, graceful degradation on API calls

**Patterns:**

Critical errors (exit immediately):
- Missing environment variables: `SPORTLINK_USERNAME`, `SPORTLINK_PASSWORD`, `SPORTLINK_OTP_SECRET`, `LAPOSTA_API_KEY` (checked in each script)
- Invalid Sportlink response during authentication
- No Sportlink results in DB when prepare stage runs

API/Network errors (partial failure tolerated):
- Laposta field fetch warning logged, submission proceeds without field cache (`submit-laposta-list.js` lines 245-252)
- Laposta member submission errors collected in-memory and written to `laposta-submit-errors-listN.json` after batch complete
- Individual member submissions continue after error with 2000ms delay

Database errors: Not explicitly caught; transactions are atomic within single script invocation.

## Cross-Cutting Concerns

**Logging:**
- Approach: `console.log/console.error` to stdout/stderr
- Debug mode: `DEBUG_LOG=true` in .env enables verbose Playwright request/response logging
- Format: Progress messages during sync ("Progress list 1: 42/100")

**Validation:**
- Approach: Implicit via database schema and strict email checks
- Email validation: `isValidEmail()` requires `@` symbol; normalized lowercase for comparison
- Custom field validation: Excluded fields hardcoded: `['{{email}}', 'emailadres2', 'emailouder1', 'emailouder2']`
- Gender normalization: `Male` → `M`, `Female` → `V` (hardcoded in buildBaseCustomFields)

**Authentication:**
- Approach: Environment variables read at script startup
- Sportlink: Username + Password + TOTP secret (otplib generates codes)
- Laposta: API key used in Basic auth header for all HTTPS requests
- Storage: .env file (not committed), example in .env.example

**Rate Limiting:**
- Approach: Hard-coded delays between API calls
- Sportlink: Random 1-5 second wait before clicking search button (lines 88-90)
- Laposta member submission: 2000ms delay between sequential requests (line 279)
- Laposta dedup deletion: 1500ms delay between deletes (line 241)

