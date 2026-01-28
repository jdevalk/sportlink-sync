---
created: 2026-01-28T09:00
title: Fetch member functions and committees from Sportlink
area: sync
files:
  - download-data-from-sportlink.js
  - submit-stadion-sync.js
  - laposta-db.js
---

## Problem

Currently the photo download script only fetches from `/member-details/<PublicPersonId>/general`. We need to also fetch data from `/member-details/<PublicPersonId>/functions` to get:

1. **MemberFunctions** - Club roles/functions for work history
2. **MemberCommittees** - Committee memberships for Stadion commissies

This data is needed to populate work_history entries in Stadion and sync committees as "Commissies".

## Solution

### 1. Extend Sportlink download

Change endpoint from `/general` to `/functions` (or fetch both). Capture:

**MemberFunctions response:**
- `Function[]` array containing:
  - `FunctionDescription` → work history role name
  - `RelationStart` → start date
  - `RelationEnd` → end date (null if current)
  - `Status` → if `ACTIVE`, set "currently works here" = true

**MemberCommittees response:**
- `Committee[]` array containing:
  - Committee details (need to identify unique ID field)
  - `CommitteeFunctionName` → role within committee for work history
  - `RelationStart` / `RelationEnd` → same as above

### 2. Database changes

- Store member functions in SQLite
- Create `committees` table to track unique committees (create once, reference by many)
- Store member-committee relationships with role

### 3. Stadion sync changes

**For MemberFunctions:**
- Create work_history entries on the person's own record
- Map Status=ACTIVE to currently_works_here=true

**For Committees:**
- Use existing `commissie` post type in Stadion
- Sync committees first (create if not exists, track mapping)
- Create work_history entries tied to commissie ID with CommitteeFunctionName as role

### Open questions

- What field uniquely identifies a Committee in Sportlink response? (need to check actual API response)
- What fields does Stadion's commissie post type require? (check api-commissies.md)
