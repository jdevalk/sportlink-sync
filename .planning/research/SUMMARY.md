# Project Research Summary

**Project:** Rondo Sync v3.3 - FreeScout Enhanced Integration
**Domain:** Helpdesk/CRM bi-directional data synchronization
**Researched:** 2026-02-12
**Confidence:** HIGH

## Executive Summary

This research evaluates three enhancements to the existing FreeScout integration: (1) syncing FreeScout email conversations as activities in Rondo Club, (2) pushing member photos to FreeScout customer avatars, and (3) mapping Sportlink RelationEnd date to FreeScout custom field ID 9. All three features fit cleanly into the existing rondo-sync architecture with minimal new infrastructure.

The recommended approach leverages existing patterns: hash-based change detection for photos and conversations, the established pipeline step model (download/prepare/submit), and the proven FreeScout API client with retry logic. No new npm dependencies are required. The most complex feature (conversations → activities) requires approximately 380 new lines of code across 2 new step files and database layer enhancements. The simpler features (photos and RelationEnd) are pure modifications to existing steps totaling ~40 lines.

Critical risks center on cross-repository dependencies. The activities API endpoint already exists in Rondo Club (confirmed via developer docs), removing the primary blocker identified during research. However, photo URL extraction requires coordination on whether to use WordPress media API calls or ACF field storage. Implementation should follow a phased approach: start with low-risk RelationEnd field mapping and photo sync, then tackle conversation sync once the Rondo Club integration pattern is validated.

## Key Findings

### Recommended Stack

No new technology stack required. All three features use existing infrastructure: Node.js 22, Playwright, better-sqlite3, the FreeScout API client (`lib/freescout-client.js`), the Rondo Club API client (`lib/rondo-club-client.js`), and the hash-based change detection pattern established in `lib/freescout-db.js`.

**Core technologies (existing):**
- **better-sqlite3**: Conversation tracking table, photo hash storage — proven reliable for member sync tracking
- **FreeScout API client**: Conversations endpoint (`/api/conversations`), photoUrl field, custom fields API — already handles authenticated requests with exponential backoff retry logic
- **Rondo Club API client**: Activities POST endpoint (verified to exist), WordPress media API for photo URLs — existing infrastructure handles authentication
- **Hash-based change detection**: Prevents duplicate uploads/creates, enables incremental sync — established pattern from customer sync

**Critical environment variable:**
- `FREESCOUT_FIELD_RELATION_END=9` (optional, defaults to 9) — enables different field IDs across demo/production environments

**Database migrations (in-code via initDb()):**
- `freescout_customers` table: Add `photo_hash`, `photo_synced_hash` columns
- New `freescout_conversations` table: Track conversation sync state with hash-based change detection

### Expected Features

Research identified standard CRM/helpdesk integration patterns that users expect, competitive differentiators for Rondo Sync's unique use case, and anti-features to explicitly avoid.

**Must have (table stakes):**
- Email conversation visibility in CRM — Industry standard. CRMs display support ticket history on customer records. Rondo Club users work in WordPress, not FreeScout, so conversation visibility is essential for context.
- Customer photos/avatars in helpdesk — Visual identification speeds up support. Expected in modern helpdesk systems (HelpScout, Zendesk, Intercom).
- Custom field sync for membership data — Helpdesk agents need context like membership end date. Custom fields are standard for CRM/helpdesk integrations.

**Should have (competitive differentiators):**
- Real-time activity feed in WordPress — Agents work in Rondo Club, not FreeScout. Inline conversation display eliminates tab switching. Creates single source of truth.
- Bi-directional photo sync — Sportlink → Rondo Club → FreeScout creates single pipeline. Manual photo management across systems is error-prone.
- Automated membership status indicators — "Lid tot" (RelationEnd) date in FreeScout enables proactive support (renewal reminders, post-membership inquiries).

**Defer (v2+):**
- Real-time webhooks — Polling inefficiency doesn't justify webhook complexity for sports club volumes. Cached conversation display (nightly sync) is sufficient.
- Two-way custom field sync — FreeScout is not authoritative for membership data. One-way sync maintains Sportlink as canonical source.
- Inline photo editing in FreeScout — Photos originate from Sportlink. Editing in FreeScout bypasses source of truth and complicates sync logic.

### Architecture Approach

All three features follow the established rondo-sync pipeline pattern: download → prepare → submit. The architecture extends existing components rather than introducing new patterns.

**Major components:**

