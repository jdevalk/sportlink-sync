# Codebase Concerns

**Analysis Date:** 2026-01-24

## Tech Debt

**Dependency Versions Pinned to Latest:**
- Issue: `package.json` specifies all dependencies as `"latest"` without version pinning, causing non-deterministic builds and potential breaking changes.
- Files: `package.json`
- Impact: Different installations may have incompatible versions. Critical for browser automation (`playwright`, `better-sqlite3`) which frequently introduce breaking changes.
- Fix approach: Replace `"latest"` with specific pinned versions (e.g., `"^11.0.0"`), use `package-lock.json` to lock transitive dependencies.

**HTTP Request Implementation Duplicated:**
- Issue: HTTPS request logic is duplicated across `submit-laposta-list.js` and `dedupe-laposta-list.js` with variations in error handling.
- Files: `submit-laposta-list.js` (lines 70-120, 122-172, 174-233), `dedupe-laposta-list.js` (lines 68-120)
- Impact: Bug fixes or security patches must be applied in multiple places. Different behavior between identical operations.
- Fix approach: Extract HTTP request abstraction to shared module (`laposta-http.js`), implement once with consistent error handling.

**Direct HTTPS Module Usage Instead of Fetch:**
- Issue: Uses native Node.js `https.request` with manual event handling instead of built-in `fetch` (available in Node 18+).
- Files: `submit-laposta-list.js`, `dedupe-laposta-list.js`
- Impact: More verbose, error-prone manual stream handling. Playwright already uses modern APIs.
- Fix approach: Use `fetch` API with `Authorization` header, reduces code by ~60% per file.

**Database Connection Management Not Guarded:**
- Issue: Database connections opened in try blocks but some code paths may not reach `finally` if sync operations throw.
- Files: `submit-laposta-list.js` (lines 243-293), `prepare-laposta-members.js` (lines 435-464)
- Impact: Potential leaked database connections if async operations fail mid-stream.
- Fix approach: Ensure all async operations within try block are properly awaited; consider using database connection pooling.

**No Automated Tests:**
- Issue: No test framework or test files present.
- Files: N/A (entire project)
- Impact: Regressions go undetected. Brittle to Sportlink/Laposta API changes. Manual testing only.
- Fix approach: Add Jest/Vitest with unit tests for data transformation logic, mock external APIs, add integration tests with fixture data.

## Known Bugs

**Incomplete Error Recovery in Download:**
- Issue: If Sportlink login succeeds but member search POST fails, error is logged but no state is saved. Retry logic must be manual.
- Files: `download-data-from-sportlink.js` (lines 114-127)
- Impact: Failed downloads leave stale data in database. No way to distinguish between "never fetched" and "last fetch failed".
- Workaround: User must manually re-run after fixing the underlying issue.

**OTP Secret Validation Missing:**
- Issue: OTP code checked only after generation (line 68), not before entry. Malformed secret results in invalid code sent to Sportlink.
- Files: `download-data-from-sportlink.js` (lines 64-70)
- Impact: Silent failure at login (OTP rejected by Sportlink). No clear feedback to user.
- Fix approach: Validate `SPORTLINK_OTP_SECRET` format before browser automation starts.

**Hardcoded IP Address in Laposta Requests:**
- Issue: All Laposta member requests use hardcoded IP `3.3.3.3`.
- Files: `submit-laposta-list.js` (line 186)
- Impact: Laposta may reject/block requests, rate limit incorrectly, or flag as suspicious activity. Not representative of actual client.
- Fix approach: Remove IP parameter or use actual request IP from environment.

**Email Normalization Case Sensitivity in Database Queries:**
- Issue: `getMembersByEmail` and similar functions normalize email to lowercase in SQL (`lower(email)`), but some code relies on exact case matching elsewhere.
- Files: `laposta-db.js` (lines 230, 237, 242)
- Impact: Inconsistent behavior if data contains mixed-case emails. Comparison logic may fail.
- Fix approach: Consistently normalize all email inputs at entry point before database storage.

**Field Mapping Assumes Specific Structure:**
- Issue: `prepare-laposta-members.js` expects hardcoded field keys from `field-mapping.json` without validation.
- Files: `prepare-laposta-members.js` (lines 339-340)
- Impact: Missing or incorrectly named fields silently produce empty/null values instead of errors.
- Fix approach: Validate mapping keys exist and are non-empty before processing.

## Security Considerations

**Credentials in Environment Variables Unvalidated:**
- Risk: `.env` file may contain empty or partially configured credentials. No validation before use.
- Files: `download-data-from-sportlink.js` (lines 34-40), `submit-laposta-list.js` (lines 72-76), `dedupe-laposta-list.js` (lines 70-74)
- Current mitigation: Missing credentials throw errors at runtime.
- Recommendations: Add startup validation function to check all required env vars are present and non-empty before any operations begin. Consider `.env.example` template validation against actual `.env`.

