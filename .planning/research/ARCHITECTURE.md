# Architecture Patterns: FreeScout Integration Enhancements

**Domain:** FreeScout ↔ Rondo Club Integration
**Researched:** 2026-02-12

## Executive Summary

This architecture document defines how three new features integrate into the existing rondo-sync architecture: (1) FreeScout email conversations as Rondo Club activities, (2) photo sync from Rondo Club to FreeScout customer avatars, and (3) RelationEnd field mapping to FreeScout custom field. All features follow established patterns while adding minimal new components.

**Key finding:** All three features fit cleanly into existing pipeline steps with minimal new infrastructure. The conversation sync requires the most new code (new step + Rondo Club API endpoint), while photo and RelationEnd are minor enhancements to existing steps.

## Feature 1: FreeScout Conversations → Rondo Club Activities

### Data Flow

```
FreeScout conversations API → download step → SQLite tracking → submit step → Rondo Club REST API → Activities display
```

### New Components

| Component | Type | Purpose |
|-----------|------|---------|
| `steps/download-conversations-from-freescout.js` | Download step | Fetch conversations by customer from FreeScout API |
| `lib/freescout-db.js` (enhancement) | DB layer | Add conversation tracking table + functions |
| `steps/sync-conversations-to-rondo-club.js` | Submit step | POST conversations as activities to Rondo Club |
| Rondo Club API: `/rondo/v1/people/{id}/activities` | WordPress endpoint | Accept activity submissions (NOT in rondo-sync, but required) |

### Modified Components

| Component | Modification | Rationale |
|-----------|--------------|-----------|
| `pipelines/sync-freescout.js` | Add conversation sync step after ID sync | Logical ordering: customers first, then conversations |
| `lib/freescout-db.js` | New table: `freescout_conversations` | Track sync state with hash-based change detection |

### Architecture Pattern: Activity Submission

**Data structure for Rondo Club activities:**
```json
{
  "activity_type": "freescout_email",
  "activity_date": "2026-02-12T14:30:00Z",
  "activity_title": "Email: Subject from FreeScout",
  "activity_content": "Email thread content (last N messages)",
  "activity_meta": {
    "freescout_conversation_id": 123,
    "freescout_conversation_number": 456,
    "freescout_customer_id": 789,
    "freescout_url": "https://support.example.org/conversation/456"
  }
}
```

**Endpoint contract (Rondo Club side, not in rondo-sync):**
```
POST /wp-json/rondo/v1/people/{rondo_club_id}/activities
Authorization: Basic {credentials}
Content-Type: application/json

Body: {activity_type, activity_date, activity_title, activity_content, activity_meta}
Response: {success: true, activity_id: 123}
```

### Hash-Based Change Detection

Following existing pattern in `freescout-db.js`:

```javascript
function computeConversationHash(conversationId, data) {
  const payload = stableStringify({
    conversation_id: conversationId,
    data: {
      subject: data.subject,
      status: data.status,
      threads: data.threads.map(t => ({
        id: t.id,
        body: t.body,
        created_at: t.createdAt
      }))
    }
  });
  return computeHash(payload);
}
```

### Conversations Table Schema

```sql
CREATE TABLE IF NOT EXISTS freescout_conversations (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  knvb_id TEXT NOT NULL,
  rondo_club_id INTEGER,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  last_synced_at TEXT,
  last_synced_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freescout_conversations_customer
  ON freescout_conversations (customer_id);

CREATE INDEX IF NOT EXISTS idx_freescout_conversations_sync
  ON freescout_conversations (source_hash, last_synced_hash);
```

### API Integration Points

**FreeScout API (download):**
```javascript
// Get all conversations for a customer
const response = await freescoutRequest(
  `/api/conversations?customerId=${customerId}&embed=threads`,
  'GET',
  null,
  { logger, verbose }
);

const conversations = response.body._embedded?.conversations || [];
```

