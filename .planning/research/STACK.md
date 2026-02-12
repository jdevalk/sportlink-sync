# Technology Stack

**Project:** Rondo Sync v3.3 - FreeScout Enhanced Integration
**Researched:** 2026-02-12

## Overview

This document covers stack additions/changes needed for three NEW FreeScout integration features. The existing Node.js 22, Playwright, SQLite, Fastify, and FreeScout API client stack remains unchanged — this research focuses ONLY on what's needed for:

1. Fetching FreeScout conversations and creating activities in Rondo Club
2. Pushing member photos to FreeScout customers
3. Syncing Sportlink RelationEnd to FreeScout custom field ID 9

**Confidence:** HIGH (verified with official FreeScout API docs, existing codebase patterns)

---

## NEW Capabilities Required

### 1. FreeScout Conversations → Rondo Club Activities

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| **API Client** | Existing `lib/freescout-client.js` | N/A | Already handles authenticated FreeScout API requests with retry logic |
| **HTTP Client** | Node.js `https` module (built-in) | Node.js 22 | No additional library needed — `freescoutRequest()` uses existing `lib/http-client.js` |
| **Rondo Club API** | Existing `lib/rondo-club-client.js` | N/A | Already handles WordPress REST API requests — will need activity creation endpoint |
| **Database** | Existing `lib/freescout-db.js` (better-sqlite3) | Current | Track last synced conversation ID per customer to avoid duplicate activities |