**Base64 Auth Tokens Built Inline:**
- Risk: API keys visible in base64-encoded form in network requests (not encrypted, just encoded). Error details logged to console may expose tokens.
- Files: `submit-laposta-list.js` (line 88, 140, 201), `dedupe-laposta-list.js` (line 83)
- Current mitigation: Authorization header only sent over HTTPS.
- Recommendations: Ensure error logs never include raw API responses or headers. Use redaction for sensitive headers in debug output.

**OTP Secret Stored in Plain Text `.env`:**
- Risk: TOTP secret must be present as plain text in `.env` to enable automated login. Compromise of `.env` exposes all Sportlink account.
- Files: `.env` (referenced in `download-data-from-sportlink.js`)
- Current mitigation: `.env` should be in `.gitignore`.
- Recommendations: Document `.gitignore` requirement clearly. Consider alternative: encrypted secrets or external secret manager. Warn if `.env` is detected in git history.

**No Rate Limiting on Laposta API Calls:**
- Risk: Bulk operations (`submit-laposta-list.js`) send individual requests with 2-second delays but no backoff for rate limits.
- Files: `submit-laposta-list.js` (lines 265-281)
- Current mitigation: Errors are logged to file.
- Recommendations: Implement exponential backoff on 429 responses. Add circuit breaker for repeated failures.

**Data Sent to Laposta Unvalidated:**
- Risk: Custom fields sent to Laposta without type/format validation. Invalid data may silently fail or corrupt Laposta state.
- Files: `submit-laposta-list.js` (lines 57-68)
- Current mitigation: Laposta API validates and returns errors.
- Recommendations: Validate field types against Laposta schema (fetched in `fetchLapostaFields` but not used for validation).

## Performance Bottlenecks

**Sequential Member Submission to Laposta:**
- Problem: Members submitted one-by-one with 2-second delays between requests (no parallelization).
- Files: `submit-laposta-list.js` (lines 265-281)
- Cause: Conservative rate limiting and error handling per-member.
- Improvement path: Use Laposta bulk API (`lapostaBulkRequest` function exists at line 70 but is unused in sync loop). Batch members into groups of 10-100, submit in parallel with request pooling, improve to O(n/batch_size) instead of O(n).

**Full In-Memory JSON Parsing:**
- Problem: Entire Sportlink results JSON loaded into memory when processing large member lists.
- Files: `prepare-laposta-members.js` (lines 305-307)
- Cause: No streaming parser; loads full response before processing.
- Improvement path: For large lists (1000+ members), consider streaming JSON parser or chunked processing.

**Database Transactions Not Used for Bulk Inserts:**
- Problem: Bulk member upserts use transaction correctly in `laposta-db.js` but each call to `upsertMembers` opens transaction independently.
- Files: `laposta-db.js` (lines 125-143), `prepare-laposta-members.js` (lines 435-461)
- Cause: Not a bottleneck for current scale but prevents optimization.
- Improvement path: Pass multiple lists to single transaction, batch all updates together.

**Unindexed Lookups in Dedup Logic:**
- Problem: `dedupe-laposta-list.js` builds full in-memory maps of all members across all lists before filtering.
- Files: `dedupe-laposta-list.js` (lines 183-197)
- Cause: No database indexes for dedup operations.
- Improvement path: Add index on `(list_index, email)`, query database directly for duplicates instead of fetching all members.

## Fragile Areas

**Browser Automation Dependent on Selectors:**
- Files: `download-data-from-sportlink.js` (lines 58-108)
- Why fragile: Hardcoded selectors (`#username`, `#password`, `#panelHeaderTasks`, `#btnShowMore`, etc.) break if Sportlink changes UI. No fallback strategies.
- Safe modification: Add selector validation on first load; log actual page state if selectors fail. Consider taking page screenshots on error.
- Test coverage: No tests; manual verification only.

**Email Validation Too Permissive:**
- Files: `prepare-laposta-members.js` (lines 56-59)
- Why fragile: Validation only checks for `@` symbol; accepts invalid emails like `@`, ` @ `, `a@`.
- Safe modification: Use proper email regex or validation library (e.g., `email-validator`). Validate during data import, not during sync.
- Test coverage: No unit tests for email validation.

**Field Mapping Tightly Coupled:**
- Files: `prepare-laposta-members.js` (entire file relies on external `field-mapping.json`)
- Why fragile: Hardcoded field keys (`geslacht`, `team`, `leeftijdscategorie`, `oudervan`) throughout. Changes to mapping break downstream code.
- Safe modification: Create mapping schema validator. Define field keys as constants. Add mapping version to database.
- Test coverage: No tests for mapping edge cases.

**Custom Field Serialization Non-Reversible:**
- Files: `laposta-db.js` (lines 20-23 `stableStringify`, 184, 206-210)
- Why fragile: Custom `stableStringify` used instead of `JSON.stringify`. Parsing back with `JSON.parse` works but format is non-standard.
- Safe modification: Use standard `JSON.stringify` with sorted keys. Consider schema versioning for future format changes.
- Test coverage: Function exists but not tested.

