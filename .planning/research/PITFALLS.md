# Domain Pitfalls: FreeScout Email Activities, Photo Sync, and Custom Field Mapping

**Domain:** FreeScout integration enhancement for Rondo Sync
**Researched:** 2026-02-12
**Confidence:** MEDIUM (FreeScout API docs verified, Laravel timezone patterns established, existing codebase patterns analyzed)

## Critical Pitfalls

These mistakes cause data corruption, duplicate entries, or require full rewrites.

### Pitfall 1: Photo Upload Without Hash-Based Change Detection

**What goes wrong:** Re-uploading unchanged photos on every sync creates unnecessary API calls, wastes bandwidth, and risks hitting WordPress media library limits. Without hash comparison, photo sync becomes exponentially slower over time.

**Why it happens:** Existing FreeScout customer sync uses hash-based change detection (`source_hash` vs `last_synced_hash` in `freescout-db.js`). Photo sync in `upload-photos-to-rondo-club.js` uses state tracking but lacks content hashing. Developers assume FreeScout photo sync should follow the same pattern, forgetting to add hash storage for photos.

**Consequences:**
- 1000+ member sync re-uploads all photos daily (4x daily on people sync schedule)
- WordPress media library bloats with duplicate attachments
- Sync time increases from minutes to hours
- API rate limits may trigger failures mid-sync
- Photo state becomes unreliable (uploaded but hash not stored = re-upload next run)

**Prevention:**
1. **Extend `freescout_customers` table** with photo hash columns:
   ```sql
   ALTER TABLE freescout_customers ADD COLUMN photo_hash TEXT;
   ALTER TABLE freescout_customers ADD COLUMN photo_synced_at TEXT;
   ALTER TABLE freescout_customers ADD COLUMN photo_synced_hash TEXT;
   ```
2. **Hash photo files** using existing `computeHash()` from `lib/utils.js`:
   ```javascript
   const photoBuffer = await fs.readFile(photoPath);
   const photoHash = computeHash(photoBuffer);
   ```
3. **Skip upload if `photo_synced_hash === photo_hash`** (unchanged photo)
4. **Update `photo_synced_hash` only after successful FreeScout API confirmation**
5. **Use retry logic** from existing `freescoutRequestWithRetry` for 5xx errors

**Detection:**
- Photo sync time increases linearly with member count
- FreeScout storage grows continuously despite no photo changes
- API error logs show timeouts during photo upload phase
- Database query: `SELECT COUNT(*) FROM freescout_customers WHERE photo_hash IS NOT NULL AND photo_synced_hash IS NULL` (should be 0 after successful sync)

---

### Pitfall 2: FreeScout Conversation Pagination Without Total Count Verification

**What goes wrong:** FreeScout API paginates conversations (default 50/page, max unknown). Fetching page 1 only syncs recent 50 emails per customer. Older conversations never appear in Rondo Club. Customers with 100+ emails lose 50+ activities.

**Why it happens:** Developers copy single-page patterns from customer sync (`/api/customers` likely returns all via `_embedded.customers`). FreeScout docs show `page` and `pageSize` params exist but don't emphasize multi-page iteration requirement. First test with low-email-volume customer succeeds (< 50 conversations), hiding the bug.

**Consequences:**
- Partial conversation history synced (only most recent 50 per customer)
- Activity timeline shows gaps for high-volume support users
- No error thrown (API returns success with partial data)
- Silent data loss discovered weeks later when user reports "missing emails"
- Re-syncing requires tracking which conversations already synced (complex state management)

**Prevention:**
1. **Always check pagination metadata** in API response:
   ```javascript
   const response = await freescoutRequest(`/api/conversations?customerEmail=${email}`, 'GET');
   const page = response.body.page; // { size: 50, totalElements: 237, totalPages: 5, number: 1 }
   if (page.totalPages > 1) {
     // Fetch remaining pages
   }
   ```
2. **Implement page iteration loop** similar to existing pagination patterns:
   ```javascript
   let allConversations = [];
   for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
     const resp = await freescoutRequest(
       `/api/conversations?customerEmail=${email}&page=${pageNum}`,
       'GET'
     );
     allConversations.push(...resp.body._embedded.conversations);
     await sleep(200); // Rate limiting between pages
   }
   ```