**What NOT to add:**
- ❌ No GraphQL client needed (FreeScout REST API is sufficient)
- ❌ No polling/webhook server (batch sync via cron fits existing patterns)
- ❌ No message queue (volumes don't justify complexity)

**New FreeScout API Endpoint Usage:**

```javascript
// GET /api/conversations?customerId={id}&page=1&pageSize=50
// Returns: { _embedded: { conversations: [...] } }
//
// Each conversation object includes:
// - id, number, subject, status, state, type
// - createdAt (ISO 8601 UTC)
// - customer { id, firstName, lastName, email }
// - threads (if embed=threads parameter used)
```

**Integration Pattern:**

1. Iterate `freescout_customers` table (existing)
2. For each customer with `freescout_id`, fetch conversations via GET `/api/conversations?customerId={id}`
3. Track last synced conversation ID in new `last_conversation_id` column in `freescout_customers`
4. For new conversations, POST to Rondo Club activity endpoint (TBD in Rondo Club research)
5. Store activity relationship in new `freescout_activities` tracking table

**Database Extension:**

```sql
-- Add to lib/freescout-db.js initDb()
ALTER TABLE freescout_customers ADD COLUMN last_conversation_id INTEGER;

CREATE TABLE IF NOT EXISTS freescout_activities (
  id INTEGER PRIMARY KEY,
  knvb_id TEXT NOT NULL,
  freescout_conversation_id INTEGER NOT NULL,
  rondo_club_activity_id INTEGER,
  conversation_subject TEXT,
  conversation_created_at TEXT NOT NULL,
  synced_at TEXT,
  UNIQUE(knvb_id, freescout_conversation_id)
);
```

---

### 2. Member Photos → FreeScout Customers

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| **Photo Storage** | Existing `photos/` directory | N/A | Photos already downloaded from Sportlink via `download-photos-from-api.js` |
| **FreeScout API** | `photoUrl` field on customer PUT | N/A | FreeScout accepts external photo URLs (max 200 chars) — does NOT support file upload |
| **Photo Hosting** | Rondo Club WordPress `/wp-content/uploads/` | N/A | Photos uploaded to WordPress are publicly accessible via permalink |
| **URL Extraction** | Rondo Club API response | N/A | After photo upload, WordPress returns attachment URL |

**What NOT to add:**
- ❌ No image CDN needed (WordPress handles photo serving)
- ❌ No image processing library (Sportlink photos already optimized, WordPress handles resizing)
- ❌ No separate file upload to FreeScout (API uses URL reference, not multipart upload)

**FreeScout API Pattern:**

```javascript
// PUT /api/customers/{freescoutId}
{
  "photoUrl": "https://rondo.svawc.nl/wp-content/uploads/2026/02/12345678.jpg"
}
```

**Integration Points:**

1. **Existing:** Photo downloaded from Sportlink → saved to `photos/{knvb_id}.jpg` (done by `download-photos-from-api.js`)
2. **Existing:** Photo uploaded to Rondo Club → WordPress attachment ID returned (done by `upload-photos-to-rondo-club.js`)
3. **NEW:** After upload, GET person record from Rondo Club API to retrieve photo URL (or extract from upload response)
4. **NEW:** Store photo URL in `freescout_customers.photo_url` column
5. **NEW:** During customer sync, include `photoUrl` in FreeScout PUT request

**Database Extension:**

```sql
-- Add to lib/freescout-db.js initDb()
ALTER TABLE freescout_customers ADD COLUMN photo_url TEXT;
```

**Dependency on Rondo Club:** Requires Rondo Club WordPress to return photo permalink after upload. Verify `/wp-json/rondo/v1/people/{id}/photo` POST response includes attachment URL, or fetch via GET `/wp-json/wp/v2/media/{attachment_id}`.

---

### 3. Sportlink RelationEnd → FreeScout Custom Field ID 9

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| **Data Source** | Existing Sportlink scraper | N/A | `RelationEnd` already captured in `download-functions-from-sportlink.js` |
| **Database** | Existing `rondo_club_members` table | N/A | `relation_end` column already exists (stores Sportlink RelationEnd date) |
| **FreeScout API** | Custom Fields PUT endpoint | N/A | Existing `updateCustomerFields()` in `submit-freescout-sync.js` handles array of `{id, value}` |

**What NOT to add:**
- ❌ No date parsing library (Node.js `Date` handles ISO 8601 from Sportlink)
- ❌ No field mapping config (field ID 9 is hardcoded requirement per spec)
- ❌ No validation library (FreeScout API returns errors for invalid values)

**FreeScout API Pattern (existing code):**

```javascript
// PUT /api/customers/{freescoutId}/customer_fields
{
  "customerFields": [
    { "id": 1, "value": "Team1, Team2" },       // existing: union_teams
    { "id": 4, "value": "123456" },             // existing: public_person_id
    { "id": 5, "value": "2020-01-15" },         // existing: member_since
    { "id": 7, "value": "€45.50" },             // existing: nikki_saldo
    { "id": 8, "value": "Active" },             // existing: nikki_status
    { "id": 9, "value": "2025-12-31" }          // NEW: relation_end
  ]
}
```

**Integration Points:**

1. **Existing:** `RelationEnd` downloaded from Sportlink in `download-functions-from-sportlink.js` → stored in `member_functions.relation_end`
2. **Existing:** Field mapping in `getCustomFieldIds()` in `submit-freescout-sync.js` (currently maps IDs 1, 4, 5, 7, 8)
3. **NEW:** Add `relation_end: parseInt(process.env.FREESCOUT_FIELD_RELATION_END || '9', 10)` to field mapping
4. **NEW:** Add RelationEnd to `prepare-freescout-customers.js` customer data preparation
5. **NEW:** Add `{ id: fieldIds.relation_end, value: customFields.relation_end || '' }` to `buildCustomFieldsPayload()`

**Environment Variable:**

```bash
# Add to .env (with default fallback to 9 in code)
FREESCOUT_FIELD_RELATION_END=9
```

**Data Flow:**

```
Sportlink MemberFunctions API (RelationEnd)
  ↓ download-functions-from-sportlink.js
member_functions table (relation_end column)
  ↓ prepare-freescout-customers.js
customFields.relation_end
  ↓ buildCustomFieldsPayload()
FreeScout API PUT /api/customers/{id}/customer_fields
```

**Date Format:** Sportlink provides dates in various formats. The existing code in `download-functions-from-sportlink.js` line 48 stores `RelationEnd` as-is. FreeScout custom fields accept string values. If FreeScout field is configured as date type, it may require YYYY-MM-DD format — test with actual field configuration.

---

## Installation

**No new dependencies required.** All capabilities use existing libraries:

```bash
# Current dependencies (no changes)
npm install better-sqlite3 playwright form-data
```

**Environment variables to ADD:**

```bash
# .env additions
FREESCOUT_FIELD_RELATION_END=9  # Optional - defaults to 9 if not set
```

**Database migrations:**

All migrations handled in-code via `initDb()` pattern (existing approach):

```javascript
// lib/freescout-db.js initDb() additions
const cols = db.prepare('PRAGMA table_info(freescout_customers)').all();

if (!cols.some(c => c.name === 'last_conversation_id')) {
  db.exec('ALTER TABLE freescout_customers ADD COLUMN last_conversation_id INTEGER');
}

if (!cols.some(c => c.name === 'photo_url')) {
  db.exec('ALTER TABLE freescout_customers ADD COLUMN photo_url TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS freescout_activities (
    id INTEGER PRIMARY KEY,
    knvb_id TEXT NOT NULL,
    freescout_conversation_id INTEGER NOT NULL,
    rondo_club_activity_id INTEGER,
    conversation_subject TEXT,
    conversation_created_at TEXT NOT NULL,
    synced_at TEXT,
    UNIQUE(knvb_id, freescout_conversation_id)
  )
`);
```

---

## Code Patterns

### Pattern 1: Conversation Fetching (NEW)

**File:** `steps/fetch-freescout-conversations.js` (new file)

```javascript
const { freescoutRequest } = require('../lib/freescout-client');
const { openDb, getCustomersNeedingConversationSync } = require('../lib/freescout-db');