1. **Photo sync (Feature 2)** — Modify `prepare-freescout-customers.js` to extract photo URL from Rondo Club (via WordPress media API or ACF field). Modify `submit-freescout-sync.js` to include `photoUrl` in customer payload. Add photo hash columns to `freescout_customers` table for change detection. Pure enhancement to existing steps, no new files.

2. **RelationEnd sync (Feature 3)** — Modify `prepare-freescout-customers.js` to extract RelationEnd from member data (verify source: ACF field vs raw Sportlink data in `data_json`). Modify `submit-freescout-sync.js` to add field ID 9 to custom fields payload. Add one environment variable. Simplest feature, approximately 10 lines of code changes.

3. **Conversation sync (Feature 1)** — New step `download-conversations-from-freescout.js` fetches conversations by customer from FreeScout API with pagination handling. New `freescout_conversations` tracking table with hash-based change detection. New step `sync-conversations-to-rondo-club.js` posts activities to Rondo Club `/rondo/v1/people/{id}/activities` endpoint. Wire into `pipelines/sync-freescout.js`. Approximately 380 new lines across 2 files plus database enhancements.

**Data flow:**
```
FreeScout conversations API → download step → SQLite tracking → submit step → Rondo Club activities API
Rondo Club photo URL → prepare step → submit step → FreeScout customer photoUrl field
Sportlink RelationEnd → prepare step → submit step → FreeScout custom field ID 9
```

**File impact:** 2 new step files, 5 modified files, approximately 610 total lines of new code.

### Critical Pitfalls

Research identified 15 pitfalls across critical/moderate/minor severity. Top 5 critical pitfalls that could cause data corruption or require full rewrites:

1. **Photo upload without hash-based change detection** — Re-uploading unchanged photos daily wastes bandwidth and risks API limits. Sync time increases linearly with member count. **Prevention:** Extend `freescout_customers` with `photo_hash` and `photo_synced_hash` columns. Skip upload if hash unchanged. Use existing `computeHash()` from `lib/utils.js`.

2. **FreeScout conversation pagination without total count verification** — Fetching page 1 only syncs 50 most recent emails per customer. Older conversations never appear. Silent data loss. **Prevention:** Check `page.totalPages` metadata, iterate all pages with rate limiting (200ms between pages), log total vs fetched counts for verification.

3. **RelationEnd custom field date format mismatch** — FreeScout expects `YYYY-MM-DD`, but ACF may return `d/m/Y` or ISO 8601 timestamp. Wrong format stored as string "Invalid date", breaking FreeScout UI. **Prevention:** Normalize dates using regex patterns (handle YYYYMMDD, ISO 8601, and YYYY-MM-DD formats). Validate before API submission.

4. **WordPress activity relationship without orphan cleanup** — FreeScout conversations deleted (GDPR, customer left) but activity posts remain in WordPress, pointing to non-existent conversation IDs. ACF relationship breaks. **Prevention:** Track conversation → activity mapping in `freescout_conversations` table. Cascade delete activities when customer deleted. Add weekly orphan cleanup cron.

5. **FreeScout photoUrl vs photo blob upload API ambiguity** — `photoUrl` parameter works on hosted FreeScout but self-hosted instances may not fetch remote URLs (security, firewall, missing module). Photos don't appear despite sync success. **Prevention:** Test both URL-based and multipart upload methods during implementation. Verify photos appear in FreeScout UI after test sync. Implement fallback if URL method fails verification.

## Implications for Roadmap

Based on research, the recommended phase structure follows a risk-based ordering: start with low-complexity, high-value features to validate the integration pattern, then tackle the more complex conversation sync.

### Phase 1: RelationEnd Field Mapping
**Rationale:** Lowest complexity (10 lines of code), immediate value (membership expiration visibility for support agents), zero cross-repo dependencies. Validates FreeScout custom fields API pattern before more complex features.

**Delivers:** Sportlink RelationEnd date visible in FreeScout custom field ID 9, enabling support agents to see membership expiration dates without switching to Sportlink.

**Addresses:**
- Table stakes: Custom field sync for membership data
- Differentiator: Automated membership status indicators

**Avoids:**
- Pitfall 3: Date format mismatch via normalization to YYYY-MM-DD
- Pitfall 10: Custom field ID hardcoding via environment variable

**Implementation:**
- Modify `prepare-freescout-customers.js`: Extract RelationEnd from member data (verify source in `rondo_club_members.data_json`)
- Modify `submit-freescout-sync.js`: Add field ID 9 to `getCustomFieldIds()` and `buildCustomFieldsPayload()`
- Add `FREESCOUT_FIELD_RELATION_END=9` to `.env` and `.env.example`

**Research needed:** None — standard pattern.