**Rondo Club API (submit):**
```javascript
// Submit activity to person record
await rondoClubRequest(
  `/rondo/v1/people/${rondoClubId}/activities`,
  'POST',
  {
    activity_type: 'freescout_email',
    activity_date: conversation.updatedAt,
    activity_title: `Email: ${conversation.subject}`,
    activity_content: formatThreadsAsContent(conversation.threads),
    activity_meta: {
      freescout_conversation_id: conversation.id,
      freescout_conversation_number: conversation.number,
      freescout_customer_id: conversation.customer.id,
      freescout_url: `${FREESCOUT_URL}/conversation/${conversation.number}`
    }
  },
  { logger, verbose }
);
```

### Build Order

1. **Phase 1: Database layer** — Add conversation tracking table and functions to `lib/freescout-db.js`
2. **Phase 2: Download step** — Implement `steps/download-conversations-from-freescout.js`
3. **Phase 3: Submit step** — Implement `steps/sync-conversations-to-rondo-club.js`
4. **Phase 4: Pipeline integration** — Wire steps into `pipelines/sync-freescout.js`
5. **Phase 5: Testing** — Verify with real FreeScout data (requires Rondo Club API endpoint first)

**Critical dependency:** Rondo Club must implement `/rondo/v1/people/{id}/activities` endpoint BEFORE Phase 5.

---

## Feature 2: Rondo Club Photos → FreeScout Customer Avatars

### Data Flow

```
Rondo Club featured image → prepare step → submit step → FreeScout customer photoUrl field
```

### Modified Components Only (No New Components)

| Component | Modification | Rationale |
|-----------|--------------|-----------|
| `steps/prepare-freescout-customers.js` | Fetch photo URL from Rondo Club WordPress media API | Already has `getPhotoUrl()` stub returning null |
| `steps/submit-freescout-sync.js` | Include `photoUrl` in customer payload | FreeScout API already supports this field |

### Architecture Pattern: Photo URL Fetch

**Current code (lines 61-73 in prepare-freescout-customers.js):**
```javascript
function getPhotoUrl(member) {
  // Only include photo URL if photo_state is 'synced'
  if (member.photo_state !== 'synced') {
    return null;
  }

  // TODO: Construct Rondo Club photo URL
  // The photo is attached to the person post in WordPress
  return null; // Currently returns null
}
```

**Enhanced implementation:**
```javascript
async function getPhotoUrl(member, options) {
  if (member.photo_state !== 'synced') {
    return null;
  }

  if (!member.rondo_club_id) {
    return null;
  }

  try {
    // Fetch person post to get featured_media ID
    const personResponse = await rondoClubRequest(
      `wp/v2/people/${member.rondo_club_id}`,
      'GET',
      null,
      options
    );

    const featuredMediaId = personResponse.body.featured_media;
    if (!featuredMediaId) {
      return null;
    }

    // Fetch media object to get source_url
    const mediaResponse = await rondoClubRequest(
      `wp/v2/media/${featuredMediaId}`,
      'GET',
      null,
      options
    );

    return mediaResponse.body.source_url || null;
  } catch (error) {
    // Log error but don't fail preparation
    options.logger?.verbose(`Photo URL fetch failed for ${member.knvb_id}: ${error.message}`);
    return null;
  }
}
```

**Optimization:** Batch fetch all featured media IDs in single pass, then fetch media objects for those that exist. This reduces N+1 queries.

**Alternative approach (simpler, no API calls):**
If Rondo Club exposes photo URL in person ACF field, read directly from `rondo_club_members.data_json`:

```javascript
function getPhotoUrl(member) {
  if (member.photo_state !== 'synced') {
    return null;
  }

  const data = member.data || {};
  const acf = data.acf || {};

  // Assuming Rondo Club stores photo URL in ACF field 'photo_url'
  return acf.photo_url || null;
}
```

**Recommended:** Use ACF field approach if Rondo Club can provide this. Otherwise, use WordPress media API.

