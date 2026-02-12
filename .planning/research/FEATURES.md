# Feature Landscape

**Domain:** Helpdesk/CRM integration with WordPress (FreeScout + Rondo Club)
**Researched:** 2026-02-12

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Email conversation visibility in CRM** | Industry standard — CRMs display support ticket history on customer records. Users expect complete interaction history. | Medium | FreeScout API provides `/api/conversations?customerEmail=` endpoint. Modern CRMs thread all conversations by customer. |
| **Customer photos/avatars in helpdesk** | Visual identification speeds up support. Expected in modern helpdesk systems (HelpScout, Zendesk, Intercom all support it). | Low | FreeScout API accepts `photoUrl` parameter on customer create/update. Photo must be web-accessible URL (not file upload). |
| **Custom field sync for membership data** | Helpdesk agents need context (membership status, end date, etc.). Custom fields are standard for CRM/helpdesk integrations. | Low | FreeScout API supports custom fields via `/api/customers/{id}/customer_fields` endpoint. Date fields use `YYYY-MM-DD` format. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Real-time activity feed in WordPress** | Agents work in WordPress (Rondo Club), not FreeScout. Showing conversations inline = faster context, no tab switching. | Medium-High | Requires storing/caching FreeScout data in WordPress (ACF repeater or REST endpoint). Alternative: client-side fetch on page load (slower, API rate limits). |
| **Bi-directional photo sync** | Photos from Sportlink → Rondo Club → FreeScout creates single source of truth. Manual photo management across systems is error-prone. | Medium | Existing: Sportlink → Rondo Club (via MemberHeader API). New: Rondo Club → FreeScout (needs WordPress media URL extraction). |
| **Automated membership status indicators** | "Lid tot" (member until) date in FreeScout shows agents when membership expires. Proactive support (renewal reminders, post-membership inquiries). | Low | Leverages existing `RelationEnd` field from Sportlink CSV export. Maps to FreeScout custom field ID 9. |
| **Deep-link navigation** | FreeScout customer records link to Sportlink + Rondo Club person pages. Agents jump directly to source systems for full member context. | Low | Already implemented in `prepare-freescout-customers.js` (websites array). Table stakes for multi-system workflows. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Create FreeScout conversations from Rondo Club** | FreeScout is the source of truth for support tickets. Creating conversations from WordPress violates single-responsibility principle and risks data conflicts. | Read-only display of FreeScout conversations in Rondo Club. Support agents create tickets in FreeScout. |
| **Real-time webhooks for conversation updates** | Polling FreeScout API for every person page load is inefficient. Webhooks add complexity (server endpoints, security, state management) for marginal benefit. | Cache FreeScout conversations in WordPress database (nightly sync or on-demand refresh). Display cached data with timestamp. |
| **Two-way custom field sync** | FreeScout is not authoritative for membership data. Syncing FreeScout changes back to Sportlink creates data conflicts and overwrites canonical source. | One-way sync: Sportlink → Rondo Club → FreeScout. FreeScout custom fields are read-only displays of upstream data. |
| **Inline photo editing in FreeScout** | Photos originate from Sportlink. FreeScout editing bypasses source of truth, creates orphaned files, and complicates sync logic. | Display photos from Rondo Club. Updates happen in Sportlink → flow downstream. |

## Feature Dependencies

```
FreeScout Customer Sync (EXISTING)
  ├─> Photo URL Sync (NEW)
  │     └─> Requires: WordPress media URL extraction from person post
  │
  ├─> RelationEnd Custom Field (NEW)
  │     └─> Requires: Sportlink CSV field mapping + FreeScout custom field API
  │
  └─> Email Conversation Display (NEW)
        ├─> Requires: FreeScout conversation fetch by email
        └─> Decision: Store in WordPress DB vs client-side fetch
              ├─> WordPress DB: Requires cache table, nightly sync step
              └─> Client-side: Requires JavaScript widget, CORS/auth handling
```