### Phase 2: Photo URL Sync to FreeScout
**Rationale:** Low complexity (40 lines), high visual recognition benefit. Requires coordination with Rondo Club team on photo URL approach (ACF field vs WordPress media API), but no new step files. Validates photoUrl API pattern before conversation sync.

**Delivers:** Member photos from Sportlink automatically appear as FreeScout customer avatars, enabling visual identification in support tickets.

**Addresses:**
- Table stakes: Customer photos/avatars in helpdesk
- Differentiator: Bi-directional photo sync (Sportlink → Rondo Club → FreeScout pipeline)

**Avoids:**
- Pitfall 1: Hash-based change detection prevents re-uploading unchanged photos
- Pitfall 5: Test both photoUrl and multipart upload methods
- Pitfall 11: Hash file content, not filename/extension

**Implementation:**
- Coordinate with Rondo Club: Decide approach (ACF `photo_url` field vs WordPress media API GET)
- Extend `freescout_customers` table: Add `photo_hash`, `photo_synced_hash`, `photo_synced_at` columns
- Modify `prepare-freescout-customers.js`: Implement `getPhotoUrl()` based on chosen approach
- Modify `submit-freescout-sync.js`: Add `photoUrl` to customer payload if available

**Research needed:** Coordinate photo URL extraction approach with Rondo Club team.

### Phase 3: FreeScout Conversations as Rondo Club Activities
**Rationale:** Highest complexity (380 new lines, 2 new files), but highest impact for users who work primarily in Rondo Club. Depends on Rondo Club activities API endpoint (confirmed to exist via developer docs). Builds on patterns validated in Phases 1 and 2.

**Delivers:** FreeScout email conversations visible as activities in Rondo Club person timeline, eliminating tab switching for support agents working in WordPress.

**Addresses:**
- Table stakes: Email conversation visibility in CRM
- Differentiator: Real-time activity feed in WordPress (cached approach)

**Avoids:**
- Pitfall 2: Pagination handling for customers with 50+ conversations
- Pitfall 4: Orphan cleanup via conversation tracking table
- Pitfall 8: Timezone conversion (UTC → Europe/Amsterdam)
- Pitfall 9: Duplicate prevention via tracking table

**Implementation:**
- Extend `lib/freescout-db.js`: Add `freescout_conversations` table with hash-based change detection
- New step: `download-conversations-from-freescout.js` (fetch via `/api/conversations?customerId={id}&embed=threads`, handle pagination)
- New step: `sync-conversations-to-rondo-club.js` (POST to `/rondo/v1/people/{id}/activities`)
- Modify `pipelines/sync-freescout.js`: Wire conversation steps after customer sync
- Add cleanup: Cascade delete activities when customer deleted, weekly orphan scan

**Research needed:** Validate Rondo Club activities API contract (payload structure, deduplication handling).

### Phase Ordering Rationale

- **Dependencies:** Phase 1 and 2 have no cross-phase dependencies and can be built in parallel. Phase 3 depends on validating the FreeScout API patterns (pagination, custom fields) established in Phases 1-2.
- **Risk reduction:** Starting with simple features (RelationEnd, photos) validates the integration approach before committing to the complex conversation sync. If FreeScout API quirks surface, they're discovered early.
- **Value delivery:** Phase 1 ships immediately (10 lines of code), providing value to support agents within days. Phase 2 follows within a week. Phase 3 delivers the flagship feature after patterns are proven.
- **Pitfall avoidance:** Hash-based change detection tested in Phase 2 (photos) before applying to Phase 3 (conversations). Date normalization tested in Phase 1 before handling conversation timestamps in Phase 3.

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (RelationEnd):** Well-documented FreeScout custom fields API. Existing pattern from `submit-freescout-sync.js` lines 18-42. Date normalization pattern established in Sportlink sync.
- **Phase 2 (Photos):** FreeScout photoUrl parameter verified in official docs. Hash-based change detection pattern exists in `freescout-db.js`. WordPress media API standard.

**Phases likely needing coordination during planning:**
- **Phase 2 (Photos):** Coordinate with Rondo Club team on photo URL extraction approach (ACF field vs media API). Decision impacts implementation complexity (0 API calls vs N+1 query risk).
- **Phase 3 (Conversations):** Validate Rondo Club activities API deduplication handling. Test with real FreeScout data to verify pagination behavior and `updatedAt` reliability for incremental sync.