### Submit Step Enhancement

**Current payload (submit-freescout-sync.js lines 116-119):**
```javascript
const payload = {
  firstName: customer.data.firstName,
  lastName: customer.data.lastName,
  emails: [{ value: customer.email, type: 'home' }]
};
```

**Enhanced payload:**
```javascript
const payload = {
  firstName: customer.data.firstName,
  lastName: customer.data.lastName,
  emails: [{ value: customer.email, type: 'home' }]
};

// Add photo URL if available
if (customer.data.photoUrl) {
  payload.photoUrl = customer.data.photoUrl;
}
```

### Build Order

1. **Phase 1: Decide approach** — ACF field vs WordPress media API (coordinate with Rondo Club)
2. **Phase 2: Modify prepare step** — Implement `getPhotoUrl()` based on chosen approach
3. **Phase 3: Modify submit step** — Add `photoUrl` to customer payload
4. **Phase 4: Testing** — Verify photos appear in FreeScout customer profiles

**No new files required.** Pure enhancement to existing steps.

---

## Feature 3: Sportlink RelationEnd → FreeScout Custom Field

### Data Flow

```
Sportlink RelationEnd field → prepare step → submit step → FreeScout custom field ID 9
```

### Modified Components Only (No New Components)

| Component | Modification | Rationale |
|-----------|--------------|-----------|
| `steps/prepare-freescout-customers.js` | Extract RelationEnd from member data | Already extracts other Sportlink fields |
| `steps/submit-freescout-sync.js` | Add field ID 9 to custom fields payload | Already sends custom fields array |

### Architecture Pattern: Custom Field Mapping

**Current custom field IDs (submit-freescout-sync.js lines 18-26):**
```javascript
function getCustomFieldIds() {
  return {
    union_teams: parseInt(process.env.FREESCOUT_FIELD_UNION_TEAMS || '1', 10),
    public_person_id: parseInt(process.env.FREESCOUT_FIELD_PUBLIC_PERSON_ID || '4', 10),
    member_since: parseInt(process.env.FREESCOUT_FIELD_MEMBER_SINCE || '5', 10),
    nikki_saldo: parseInt(process.env.FREESCOUT_FIELD_NIKKI_SALDO || '7', 10),
    nikki_status: parseInt(process.env.FREESCOUT_FIELD_NIKKI_STATUS || '8', 10)
  };
}
```

**Enhanced with RelationEnd:**
```javascript
function getCustomFieldIds() {
  return {
    union_teams: parseInt(process.env.FREESCOUT_FIELD_UNION_TEAMS || '1', 10),
    public_person_id: parseInt(process.env.FREESCOUT_FIELD_PUBLIC_PERSON_ID || '4', 10),
    member_since: parseInt(process.env.FREESCOUT_FIELD_MEMBER_SINCE || '5', 10),
    nikki_saldo: parseInt(process.env.FREESCOUT_FIELD_NIKKI_SALDO || '7', 10),
    nikki_status: parseInt(process.env.FREESCOUT_FIELD_NIKKI_STATUS || '8', 10),
    relation_end: parseInt(process.env.FREESCOUT_FIELD_RELATION_END || '9', 10)
  };
}
```

**Current custom fields payload (submit-freescout-sync.js lines 33-42):**
```javascript
function buildCustomFieldsPayload(customFields) {
  const fieldIds = getCustomFieldIds();
  return [
    { id: fieldIds.union_teams, value: customFields.union_teams || '' },
    { id: fieldIds.public_person_id, value: customFields.public_person_id || '' },
    { id: fieldIds.member_since, value: customFields.member_since || '' },
    { id: fieldIds.nikki_saldo, value: customFields.nikki_saldo !== null ? String(customFields.nikki_saldo) : '' },
    { id: fieldIds.nikki_status, value: customFields.nikki_status || '' }
  ];
}
```

