---
created: 2026-02-09T20:06:30.611Z
title: Improve FreeScout integration with Rondo Club
area: sync
files:
  - pipelines/freescout-sync.js
  - steps/submit-freescout-sync.js
  - lib/rondo-club-client.js
---

## Problem

The current FreeScout integration is one-directional: member data syncs from Sportlink to FreeScout as customers. Two features are missing:

1. **FreeScout emails as Rondo Club activities**: Email conversations in FreeScout (support tickets, replies) are not visible in Rondo Club. When viewing a person in Rondo Club, there's no way to see their FreeScout communication history. These emails should appear as activities on the person's record in Rondo Club.

2. **People's photos in FreeScout from Rondo Club**: FreeScout shows generic avatars for customers. Since Rondo Club already has member photos (synced from Sportlink), FreeScout should load these photos — either via a custom avatar module that fetches from Rondo Club's API, or by pushing photos to FreeScout during sync.

## Solution

**Emails as activities:**
- Use FreeScout API to fetch conversations for each customer
- Create activities (or custom post meta) on the corresponding Rondo Club person record
- Could be a new pipeline step or an extension of the existing freescout sync
- Consider polling frequency and incremental sync (only new conversations since last check)

**Photos from Rondo Club:**
- Option A: Push photos to FreeScout during customer sync (extend submit-freescout-sync.js)
- Option B: FreeScout custom module/plugin that fetches avatars from Rondo Club API
- Option A is simpler and fits existing sync patterns