## MVP Recommendation

Prioritize:
1. **RelationEnd custom field sync** (Low complexity, high value — immediate agent context)
2. **Photo URL sync** (Low complexity, visual recognition benefit)
3. **Email conversation display (cached approach)** (Medium complexity, high impact — agents work in WordPress)

Defer:
- **Real-time activity feed**: Requires caching infrastructure decision first (Phase 1 research question: WordPress REST endpoint vs ACF repeater vs custom table)
- **Advanced conversation threading**: FreeScout handles threading. Rondo Club shows read-only timeline.

## Implementation Patterns

### Pattern 1: Photo URL Sync
**What:** Extract WordPress media URL from person post, send to FreeScout `photoUrl` field
**When:** After photo upload to Rondo Club (`photo_state = 'synced'`)
**Existing Code:**
- Photo download: `steps/download-photos-from-api.js` (Sportlink → local disk)
- Photo state tracking: `lib/rondo-club-db.js` (`photo_state` field)
- FreeScout customer update: `steps/submit-freescout-sync.js`

**New Requirements:**
- Query WordPress REST API for media attachments where `parent = {person_post_id}`
- Extract `source_url` from media response
- Include `photoUrl: media.source_url` in FreeScout customer data
- Handle edge case: Multiple attachments (select featured image or most recent)

### Pattern 2: RelationEnd Custom Field
**What:** Map Sportlink `RelationEnd` date to FreeScout custom field ID 9
**When:** During FreeScout customer sync (daily)
**Existing Code:**
- RelationEnd extraction: `steps/prepare-rondo-club-members.js:173` (stored in ACF `lid-tot` field)
- Custom field support: `steps/prepare-freescout-customers.js` (customFields object)
- FreeScout API client: `lib/freescout-client.js`

**New Requirements:**
- Add `lid_tot: acf['lid-tot']` to customFields object in `prepareCustomer()` function
- Map to FreeScout custom field ID 9 in submit step
- Use FreeScout API endpoint: `PUT /api/customers/{id}/customer_fields`
- Format: `{ customerFields: [{ id: 9, value: "YYYY-MM-DD" }] }`
- Handle null values (members without end date)

### Pattern 3: Conversation Display (Cached Approach)
**What:** Fetch FreeScout conversations by email, store in WordPress, display on person page
**When:** Nightly sync (or on-demand refresh button)
**Architecture Options:**

#### Option A: ACF Repeater Field
- **Pros:** Familiar WordPress pattern, no custom tables, REST API support built-in
- **Cons:** ACF repeaters slow with 100+ conversations, field bloat on person posts
- **Best For:** Low conversation volume (< 50 per person)

#### Option B: Custom WordPress Table
- **Pros:** Fast queries, independent of person posts, supports pagination
- **Cons:** Custom schema migration, manual REST endpoint, backup complexity
- **Best For:** High conversation volume, complex filtering

#### Option C: REST Endpoint (No Storage)
- **Pros:** No caching logic, always fresh data, minimal code
- **Cons:** FreeScout API latency on every page load, rate limit risk, no offline access
- **Best For:** Low traffic, small member base (< 500 people)

**Recommendation:** Start with Option C (REST endpoint, no storage) for MVP. Migrate to Option B if FreeScout API becomes bottleneck.

**API Flow:**
1. WordPress REST endpoint: `GET /wp-json/rondo/v1/person/{id}/freescout-conversations`
2. Extract email from person ACF fields
3. Call FreeScout API: `GET /api/conversations?customerEmail={email}&embed=threads`
4. Parse response: Extract `id`, `subject`, `status`, `created_at`, thread preview
5. Return JSON to frontend
6. Display in React/Vue widget on person edit page

## Conversation Display UX Patterns

Based on industry research, effective activity timeline displays follow these principles:

### Progressive Disclosure
- **Initial View:** Show 5 most recent conversations (subject, status, date)
- **Expand:** Click conversation to show thread preview
- **Deep Link:** "View in FreeScout" button to full conversation

### Visual Hierarchy
- **Status Indicators:** Color-coded badges (Active = green, Closed = gray, Pending = yellow)
- **Timestamps:** Relative time ("2 days ago") for recent, absolute dates for old
- **Avatars:** FreeScout agent photo + customer photo (if available)

### Whitespace & Spacing
- **Card-based Layout:** Each conversation in separate card with subtle border
- **Spacing:** 16px vertical gap between conversations
- **No Clutter:** Hide metadata (mailbox, folder, tags) unless relevant

### Micro-interactions
- **Hover States:** Card elevates on hover (box-shadow)
- **Loading States:** Skeleton loader while fetching from FreeScout API
- **Error States:** "Could not load conversations" with retry button

**Reference Implementations:**
- [Figma Activity Feed Components](https://www.untitledui.com/components/activity-feeds) (design patterns)
- [UX Flows for Activity Feeds](https://pageflows.com/web/screens/activity-feed/) (interaction patterns)

## Data Freshness Considerations

| Approach | Freshness | API Load | Complexity |
|----------|-----------|----------|------------|
| **Real-time fetch** | Always current | High (every page load) | Low (single API call) |
| **Cached (nightly)** | 0-24 hours stale | Low (daily batch) | Medium (cache invalidation logic) |
| **Hybrid (cache + refresh button)** | User-controlled | Low (on-demand spikes) | High (state management) |

**For this project:** Start with real-time fetch (MVP). The Rondo Club member base is small (< 1000 people), and WordPress person pages are low-traffic admin views, not public pages. FreeScout API rate limits are unlikely to be hit.

**Migration Path:** If FreeScout API becomes bottleneck, add caching layer:
1. Create `freescout_conversations` table in `rondo-sync.sqlite`
2. Add nightly sync step: `scripts/sync.sh freescout-conversations`
3. Update WordPress REST endpoint to query local cache
4. Add `Last synced: 2 hours ago` timestamp to UI

## Sources

**FreeScout API Documentation:**
- [FreeScout API Reference](https://api-docs.freescout.net/) — Conversations endpoint, customer fields, photoUrl parameter (HIGH confidence)

**Helpdesk/CRM Integration Best Practices:**
- [CRM Integration Guide 2026 - Shopify](https://www.shopify.com/blog/crm-integration) (MEDIUM confidence)
- [Email Integration Best Practices - Smartlead](https://www.smartlead.ai/blog/email-integration) (MEDIUM confidence)
- [CRM Help Desk Integration - Deskpro](https://www.deskpro.com/product/crm) (MEDIUM confidence)

**WordPress/ACF Patterns:**
- [ACF WP REST API Integration](https://www.advancedcustomfields.com/resources/wp-rest-api-integration/) (HIGH confidence)
- [How to Fetch API Data in WordPress - ACF](https://www.advancedcustomfields.com/blog/wordpress-fetch-data-from-api/) (HIGH confidence)
- [ACF Repeater Field Guide - WPLake](https://wplake.org/blog/how-to-use-and-display-the-acf-repeater-field/) (MEDIUM confidence)

**UI/UX Design Patterns:**
- [CRM UX Design Best Practices - Design Studio](https://www.designstudiouiux.com/blog/crm-ux-design-best-practices/) (MEDIUM confidence)
- [Activity Feed Components - Untitled UI](https://www.untitledui.com/components/activity-feeds) (HIGH confidence)
- [UX Flows for Activity Feeds - Pageflows](https://pageflows.com/web/screens/activity-feed/) (HIGH confidence)

**Sportlink API:**
- [Sportlink Club.Dataservice PHP Wrapper - GitHub](https://github.com/PendoNL/php-club-dataservice) (MEDIUM confidence — no official RelationEnd docs found, field confirmed in project config/sportlink-fields.json)