**Enhanced with RelationEnd:**
```javascript
function buildCustomFieldsPayload(customFields) {
  const fieldIds = getCustomFieldIds();
  return [
    { id: fieldIds.union_teams, value: customFields.union_teams || '' },
    { id: fieldIds.public_person_id, value: customFields.public_person_id || '' },
    { id: fieldIds.member_since, value: customFields.member_since || '' },
    { id: fieldIds.nikki_saldo, value: customFields.nikki_saldo !== null ? String(customFields.nikki_saldo) : '' },
    { id: fieldIds.nikki_status, value: customFields.nikki_status || '' },
    { id: fieldIds.relation_end, value: customFields.relation_end || '' }
  ];
}
```

### Data Extraction

**Location:** `steps/prepare-freescout-customers.js`, function `prepareCustomer()`

**Current member_since extraction (line 225):**
```javascript
customFields: {
  union_teams: unionTeams,
  public_person_id: member.knvb_id,
  member_since: acf['lid-sinds'] || null,
  nikki_saldo: nikkiData.saldo,
  nikki_status: nikkiData.status
}
```

**Enhanced with RelationEnd:**
```javascript
customFields: {
  union_teams: unionTeams,
  public_person_id: member.knvb_id,
  member_since: acf['lid-sinds'] || null,
  nikki_saldo: nikkiData.saldo,
  nikki_status: nikkiData.status,
  relation_end: acf['relation-end'] || null  // Assuming Rondo Club stores this in ACF
}
```

**Data source verification needed:** Where does RelationEnd live in the sync flow?

From code inspection (steps/prepare-rondo-club-members.js line 173):
```javascript
const relationEnd = (sportlinkMember.RelationEnd || '').trim() || null;
```

This suggests RelationEnd is available in Sportlink download data. Verify if it's synced to Rondo Club ACF fields.

**If NOT in Rondo Club ACF:** Read from `rondo_club_members.data_json` directly (it contains full Sportlink data).

**Implementation:**
```javascript
function prepareCustomer(member, freescoutDb, rondoClubDb, nikkiDb) {
  const data = member.data || {};
  const acf = data.acf || {};

  // Extract RelationEnd from ACF if available, otherwise from raw Sportlink data
  let relationEnd = acf['relation-end'] || null;

  // Fallback: Check raw Sportlink data if not in ACF
  if (!relationEnd && data.sportlink && data.sportlink.RelationEnd) {
    relationEnd = data.sportlink.RelationEnd;
  }

  // ... rest of function

  return {
    // ... existing fields
    customFields: {
      union_teams: unionTeams,
      public_person_id: member.knvb_id,
      member_since: acf['lid-sinds'] || null,
      nikki_saldo: nikkiData.saldo,
      nikki_status: nikkiData.status,
      relation_end: relationEnd
    }
  };
}
```

### Environment Variable

Add to `.env.example` and documentation:
```bash
FREESCOUT_FIELD_RELATION_END=9  # FreeScout custom field ID for "Lid tot"
```

### Build Order

1. **Phase 1: Verify data source** — Confirm where RelationEnd lives in `rondo_club_members.data_json`
2. **Phase 2: Modify prepare step** — Extract RelationEnd and add to customFields
3. **Phase 3: Modify submit step** — Add field ID 9 to custom fields payload
4. **Phase 4: Environment config** — Add `FREESCOUT_FIELD_RELATION_END=9` to `.env`
5. **Phase 5: Testing** — Verify RelationEnd appears in FreeScout customer profiles

**No new files required.** Pure enhancement to existing steps.

---

## Integration Summary