**Dependency on Playwright Version Stability:**
- Files: `download-data-from-sportlink.js` (lines 4, 45-50)
- Why fragile: Uses Playwright API directly with no abstraction. Breaking changes in `playwright@latest` break download script.
- Safe modification: Pin Playwright version. Create `browser-automation.js` module that abstracts API calls.
- Test coverage: No tests; discovered at runtime only.

## Scaling Limits

**Single Database File:**
- Current capacity: ~1000 members before noticeable SQLite contention.
- Limit: SQLite has write locks at table level. Concurrent sync operations will queue/fail.
- Scaling path: Migrate to PostgreSQL if concurrent syncs required. Implement read replicas for reporting.

**In-Memory Dedup Map:**
- Current capacity: Limited by Node.js memory (typically 512MB-2GB heap). With ~1MB per member metadata, max ~1000-2000 members.
- Limit: If Sportlink or Laposta list grows beyond 5000 members, dedup will OOM.
- Scaling path: Implement database-backed dedup. Query Laposta with pagination; process members in chunks.

**Sportlink Browser Session Timeout:**
- Current capacity: Single download session lasts ~5 minutes (network + login + search).
- Limit: If member list takes >5 minutes to fetch, session may timeout.
- Scaling path: Implement session keepalive or re-login on timeout. Add member count validation to detect truncated responses.

## Dependencies at Risk

**better-sqlite3 Version Drift:**
- Risk: Pinned to `"latest"` in `package.json`. Major version updates may require C++ recompilation for Node version.
- Impact: `npm install` may fail on different Node versions or platforms. Breaks CI/CD.
- Migration plan: Pin to specific version (e.g., `^9.0.0`). Test on target Node version before upgrading.

**playwright Version Instability:**
- Risk: Playwright updates frequently; minor versions can change browser APIs.
- Impact: Download script may break without code changes.
- Migration plan: Pin to major version (e.g., `^1.40.0`). Add integration tests that verify selectors/login flow work.

**dotenv Late-of-Lifecycle:**
- Risk: If Node version drops support for `.env`, manual migration required.
- Impact: All scripts require `require('dotenv').config()` at start; removing dependency is tedious.
- Migration plan: Consider using Node's built-in `--env-file` flag (Node 21.7+) for future-proofing.

## Missing Critical Features

**No Dry-Run Mode:**
- Problem: Only `dedupe-laposta` has `--apply` flag. Other operations have no dry-run option.
- Blocks: Operators cannot preview changes to Laposta before committing.
- Workaround: Create isolated Laposta test list and sync to that first.

**No Audit Log:**
- Problem: No persistent record of what was synced, when, and with what result.
- Blocks: Tracing who changed what in Laposta membership. Post-incident analysis impossible.
- Workaround: Manual inspection of Laposta UI history.

**No Rollback Mechanism:**
- Problem: If sync introduces bad data to Laposta, recovery is manual deletion.
- Blocks: Cannot undo partial syncs if errors occur mid-stream.
- Workaround: Export Laposta list before sync, manually import if needed.

**No Monitoring/Alerting:**
- Problem: No health checks, no alerts if sync fails. Operator must check manually.
- Blocks: Silent failures (e.g., Sportlink credentials expired, Laposta API down).
- Workaround: Manual cron job verification, periodic manual testing.

## Test Coverage Gaps

**Data Transformation Logic Untested:**
- What's not tested: `prepare-laposta-members.js` member entry construction, field mapping, name parsing, team merging.
- Files: `prepare-laposta-members.js` (lines 61-290)
- Risk: Incorrect transformations to Laposta (missing fields, wrong names, corrupted team lists) go undetected until live sync.
- Priority: High

**Database Query Logic Untested:**
- What's not tested: SQL queries in `laposta-db.js`, edge cases for email normalization, hash collision handling.
- Files: `laposta-db.js` (lines 97-252)
- Risk: Data corruption or loss on edge cases (duplicate emails, missing hashes).
- Priority: High

**Laposta API Integration Untested:**
- What's not tested: API request formatting, error handling, retry logic, bulk vs. individual submission.
- Files: `submit-laposta-list.js` (lines 70-232), `dedupe-laposta-list.js` (lines 68-142)
- Risk: Silent failures (malformed requests accepted by API but not processed), rate limit handling broken.
- Priority: High

**Browser Automation Untested:**
- What's not tested: Sportlink login flow, selector validation, timeout handling, OTP generation.
- Files: `download-data-from-sportlink.js` (lines 33-140)
- Risk: Download fails silently if UI changes or credentials expire.
- Priority: Medium

**Email Validation Edge Cases:**
- What's not tested: International emails, plus-addressing, subdomains, case sensitivity.
- Files: `prepare-laposta-members.js` (lines 56-59)
- Risk: Valid emails rejected or invalid emails accepted.
- Priority: Medium

**Configuration Validation:**
- What's not tested: Missing env vars, invalid field mappings, missing Laposta lists.
- Files: `download-data-from-sportlink.js`, `submit-laposta-list.js`, `prepare-laposta-members.js` (env reading scattered)
- Risk: Scripts fail at arbitrary points instead of startup validation.
- Priority: Low

---

*Concerns audit: 2026-01-24*