async function fetchConversations(freescoutId, lastConversationId, options) {
  const endpoint = `/api/conversations?customerId=${freescoutId}&sortField=createdAt&sortOrder=desc&pageSize=50`;
  const response = await freescoutRequest(endpoint, 'GET', null, options);

  const conversations = response.body?._embedded?.conversations || [];

  // Filter to only new conversations (ID > lastConversationId)
  if (lastConversationId) {
    return conversations.filter(c => c.id > lastConversationId);
  }

  return conversations;
}
```

**Integration:** Similar to existing `submit-freescout-sync.js` pattern — iterate customers, fetch data, update tracking DB, POST to Rondo Club.

### Pattern 2: Photo URL Sync (extension of existing)

**File:** `steps/sync-freescout-photos.js` (new file) OR extend `steps/sync-freescout-ids-to-rondo-club.js`

```javascript
// After photo upload to Rondo Club, extract URL
const photoUrl = await getRondoClubPhotoUrl(rondoClubId);

// Update FreeScout customer
await freescoutRequest(`/api/customers/${freescoutId}`, 'PUT', {
  photoUrl: photoUrl
}, options);

// Track in database
updatePhotoUrl(db, knvbId, photoUrl);
```

**Integration:** Extend existing photo sync pipeline (`pipelines/sync-people.js`) with new step after `upload-photos-to-rondo-club.js`.

### Pattern 3: RelationEnd Field (modification of existing)

**File:** `steps/submit-freescout-sync.js` (modify existing function)

**Change 1 - Field mapping:**
```javascript
function getCustomFieldIds() {
  return {
    union_teams: parseInt(process.env.FREESCOUT_FIELD_UNION_TEAMS || '1', 10),
    public_person_id: parseInt(process.env.FREESCOUT_FIELD_PUBLIC_PERSON_ID || '4', 10),
    member_since: parseInt(process.env.FREESCOUT_FIELD_MEMBER_SINCE || '5', 10),
    nikki_saldo: parseInt(process.env.FREESCOUT_FIELD_NIKKI_SALDO || '7', 10),
    nikki_status: parseInt(process.env.FREESCOUT_FIELD_NIKKI_STATUS || '8', 10),
    relation_end: parseInt(process.env.FREESCOUT_FIELD_RELATION_END || '9', 10)  // NEW
  };
}
```

**Change 2 - Payload builder:**
```javascript
function buildCustomFieldsPayload(customFields) {
  const fieldIds = getCustomFieldIds();
  return [
    { id: fieldIds.union_teams, value: customFields.union_teams || '' },
    { id: fieldIds.public_person_id, value: customFields.public_person_id || '' },
    { id: fieldIds.member_since, value: customFields.member_since || '' },
    { id: fieldIds.nikki_saldo, value: customFields.nikki_saldo !== null ? String(customFields.nikki_saldo) : '' },
    { id: fieldIds.nikki_status, value: customFields.nikki_status || '' },
    { id: fieldIds.relation_end, value: customFields.relation_end || '' }  // NEW
  ];
}
```

**Change 3 - Data preparation in `prepare-freescout-customers.js`:**
```javascript
// Fetch relation_end from member_functions table (most recent RelationEnd for member)
const relationEndStmt = db.prepare(`
  SELECT relation_end
  FROM member_functions
  WHERE knvb_id = ?
  ORDER BY relation_end DESC
  LIMIT 1
`);
const relationEndRow = relationEndStmt.get(member.knvb_id);

