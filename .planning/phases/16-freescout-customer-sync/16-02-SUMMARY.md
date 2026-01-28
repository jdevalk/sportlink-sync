---
phase: 16
plan: 02
type: summary
subsystem: freescout-sync
tags: [freescout, api, customer-sync, integration]

dependency-graph:
  requires:
    - phase-15: "Work history and commissie data"
    - plan-16-01: "FreeScout foundation (client, db)"
  provides:
    - "FreeScout customer sync from Sportlink/Stadion data"
    - "Custom fields: KNVB ID, teams, member_since, Nikki saldo/status"
    - "Integration into sync-all.js pipeline"
  affects:
    - "Future phases may add more FreeScout custom fields"

tech-stack:
  added: []
  patterns:
    - "Customer data aggregation from multiple databases"
    - "Hash-based change detection for customer sync"
    - "Search-before-create duplicate prevention"
    - "Graceful optional data handling (Nikki)"

key-files:
  created:
    - prepare-freescout-customers.js
    - submit-freescout-sync.js
  modified:
    - sync-all.js

decisions:
  - id: multi-source-aggregation
    choice: "Aggregate data from stadion-sync.sqlite and nikki-sync.sqlite"
    reason: "FreeScout needs unified customer view from multiple data sources"
  - id: nikki-optional
    choice: "Nikki data is optional - null values if database unavailable"
    reason: "Nikki sync runs separately; FreeScout sync should not fail without it"
  - id: freescout-id-authoritative
    choice: "freescout_customers table is authoritative for FreeScout ID mapping"
    reason: "Our database tracks the relationship; Sportlink free fields are secondary/seeding only"
  - id: search-before-create
    choice: "Search by email before creating new customer"
    reason: "Prevent duplicates if customer already exists in FreeScout"
  - id: custom-fields-env-vars
    choice: "Custom field IDs configurable via environment variables"
    reason: "Field IDs vary per FreeScout installation"

metrics:
  duration: "15 minutes"
  completed: "2026-01-28"
---

# Phase 16 Plan 02: FreeScout Customer Sync Summary

FreeScout customer sync with multi-source data aggregation and pipeline integration.

## What Was Built

### 1. Customer Data Preparation (`prepare-freescout-customers.js`)

Transforms member data from multiple sources into FreeScout customer format:

- **Stadion database**: Member basic info, email, phone, work history (teams)
- **FreeScout database**: Existing FreeScout IDs (authoritative tracking)
- **Sportlink free fields**: Secondary FreeScout ID source (for initial seeding)
- **Nikki database**: Contribution saldo and status (optional - graceful null if unavailable)

Output format per customer:
```javascript
{
  knvb_id: "12345678",
  email: "member@example.com",
  freescout_id: 123,  // from tracking DB or Sportlink
  data: {
    firstName: "John",
    lastName: "Doe",
    phones: [{ type: "mobile", value: "0612345678" }]
  },
  customFields: {
    union_teams: "Team A, Team B",
    public_person_id: "12345678",
    member_since: "2020-01-01",
    nikki_saldo: 50.00,
    nikki_status: "Actief"
  }
}
```

### 2. FreeScout Sync Submission (`submit-freescout-sync.js`)

Syncs prepared customers to FreeScout API:

- **Hash-based change detection**: Only sync customers whose data has changed
- **Search-before-create**: Find existing customer by email to prevent duplicates
- **Update or create**: Update existing customers, create new ones
- **Custom fields**: Sync KNVB ID, teams, member_since, Nikki data via separate API call
- **Orphan handling**: Delete tracking for members no longer in Sportlink

Sync flow:
1. Prepare customers from databases
2. Upsert to freescout_customers tracking table
3. Get customers needing sync (hash changed)
4. For each: search by email, then update or create
5. Update custom fields via `/api/customers/{id}/customer_fields`
6. Track FreeScout ID in our database

### 3. Pipeline Integration (`sync-all.js`)

Added FreeScout sync as Step 8 (after birthday sync):

- Checks credentials before attempting sync
- Gracefully skips if FREESCOUT_API_KEY not configured
- Adds stats to summary report (FREESCOUT SYNC section)
- Includes errors in overall error count and success check

## Custom Field Configuration

FreeScout custom field IDs are configurable via environment variables:

| Field | Env Variable | Default |
|-------|-------------|---------|
| Union Teams | `FREESCOUT_FIELD_UNION_TEAMS` | 1 |
| KNVB ID | `FREESCOUT_FIELD_PUBLIC_PERSON_ID` | 4 |
| Member Since | `FREESCOUT_FIELD_MEMBER_SINCE` | 5 |
| Nikki Saldo | `FREESCOUT_FIELD_NIKKI_SALDO` | 7 |
| Nikki Status | `FREESCOUT_FIELD_NIKKI_STATUS` | 8 |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 12da977 | feat | Create FreeScout customer data preparation script |
| 81ec17a | feat | Create FreeScout sync submission script |
| 8bb0277 | feat | Integrate FreeScout sync into pipeline |

## Files Changed

**Created:**
- `prepare-freescout-customers.js` - Customer data preparation (310 lines)
- `submit-freescout-sync.js` - Sync submission with API calls (409 lines)

**Modified:**
- `sync-all.js` - Added FreeScout sync step (+69 lines)

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

- Run `node prepare-freescout-customers.js --verbose` to see customer preparation
- Run `node submit-freescout-sync.js --dry-run --verbose` to preview sync without API calls
- FreeScout credentials required for actual sync: FREESCOUT_API_KEY and FREESCOUT_BASE_URL
- Nikki data is optional - sync works without nikki-sync.sqlite

## Next Steps

Phase 16 complete. FreeScout integration delivers:
- Customer sync from Sportlink data
- Custom fields for support context (KNVB ID, teams, payment status)
- Automated sync via sync-all.js pipeline

Potential future enhancements:
- Webhook integration for real-time updates
- Additional custom fields as FreeScout usage evolves