### Component Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│ pipelines/sync-freescout.js                                 │
│                                                              │
│  1. prepare-freescout-customers.js (MODIFIED)               │
│     - Extract photo URL (Feature 2)                         │
│     - Extract RelationEnd (Feature 3)                       │
│                                                              │
│  2. submit-freescout-sync.js (MODIFIED)                     │
│     - Send photoUrl field (Feature 2)                       │
│     - Send relation_end custom field (Feature 3)            │
│                                                              │
│  3. sync-freescout-ids-to-rondo-club.js (EXISTING)          │
│                                                              │
│  4. download-conversations-from-freescout.js (NEW)          │
│     - Fetch conversations by customer from FreeScout        │
│     - Track in freescout_conversations table                │
│                                                              │
│  5. sync-conversations-to-rondo-club.js (NEW)               │
│     - POST activities to Rondo Club                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ lib/freescout-db.js (MODIFIED)                              │
│                                                              │
│  - ADD: freescout_conversations table                       │
│  - ADD: computeConversationHash()                           │
│  - ADD: upsertConversations()                               │
│  - ADD: getConversationsNeedingSync()                       │
│  - ADD: updateConversationSyncState()                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ External Dependencies (Rondo Club WordPress)                │
│                                                              │
│  - POST /wp-json/rondo/v1/people/{id}/activities            │
│    (Required for Feature 1)                                 │
│                                                              │
│  - GET /wp-json/wp/v2/people/{id}                           │
│    (Existing, used for photo URL in Feature 2)              │
│                                                              │
│  - GET /wp-json/wp/v2/media/{id}                            │
│    (Existing, used for photo URL in Feature 2)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### File Impact Analysis

| File | Change Type | Feature | Lines Changed (est.) |
|------|-------------|---------|---------------------|
| `steps/prepare-freescout-customers.js` | Modified | 2, 3 | +30 |
| `steps/submit-freescout-sync.js` | Modified | 2, 3 | +10 |
| `lib/freescout-db.js` | Modified | 1 | +150 |
| `steps/download-conversations-from-freescout.js` | New | 1 | +200 |
| `steps/sync-conversations-to-rondo-club.js` | New | 1 | +180 |
| `pipelines/sync-freescout.js` | Modified | 1 | +40 |
| `.env.example` | Modified | 3 | +1 |

**Total:** 2 new files, 5 modified files, ~610 lines of new code.

### Risk Assessment

| Feature | Complexity | Risk | Mitigation |
|---------|-----------|------|------------|
| Conversations → Activities | Medium | Rondo Club API endpoint doesn't exist yet | Build steps 1-4 first, test with mock; coordinate with Rondo Club team |
| Photos → FreeScout | Low | WordPress media API N+1 queries | Use ACF field approach if available; otherwise batch fetch |
| RelationEnd → Custom Field | Low | Data location unclear | Verify in rondo_club_members.data_json first; fallback to multiple sources |

---

## Recommended Build Order (Cross-Feature)

**Phase 1: Low-hanging fruit (Features 2 & 3)**
1. Verify RelationEnd data location in `rondo_club_members.data_json`
2. Implement Feature 3 (RelationEnd field mapping)
3. Test Feature 3 with real data
4. Coordinate with Rondo Club team on photo URL approach (ACF vs media API)
5. Implement Feature 2 (photo sync)
6. Test Feature 2 with real data

**Phase 2: Activities integration (Feature 1)**
1. Coordinate with Rondo Club team on activities endpoint design
2. Add conversation tracking table to `lib/freescout-db.js`
3. Implement download step (`download-conversations-from-freescout.js`)
4. Implement submit step (`sync-conversations-to-rondo-club.js`)
5. Wire into pipeline (`sync-freescout.js`)
6. Test with mock Rondo Club endpoint
7. Test with real Rondo Club endpoint once available

**Rationale:** Features 2 and 3 are independent, low-risk enhancements that can ship immediately. Feature 1 requires cross-repo coordination and new infrastructure.

---

## Pipeline Execution Flow (After Integration)