3. **Log total vs fetched counts** for verification:
   ```javascript
   logger.verbose(`Fetched ${allConversations.length} of ${page.totalElements} conversations`);
   if (allConversations.length !== page.totalElements) {
     logger.error(`Conversation count mismatch for ${email}`);
   }
   ```
4. **Store last sync cursor** in `freescout_customers` to enable incremental sync:
   ```sql
   ALTER TABLE freescout_customers ADD COLUMN last_conversation_sync_at TEXT;
   ```
5. **Use `updatedAt` filter** to fetch only new/updated conversations after initial full sync

**Detection:**
- Customers with high email volume show fewer activities than expected
- `SELECT freescout_id, COUNT(*) FROM rondo_club_activities GROUP BY freescout_id HAVING COUNT(*) = 50` (suspicious exact-50 counts)
- Compare conversation count in FreeScout UI vs Rondo Club activity count
- Warning sign: first test customer has < 50 emails and sync "works perfectly"

---

### Pitfall 3: RelationEnd Custom Field Date Format Mismatch

**What goes wrong:** FreeScout custom field ID 9 expects `YYYY-mm-dd` format (per API docs). Rondo Club ACF date field may return `d/m/Y` or ISO 8601 timestamp. Wrong format rejected silently or stored as string "Invalid date", breaking FreeScout UI date picker and filtering.

**Why it happens:** WordPress ACF date fields return formatted strings (format depends on field settings). FreeScout API silently accepts malformed dates as strings. No immediate error during sync. FreeScout UI shows blank date or garbled text in custom field 9.

