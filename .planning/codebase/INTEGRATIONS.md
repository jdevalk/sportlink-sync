# External Integrations

**Analysis Date:** 2026-01-24

## APIs & External Services

**Sportlink Club:**
- Service: Sportlink Club web application (https://club.sportlink.com)
- What it's used for: Source of member data (names, emails, phone numbers, addresses, team assignments, age categories, etc.)
- Access method: Headless browser automation (Playwright)
- Authentication: Username/password + TOTP 2FA
- Implementation: `download-data-from-sportlink.js`
  - Logs in via credentials in `.env`
  - Generates OTP from secret using otplib
  - Navigates to member search page
  - Executes SearchMembers POST request
  - Captures JSON response containing member list
  - Stores raw results in SQLite for processing

**Laposta Email Marketing API:**
- Service: Laposta (https://api.laposta.nl)
- What it's used for: Syncing processed member data to email marketing lists
- SDK/Client: Node.js native `https` module (raw HTTPS requests)
- Auth: Basic authentication with `LAPOSTA_API_KEY`
  - Header format: `Authorization: Basic {base64(api_key:)}`
- Implementation: `submit-laposta-list.js`
  - Bulk member operations via POST `/v2/list/{list_id}/members`
  - Single member operations via POST `/v2/member`
  - Field definitions fetch via GET `/v2/field?list_id={list_id}`
- Endpoints:
  - `POST /v2/list/{list_id}/members` - Bulk add/update members (not currently used, single requests used instead)
  - `POST /v2/member` - Create/update single member (primary method)
  - `GET /v2/field?list_id={list_id}` - Fetch field definitions for a list
- Features:
  - Upsert capability (add if new, update if exists)
  - Custom field support with key-value pairs and arrays
  - Support for up to 4 separate mailing lists

## Data Storage

**Databases:**
- SQLite (embedded)
  - Connection: File-based at `./laposta-sync.sqlite` via better-sqlite3
  - Client: better-sqlite3
  - Tables:
    - `sportlink_runs` - Raw JSON results from each Sportlink fetch
    - `members` - Processed member data with sync state tracking
    - `laposta_fields` - Field definitions cached from Laposta API
  - Purpose: Local state management for sync tracking and change detection

**File Storage:**
- Local filesystem only
- Generated files:
  - `laposta-members.json` - Processed members for list 1
  - `laposta-members-list2.json` - Processed members for list 2
  - `laposta-members-list3.json` - Processed members for list 3
  - `laposta-members-list4.json` - Processed members for list 4
  - `laposta-submit-errors-list{N}.json` - Error logs from failed syncs
- Configuration files:
  - `field-mapping.json` - Maps Laposta field names to Sportlink field names
  - `sportlink-fields.json` - Reference for available Sportlink fields

**Caching:**
- None - API calls are made fresh on each sync
- Database queries track last sync state to avoid redundant API calls

## Authentication & Identity

**Sportlink Auth:**
- Type: Web-based username/password + TOTP 2FA
- Credentials: Stored in `.env` as:
  - `SPORTLINK_USERNAME` - Email or username
  - `SPORTLINK_PASSWORD` - Password
  - `SPORTLINK_OTP_SECRET` - Base32-encoded TOTP secret
- Implementation:
  - otplib generates TOTP codes from secret
  - Playwright automates login form submission
  - Session maintained for member search request
  - Keycloak login endpoint: https://club.sportlink.com/

**Laposta Auth:**
- Type: API key with Basic authentication
- Credentials: Stored in `.env` as `LAPOSTA_API_KEY`
- Implementation:
  - Base64-encoded to `api_key:` format
  - Sent in Authorization header with each request
  - No session required (stateless HTTP requests)

## Monitoring & Observability

**Error Tracking:**
- None detected - errors logged to console

**Logs:**
- Console output to stdout/stderr
- Optional debug logging controlled by `DEBUG_LOG` env var:
  - When enabled, logs all HTTP requests/responses (method, URL, status)
  - Shows page interactions and selector waits
- Error logs written to JSON files:
  - `laposta-submit-errors-list{N}.json` - Detailed error responses from failed API calls

## CI/CD & Deployment

**Hosting:**
- Not applicable - standalone Node.js CLI application
- Intended for manual or scheduled execution in a controlled environment

**CI Pipeline:**
- None detected - no build system, no automated tests

## Environment Configuration

**Required env vars:**
- `SPORTLINK_USERNAME` - User credentials for Sportlink Club
- `SPORTLINK_PASSWORD` - User credentials for Sportlink Club
- `SPORTLINK_OTP_SECRET` - Base32 TOTP secret for 2FA
- `LAPOSTA_API_KEY` - API credentials for Laposta
- `LAPOSTA_LIST` - Primary mailing list ID
- `LAPOSTA_LIST2` - Secondary mailing list ID (optional, can be empty)
- `LAPOSTA_LIST3` - Tertiary mailing list ID (optional, can be empty)
- `LAPOSTA_LIST4` - Quaternary mailing list ID (optional, can be empty)

**Optional env vars:**
- `DEBUG_LOG` - Set to true/1/yes to enable request/response logging

**Secrets location:**
- `.env` file in project root (not committed to version control)
- Example template: `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None - this is a push-only system

**Outgoing:**
- None - no webhooks are registered
- System operates on pull/fetch schedule (manual or scheduled externally)

## Data Flow

**Main Sync Workflow:**

1. **Download Phase** (`download-data-from-sportlink.js`):
   - Read credentials from `.env`
   - Launch Playwright browser
   - Navigate to https://club.sportlink.com/
   - Submit login form with username + password
   - Wait for OTP prompt
   - Generate TOTP code using otplib from `SPORTLINK_OTP_SECRET`
   - Submit OTP code
   - Navigate to member search page
   - Trigger SearchMembers API request with filters
   - Capture JSON response
   - Store raw JSON in `sportlink_runs` table
   - Close browser

2. **Prepare Phase** (`prepare-laposta-members.js`):
   - Fetch latest Sportlink results from database
   - Parse JSON and extract member objects
   - For each member:
     - Validate email address (case-insensitive)
     - Map Sportlink fields to Laposta fields using `field-mapping.json`
     - Handle special transformations (gender code M/V, parent names)
     - Build custom field object
   - Upsert members into `members` table with source hash
   - Write prepared members to JSON file for review

3. **Sync Phase** (`submit-laposta-list.js`):
   - Read list configuration from `.env` (LAPOSTA_LIST, LAPOSTA_LIST2, etc.)
   - For each configured list:
     - Fetch field definitions from Laposta API (GET /v2/field)
     - Cache field definitions in `laposta_fields` table
     - Query database for members needing sync (changed since last sync or force flag)
     - Submit each member individually to Laposta API (POST /v2/member)
       - Uses upsert mode (add if new, update if exists)
       - Includes all custom fields
       - Sets dummy IP 3.3.3.3
     - On success: Update `last_synced_at` and `last_synced_hash` in database
     - On error: Log error details to JSON file
     - Rate limiting: 2 second delay between requests

---

*Integration audit: 2026-01-24*