```
sync-freescout.js execution:

1. prepare-freescout-customers.js
   ├─ Extract member data from rondo_club_members
   ├─ Fetch photo URLs (NEW - Feature 2)
   ├─ Extract RelationEnd (NEW - Feature 3)
   └─ Build customer objects with customFields

2. submit-freescout-sync.js
   ├─ Upsert customers to freescout_customers table
   ├─ Sync to FreeScout API (with photoUrl - NEW)
   ├─ Update custom fields (with relation_end - NEW)
   └─ Handle conflicts/errors

3. sync-freescout-ids-to-rondo-club.js
   └─ Write freescout_id back to Rondo Club ACF

4. download-conversations-from-freescout.js (NEW - Feature 1)
   ├─ For each tracked customer with freescout_id:
   │  └─ GET /api/conversations?customerId={id}&embed=threads
   ├─ Upsert to freescout_conversations table
   └─ Mark conversations needing sync (hash changed)

5. sync-conversations-to-rondo-club.js (NEW - Feature 1)
   ├─ For each conversation needing sync:
   │  ├─ Format as activity payload
   │  ├─ POST /rondo/v1/people/{id}/activities
   │  └─ Update sync state in freescout_conversations
   └─ Track errors
```

**Execution time impact:** +30-60 seconds (conversation download/sync for ~300 customers with ~10 conversations each).

---

## Data Storage Impact

### freescout-sync.sqlite Size Estimate

**Current:**
- `freescout_customers`: ~300 rows × ~2KB = 600KB

**After Feature 1:**
- `freescout_conversations`: ~300 customers × ~10 conversations × ~5KB = 15MB

**Total estimated:** ~16MB (manageable for SQLite).

**Retention policy recommendation:** Keep conversations for last 90 days only. Implement cleanup in download step:

```javascript
function cleanupOldConversations(db) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const stmt = db.prepare(`
    DELETE FROM freescout_conversations
    WHERE created_at < ?
  `);

  stmt.run(cutoffDate.toISOString());
}
```

---

## Testing Strategy

### Feature 1: Conversations → Activities

**Unit tests:**
- `computeConversationHash()` produces stable hashes
- `upsertConversations()` handles duplicates correctly
- `getConversationsNeedingSync()` returns only changed conversations
- Activity payload formatting includes all required fields

**Integration tests:**
- Download step fetches conversations from real FreeScout
- Submit step posts to mock Rondo Club endpoint
- Full pipeline with dry-run flag
- Full pipeline with real endpoints

### Feature 2: Photos → FreeScout

**Unit tests:**
- `getPhotoUrl()` returns null for non-synced photos
- `getPhotoUrl()` fetches URL from WordPress media API
- Customer payload includes photoUrl when available

**Integration tests:**
- Prepare step with real Rondo Club data
- Submit step with real FreeScout API
- Verify photos appear in FreeScout customer profiles

### Feature 3: RelationEnd → Custom Field

**Unit tests:**
- RelationEnd extracted from correct data source
- Custom field payload includes field ID 9
- Empty RelationEnd sends empty string (not null)

**Integration tests:**
- Prepare step with real member data
- Submit step with real FreeScout API
- Verify RelationEnd appears in FreeScout custom field

---

## Open Questions

1. **Rondo Club activities endpoint:** What is the exact API contract? What ACF fields store activities?
2. **Photo URL source:** Does Rondo Club expose photo URL in ACF field, or must we use WordPress media API?
3. **RelationEnd in Rondo Club:** Is this field synced to ACF, or only in raw Sportlink data?
4. **Conversation retention:** Should we keep all conversations, or implement 90-day retention?
5. **Activity deduplication:** How does Rondo Club handle duplicate activity submissions?
6. **Photo dimensions:** Does FreeScout have size requirements for photoUrl images?

---

## Sources

- [FreeScout REST API Documentation](https://api-docs.freescout.net/)
- [FreeScout API & Webhooks Module](https://freescout.net/module/api-webhooks/)
- [FreeScout Customer Avatars](https://freescout.shop/downloads/freescout-module-avatars/)
- Existing codebase: `lib/freescout-client.js`, `lib/freescout-db.js`, `steps/prepare-freescout-customers.js`, `steps/submit-freescout-sync.js`