**Recommended validation tests:**
- **Phase 1:** Test RelationEnd with null, empty string, "0000-00-00", future dates, past dates. Verify FreeScout UI date picker works.
- **Phase 2:** Test both photoUrl and multipart upload methods on actual FreeScout instance. Verify photos appear in UI. Test with customers lacking photos (null handling).
- **Phase 3:** Test with customer having 100+ conversations (pagination). Test with deleted conversations (orphan cleanup). Test timezone conversion during DST transition.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All features use existing infrastructure (better-sqlite3, FreeScout/Rondo Club API clients, hash-based change detection). Verified in codebase. |
| Features | HIGH | FreeScout API endpoints verified in official docs. CRM/helpdesk integration patterns validated via industry research (HelpScout, Zendesk, Intercom). Activities API confirmed in Rondo Club developer docs. |
| Architecture | HIGH | All features follow established rondo-sync patterns (download/prepare/submit steps, hash-based change detection, pipeline orchestration). Existing code inspection confirms compatibility. |
| Pitfalls | MEDIUM | Critical pitfalls verified (pagination, hash detection, date formats) via official docs and codebase analysis. FreeScout self-hosted quirks (photoUrl method, custom field IDs) flagged for testing. Conversation `updatedAt` reliability needs validation. |

**Overall confidence:** HIGH

### Gaps to Address

Research identified 5 gaps requiring validation during implementation:

1. **Photo URL extraction approach:** Does Rondo Club expose photo URL in ACF field, or must rondo-sync query WordPress media API? ACF field approach is simpler (0 API calls), but requires Rondo Club code change. Media API approach works today but risks N+1 queries. **Resolution:** Coordinate with Rondo Club team in Phase 2 planning. Recommend ACF field if feasible.

2. **RelationEnd data location:** Is RelationEnd synced to Rondo Club ACF field `relation-end`, or only available in raw Sportlink data (`rondo_club_members.data_json`)? Code inspection of `prepare-rondo-club-members.js` suggests it's in Sportlink data, but needs verification. **Resolution:** Query `rondo_club_members` table during Phase 1 implementation. Implement fallback to check both ACF and raw Sportlink data.

3. **FreeScout conversation `updatedAt` reliability:** Does `updatedAt` timestamp change when new threads added to conversation? Critical for incremental sync optimization. **Resolution:** Test with real FreeScout data in Phase 3. If unreliable, fall back to full conversation fetch (slower but safe).

4. **FreeScout photoUrl vs multipart upload:** Self-hosted FreeScout instances may not fetch remote URLs (security, firewall, missing module). `photoUrl` parameter accepted but photos don't appear. **Resolution:** Test both methods during Phase 2 implementation. Implement verification check (fetch photo URL after upload, verify 200 OK with image MIME type). Add fallback to multipart if URL method fails.

5. **Rondo Club activities deduplication:** How does `/rondo/v1/people/{id}/activities` POST endpoint handle duplicate submissions? Does it check for existing activity by conversation ID? Critical for preventing duplicate timeline entries on re-sync. **Resolution:** Review Rondo Club activities API implementation during Phase 3 planning. Implement client-side duplicate check via `freescout_conversations` tracking table if server-side deduplication unavailable.

## Sources

### Primary (HIGH confidence)
- [FreeScout API Reference](https://api-docs.freescout.net/) — Conversations endpoint, pagination metadata, custom fields API, photoUrl parameter
- [Rondo Club Activities API](~/Code/rondo/developer/src/content/docs/api/activities.md) — POST endpoint contract, activity types, required parameters
- Existing codebase patterns: `lib/freescout-client.js`, `lib/freescout-db.js`, `steps/prepare-freescout-customers.js`, `steps/submit-freescout-sync.js`

### Secondary (MEDIUM confidence)
- [CRM Integration Guide 2026 - Shopify](https://www.shopify.com/blog/crm-integration) — Industry patterns for CRM/helpdesk sync
- [Helpdesk Integration Best Practices - Deskpro](https://www.deskpro.com/product/crm) — Custom field sync standards
- [Laravel Timezone Handling](https://ggomez.dev/blog/best-practices-for-storing-timestamps-in-laravel) — UTC storage, timezone conversion patterns
- [ACF WP REST API Integration](https://www.advancedcustomfields.com/resources/wp-rest-api-integration/) — WordPress media API patterns

### Tertiary (LOW confidence)
- [FreeScout API Issues (GitHub)](https://github.com/freescout-help-desk/freescout/issues/2103) — Known API quirks (rate limits not documented, self-hosted variations)
- Project memory: Parent/member duplicate bug (hash-based change detection critical), SQLite migration corruption (avoid concurrent access), WordPress PUT requirements (first_name/last_name always required)

---
*Research completed: 2026-02-12*
*Ready for roadmap: yes*