customFields.relation_end = relationEndRow?.relation_end || null;
```

---

## Sources

### Official Documentation

- [FreeScout API Reference](https://api-docs.freescout.net/) - Official API documentation (HIGH confidence)
- [FreeScout API & Webhooks Module](https://freescout.net/module/api-webhooks/) - Module overview

### Verified Capabilities

1. **Conversations API:** GET `/api/conversations` supports `customerId`, `customerEmail`, pagination, sorting, and optional `embed=threads` parameter (verified via official docs)
2. **Custom Fields API:** PUT `/api/customers/{id}/customer_fields` accepts array of `{id, value}` objects (existing code in `submit-freescout-sync.js` line 176)
3. **Photo URL Field:** `photoUrl` field on customer PUT accepts external URLs (max 200 chars) — verified via official docs, does NOT support file upload
4. **RelationEnd Data:** Already captured in `download-functions-from-sportlink.js` line 48, stored in `member_functions.relation_end` column

### Existing Codebase Patterns

- FreeScout API client: `/Users/joostdevalk/Code/rondo/rondo-sync/lib/freescout-client.js`
- FreeScout DB layer: `/Users/joostdevalk/Code/rondo/rondo-sync/lib/freescout-db.js`
- Photo download: `/Users/joostdevalk/Code/rondo/rondo-sync/steps/download-photos-from-api.js`
- Photo upload: `/Users/joostdevalk/Code/rondo/rondo-sync/steps/upload-photos-to-rondo-club.js`
- Custom field sync: `/Users/joostdevalk/Code/rondo/rondo-sync/steps/submit-freescout-sync.js` lines 18-42, 172-181

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Rondo Club activity endpoint doesn't exist yet** | High | Requires parallel Rondo Club development — coordinate with WordPress theme research |
| **Photo URL extraction unclear** | Medium | Test Rondo Club photo upload response format — may need GET `/wp-json/wp/v2/media/{id}` |
| **FreeScout custom field 9 date format** | Low | Test with actual FreeScout configuration — may need date normalization |
| **Conversation pagination limits** | Low | Handle pagination if customer has >50 conversations (rare for sports club) |
| **Photo URL 200 char limit** | Very Low | WordPress URLs typically <100 chars for uploads |

---

## Dependencies on Rondo Club (WordPress)

**CRITICAL:** Feature 1 (conversations → activities) requires NEW Rondo Club WordPress API endpoint:

```
POST /wp-json/rondo/v1/people/{id}/activities
{
  "title": "FreeScout: {conversation subject}",
  "source": "freescout",
  "source_id": "{conversation_id}",
  "activity_date": "{conversation createdAt}",
  "activity_type": "email",
  "meta": {
    "conversation_number": "{number}",
    "conversation_status": "{status}",
    "conversation_url": "https://freescout.example.com/conversation/{id}"
  }
}
```

This endpoint does NOT exist yet — must be implemented in Rondo Club theme research/development phase.

**Photo URL:** Existing `/wp-json/rondo/v1/people/{id}/photo` POST endpoint must return photo URL in response (verify or add GET endpoint to retrieve URL after upload).

---

## Summary

**Zero new npm packages required.** All three features use existing infrastructure:

1. **Conversations → Activities:** FreeScout API client + Rondo Club API client + SQLite tracking (all existing). Requires NEW Rondo Club WordPress activity endpoint.
2. **Photos → FreeScout:** Existing photo download/upload pipeline + FreeScout `photoUrl` field. Requires photo URL extraction from Rondo Club.
3. **RelationEnd → Field 9:** Existing Sportlink scraper + existing FreeScout custom fields sync. Add one field to mapping.

**Codebase changes:**
- Extend `lib/freescout-db.js` with 2 new columns + 1 new table (SQLite migrations)
- New step: `steps/fetch-freescout-conversations.js`
- New step: `steps/sync-freescout-photos.js` OR extend `steps/sync-freescout-ids-to-rondo-club.js`
- Modify: `steps/submit-freescout-sync.js` (add RelationEnd field mapping)
- Modify: `steps/prepare-freescout-customers.js` (add RelationEnd data extraction)

**Environment:**
- Add `FREESCOUT_FIELD_RELATION_END=9` (optional, defaults to 9)

**Blockers:**
- Rondo Club WordPress must provide activity creation endpoint (Feature 1)
- Rondo Club WordPress must return photo URL after upload (Feature 2)