**Consequences:**
- RelationEnd dates invisible in FreeScout customer view
- FreeScout searches by "membership end date" return 0 results (malformed dates don't match)
- Silent data corruption (stored as string, not date type)
- Requires manual FreeScout database fix: `UPDATE customer_fields SET value = DATE_FORMAT(STR_TO_DATE(value, '%d/%m/%Y'), '%Y-%m-%d') WHERE field_id = 9`
- Customer support can't filter by upcoming expirations

**Prevention:**
1. **Normalize date format before API submission** using existing patterns from Sportlink sync:
   ```javascript
   function normalizeRelationEndDate(acfDateValue) {
     if (!acfDateValue) return null;

     // ACF returns YYYYMMDD when return format is YYYYMMDD
     if (/^\d{8}$/.test(acfDateValue)) {
       return `${acfDateValue.substr(0,4)}-${acfDateValue.substr(4,2)}-${acfDateValue.substr(6,2)}`;
     }

     // ISO 8601 timestamp (2026-02-12T00:00:00Z)
     if (acfDateValue.includes('T')) {
       return acfDateValue.split('T')[0]; // Extract YYYY-MM-DD
     }

     // Already YYYY-MM-DD
     if (/^\d{4}-\d{2}-\d{2}$/.test(acfDateValue)) {
       return acfDateValue;
     }

     logger.error(`Unknown RelationEnd date format: ${acfDateValue}`);
     return null;
   }
   ```
2. **Validate before sending** to FreeScout:
   ```javascript
   const relationEnd = normalizeRelationEndDate(rondoClubData.relation_end);
   if (relationEnd && !/^\d{4}-\d{2}-\d{2}$/.test(relationEnd)) {
     throw new Error(`Invalid date format for field 9: ${relationEnd}`);
   }
   ```
3. **Add field ID 9 to custom fields payload** in `buildCustomFieldsPayload()`:
   ```javascript
   { id: fieldIds.relation_end, value: customFields.relation_end || '' }
   ```
4. **Add env var** for configurability:
   ```bash
   FREESCOUT_FIELD_RELATION_END=9  # Default
   ```
5. **Test with edge cases:** null, empty string, "0000-00-00", future dates, past dates

**Detection:**
- FreeScout UI shows blank or "Invalid date" in custom field 9
- Database query: `SELECT value FROM customer_fields WHERE field_id = 9 AND value NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`
- Rondo Club has populated `relation_end` but FreeScout shows empty
- Manual FreeScout customer inspection after first test sync

---

### Pitfall 4: WordPress Activity Timeline Relationship Without Orphan Cleanup

**What goes wrong:** FreeScout conversations deleted (customer left club, GDPR request) but activity posts remain in WordPress, pointing to non-existent FreeScout conversation IDs. ACF relationship field breaks, showing "Post not found" errors. Activity timeline shows orphaned entries.

**Why it happens:** Bidirectional sync assumption—developers sync FreeScout → Rondo Club but forget delete propagation. WordPress has no foreign key constraints. ACF relationship fields store post IDs as strings in post meta, no referential integrity. Existing `deleteOrphanCustomers()` in `submit-freescout-sync.js` handles customer deletion but doesn't cascade to activities.

**Consequences:**
- Orphaned activity posts accumulate (never cleaned up)
- ACF relationship queries include deleted FreeScout refs (performance degrades)
- User clicks activity → 404 or "Access denied"
- WordPress database bloats with dead post meta rows
- Manual cleanup required: `wp post delete $(wp post list --post_type=activity --format=ids --meta_key=freescout_conversation_id --meta_value=DELETED_ID)`

**Prevention:**
1. **Track conversation → activity post mapping** in `freescout-db.js`:
   ```sql
   CREATE TABLE IF NOT EXISTS freescout_conversations (
     id INTEGER PRIMARY KEY,
     conversation_id INTEGER NOT NULL UNIQUE,
     customer_knvb_id TEXT NOT NULL,
     rondo_club_activity_id INTEGER,
     last_synced_at TEXT,
     FOREIGN KEY (customer_knvb_id) REFERENCES freescout_customers(knvb_id) ON DELETE CASCADE
   );
   ```
2. **Delete activity posts when customer deleted**:
   ```javascript
   async function deleteCustomerActivities(knvbId, db, options) {
     const conversations = db.prepare(
       'SELECT rondo_club_activity_id FROM freescout_conversations WHERE customer_knvb_id = ?'
     ).all(knvbId);

     for (const conv of conversations) {
       if (conv.rondo_club_activity_id) {
         await rondoClubRequest(`/wp-json/wp/v2/activity/${conv.rondo_club_activity_id}`, 'DELETE');
       }
     }

     db.prepare('DELETE FROM freescout_conversations WHERE customer_knvb_id = ?').run(knvbId);
   }
   ```
3. **Add cleanup step** to `deleteOrphanCustomers()` in `submit-freescout-sync.js`
4. **Weekly orphan scan** (cron job):
   ```javascript
   // tools/cleanup-orphan-activities.js
   // Check for activity posts with freescout_conversation_id not in freescout_conversations table
   ```
5. **Log orphan counts** in dashboard for monitoring

**Detection:**
- `SELECT COUNT(*) FROM freescout_conversations WHERE rondo_club_activity_id IS NOT NULL` > actual activity post count
- WordPress: `SELECT COUNT(*) FROM wp_postmeta WHERE meta_key = 'freescout_conversation_id' AND post_id NOT IN (SELECT ID FROM wp_posts WHERE post_status != 'trash')`
- User reports "missing conversation" errors
- ACF relationship field shows "(no title)" entries

---

### Pitfall 5: FreeScout photoUrl vs Photo Blob Upload API Ambiguity

**What goes wrong:** FreeScout API docs show `photoUrl` parameter for customer create/update, suggesting URL-based photo sync. But self-hosted FreeScout instances may not fetch remote URLs (security, firewall, or module not installed). Photos don't appear despite sync reporting success.

**Why it happens:** FreeScout is open-source Laravel app with varying module installations. `photoUrl` works on SaaS/hosted instances with background job processors. Self-hosted installs may lack this or have `allow_url_fopen` disabled in PHP. API accepts `photoUrl` (200 OK) but doesn't actually fetch it. No error returned.

**Consequences:**
- Photos uploaded successfully to Rondo Club but never appear in FreeScout
- Silent failure (API returns 200, stores URL string, never downloads)
- Debugging requires FreeScout server logs (unavailable to sync script)
- Assumption that sync "works" because no errors logged
- Alternative: Requires multipart/form-data upload (blob), not URL string

**Prevention:**
1. **Test both methods** during initial implementation:
   - Method A: `photoUrl` string (simple, may not work on self-hosted)
   - Method B: Multipart form-data upload (complex, reliable)
2. **Check FreeScout version and modules** via `/api/users/me` response metadata
3. **Verify photo appears** after test sync (automated check):
   ```javascript
   const customer = await freescoutRequest(`/api/customers/${freescoutId}`, 'GET');
   if (customer.body.photoUrl !== expectedPhotoUrl) {
     logger.error(`Photo URL not set for customer ${freescoutId}`);
   }
   // Better: Check if photoUrl returns 200 OK with image MIME type
   const photoResp = await fetch(customer.body.photoUrl);
   if (!photoResp.ok || !photoResp.headers.get('content-type').startsWith('image/')) {
     logger.error(`Photo not accessible for customer ${freescoutId}`);
   }
   ```
4. **Implement multipart upload fallback** if `photoUrl` method fails verification:
   ```javascript
   async function uploadPhotoToFreeScout(freescoutId, photoPath, options) {
     // Try Method A: photoUrl
     const photoUrl = await uploadPhotoToPublicUrl(photoPath); // S3, CDN, etc.
     const urlResult = await freescoutRequest(`/api/customers/${freescoutId}`, 'PUT', { photoUrl });

     // Verify photo accessible
     await sleep(2000); // Wait for FreeScout to fetch
     const customer = await freescoutRequest(`/api/customers/${freescoutId}`, 'GET');
     if (customer.body.photoUrl && await verifyPhotoAccessible(customer.body.photoUrl)) {
       return { success: true, method: 'photoUrl' };
     }

     // Fallback to Method B: multipart
     logger.verbose('photoUrl method failed, using multipart upload');
     return await uploadPhotoMultipart(freescoutId, photoPath, options);
   }
   ```
5. **Document which method used** in `.env` configuration:
   ```bash
   FREESCOUT_PHOTO_METHOD=photoUrl  # or "multipart"
   ```

**Detection:**
- Sync logs show photo uploads successful but FreeScout UI shows default avatar
- `customer.body.photoType === null` after sync
- Manual FreeScout customer check shows no photo
- FreeScout server logs (if accessible): "Failed to fetch photoUrl: [error]"

**Mitigation if discovered late:**
- Re-sync all photos using multipart method
- Mark all `photo_synced_hash` as NULL to force re-upload

---

## Moderate Pitfalls

### Pitfall 6: FreeScout Conversation Threads Embedded vs Separate Requests

**What goes wrong:** Fetching conversations without `?embed=threads` returns conversation metadata only. Requires second API call per conversation to get thread content (email body, timestamps, etc.). 1000 conversations = 1001 API calls (1 list + 1000 individual).

**Why it happens:** FreeScout API docs mention `embed` parameter but don't emphasize performance impact. Developers test with 1-2 conversations (fast), miss N+1 query problem at scale.

**Prevention:**
- Use `?embed=threads` on `/api/conversations/{id}` requests
- Or fetch all threads in batch after getting conversation list
- Log "Fetching threads for 237 conversations" (transparency)
- Rate limit: 200ms sleep between thread requests if not using embed

### Pitfall 7: WordPress Activity Custom Post Type Slug Collision

**What goes wrong:** Creating custom post type `activity` conflicts with WordPress core or popular plugins (BuddyPress, WooCommerce Activity Log, etc.). Post type registration fails silently, sync writes to wrong CPT or throws 404.

**Why it happens:** `activity` is generic term, high collision risk. WordPress doesn't enforce namespacing.

**Prevention:**
- Use prefixed slug: `rondo_activity` or `freescout_activity`
- Check `post_type_exists('activity')` before registering
- Document in Rondo Club's `functions.php` or CPT registration code
- Test on fresh WordPress install + common plugin suite (WooCommerce, BuddyPress)

### Pitfall 8: Conversation Timestamps in Wrong Timezone

**What goes wrong:** FreeScout returns timestamps in UTC (ISO 8601: `2026-02-12T14:30:00Z`). WordPress stores in local timezone (Europe/Amsterdam). Activity timeline shows wrong times (off by +1 or +2 hours depending on DST).

**Why it happens:** Laravel apps (FreeScout) default to UTC storage. WordPress uses `get_option('timezone_string')` or GMT offset. Developers forget timezone conversion.

**Prevention:**
- Convert FreeScout timestamps to WordPress timezone before saving:
  ```javascript
  const moment = require('moment-timezone');
  const wpTimezone = 'Europe/Amsterdam'; // From Rondo Club settings
  const wpTime = moment.utc(freescoutTimestamp).tz(wpTimezone).format('YYYY-MM-DD HH:mm:ss');
  ```
- Or store in UTC and convert on display (WordPress `get_post_time()` handles this if stored correctly)
- Test during DST transition dates (March, October)

### Pitfall 9: Activity Post Creation Without Duplicate Prevention

**What goes wrong:** Re-syncing conversations creates duplicate activity posts. Same FreeScout conversation ID → 2+ WordPress posts. Timeline shows duplicates.

**Why it happens:** No unique constraint. Sync script creates post, stores `freescout_conversation_id` in ACF, but next run doesn't check if post already exists.

**Prevention:**
- Check before create:
  ```javascript
  const existing = await rondoClubRequest(
    `/wp-json/wp/v2/activity?meta_key=freescout_conversation_id&meta_value=${conversationId}`,
    'GET'
  );
  if (existing.body.length > 0) {
    // Update existing post
  } else {
    // Create new post
  }
  ```
- Or use `freescout_conversations` tracking table (Pitfall 4 solution)
- Add unique index in WordPress: `ALTER TABLE wp_postmeta ADD UNIQUE KEY unique_freescout_conversation (meta_key, meta_value) WHERE meta_key = 'freescout_conversation_id'` (requires plugin or custom SQL)

### Pitfall 10: FreeScout Custom Field ID Hardcoding Across Environments

**What goes wrong:** Custom field IDs differ between production and demo FreeScout instances (field 9 = RelationEnd in prod, but field 12 in demo). Hardcoded ID 9 writes to wrong field in demo, corrupting data.

**Why it happens:** FreeScout assigns IDs sequentially on field creation. Demo instance created fields in different order (testing, module installs). Custom field IDs not portable.

**Prevention:**
- Use environment variables (already implemented in `getCustomFieldIds()`):
  ```bash
  # .env.production
  FREESCOUT_FIELD_RELATION_END=9

  # .env.demo
  FREESCOUT_FIELD_RELATION_END=12
  ```
- Verify field IDs on deploy: `node tools/verify-freescout-fields.js --env=demo`
- Document field mapping in `CLAUDE.md` or deploy checklist
- Log field IDs on first sync: "Using RelationEnd field ID: 9"

---

## Minor Pitfalls

### Pitfall 11: Photo File Extension Ambiguity After FreeScout Upload

**What goes wrong:** Upload photo as `12345.jpg` but FreeScout returns `photoUrl` pointing to `.png` (re-encoded). Next sync detects hash change (file extension differs), re-uploads unnecessarily.

**Why it happens:** FreeScout may re-encode photos for optimization. Hash comparison includes file extension in path.

**Prevention:**
- Hash file content, not filename
- Store `photo_hash` as content hash, not path hash
- Extension-agnostic comparison

### Pitfall 12: Activity Post Title Truncation for Long Email Subjects

**What goes wrong:** FreeScout conversation subject = 300 chars. WordPress post title field = 255 chars max (MySQL TEXT). Title truncated mid-word, activity timeline shows "Re: Important update about member..." (incomplete).

**Why it happens:** No validation before `wp_insert_post()`. WordPress silently truncates.

**Prevention:**
- Truncate with ellipsis:
  ```javascript
  const title = conversation.subject.length > 252
    ? conversation.subject.substr(0, 252) + '...'
    : conversation.subject;
  ```
- Store full subject in ACF field if needed for search

### Pitfall 13: FreeScout API 5xx Retry Logic Missing

**What goes wrong:** Transient FreeScout server errors (502, 503, 504) fail sync permanently. Activities not synced. Next run re-attempts but some conversations missed due to timestamp cursor.

**Why it happens:** Existing `freescoutRequestWithRetry()` has retry logic but may not be used for conversation sync. One 503 error = entire batch fails.

**Prevention:**
- Use `freescoutRequestWithRetry()` for all FreeScout API calls
- Already implemented in `lib/freescout-client.js` (exponential backoff: 1s, 2s, 4s)
- Ensure conversation sync uses this wrapper

### Pitfall 14: WordPress API Rate Limiting on Bulk Activity Creation

**What goes wrong:** Creating 500 activity posts in rapid succession triggers WordPress rate limiting (if configured) or overloads server. Some posts return 429 or 500. Sync fails halfway.

**Why it happens:** Existing photo upload has `sleep(100)` between requests. Activity creation may not have rate limiting.

**Prevention:**
- Add `await sleep(50)` between activity post creations
- Batch creates: 50 posts per request (if WordPress supports batch endpoint)
- Monitor WordPress error logs during high-volume sync

### Pitfall 15: Empty Conversation Thread Content Breaks Activity Post

**What goes wrong:** FreeScout conversation exists but all threads deleted (admin cleanup). `threads` array empty. Activity post created with blank content. WordPress requires non-empty post_content for some use cases.

**Why it happens:** No validation of thread array length.

**Prevention:**
- Check `conversation.threads.length > 0` before creating activity post
- Log skip: "Skipping conversation {id}: no threads"
- Or create post with placeholder: "Conversation deleted by administrator"

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| **Photo sync to FreeScout** | Pitfall 1 (no hash detection), Pitfall 5 (photoUrl vs multipart), Pitfall 11 (extension change) | Test both upload methods, implement content hashing, verify photos in FreeScout UI after test sync |
| **Conversation sync to activities** | Pitfall 2 (pagination), Pitfall 4 (orphans), Pitfall 8 (timezones), Pitfall 9 (duplicates) | Implement page iteration, tracking table, timezone conversion, duplicate check before create |
| **RelationEnd field mapping** | Pitfall 3 (date format), Pitfall 10 (field ID mismatch) | Normalize to YYYY-MM-DD, use env vars, verify on deploy |
| **Incremental sync optimization** | Pagination, rate limiting, 5xx retries | Use `updatedAt` filters, `freescoutRequestWithRetry`, log total vs fetched counts |
| **Production deployment** | Multi-DB pitfall (from memory: `rondo-sync.sqlite` vs `stadion-sync.sqlite`), concurrent access | Never run locally, verify DB path in code before deploy, check systemd service conflicts |

---

## Sources

### HIGH Confidence (Official Documentation)
- [FreeScout API Reference](https://api-docs.freescout.net/) — Endpoints, pagination, custom fields, photoUrl parameter
- [FreeScout Customer Avatars Module](https://freescout.shop/downloads/freescout-module-avatars/) — Photo handling methods
- [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/) — Custom post types, relationship fields
- [ACF Performance Best Practices](https://www.advancedcustomfields.com/resources/improving-acf-performance/) — Local JSON, query optimization

### MEDIUM Confidence (Community Patterns)
- [Laravel Timezone Handling](https://ggomez.dev/blog/best-practices-for-storing-timestamps-in-laravel) — UTC storage, timezone conversion patterns
- [FreeScout API Issues (GitHub)](https://github.com/freescout-help-desk/freescout/issues/2103) — Known API quirks and limitations
- [Duplicate Image Detection with Hashing](https://benhoyt.com/writings/duplicate-image-detection/) — Perceptual hashing for change detection
- [ACF Relationship Field Guide](https://www.advancedcustomfields.com/blog/wordpress-custom-post-type-relationships/) — Relationship patterns, performance

### LOW Confidence (Existing Codebase Patterns)
- `lib/freescout-db.js` — Hash-based sync pattern (lines 8-14, 109-134)
- `lib/freescout-client.js` — Retry logic implementation (lines 109-134)
- `steps/submit-freescout-sync.js` — Duplicate prevention, orphan cleanup (lines 216-273, 276-319)
- `lib/photo-utils.js` — Photo download, MIME type handling (lines 44-88)
- Project memory: Parent/member duplicate bug, SQLite migration corruption, WordPress PUT requirements

---

## Research Gaps

**Could not verify:**
1. **FreeScout exact rate limits** — No official documentation found. Self-hosted may have no limits or vary by hosting. Assume conservative 200ms between requests.
2. **FreeScout multipart photo upload endpoint** — API docs only show `photoUrl` string method. May require reverse-engineering or support ticket.
3. **WordPress activity CPT already exists** — Need to inspect Rondo Club codebase to confirm post type slug and ACF field schema.
4. **FreeScout conversation `updatedAt` reliability** — Does it update when threads added? Need testing.
5. **Production FreeScout version and modules** — Self-hosted quirks depend on version and installed modules (API & Webhooks module confirmed required, but version unknown).

**Flagged for phase-specific research:**
- Phase: Conversation sync implementation → Verify FreeScout conversation `updatedAt` behavior with test data
- Phase: Photo upload → Test both `photoUrl` and multipart methods on actual FreeScout instance
- Phase: Production deploy → Verify custom field IDs match between demo and production
