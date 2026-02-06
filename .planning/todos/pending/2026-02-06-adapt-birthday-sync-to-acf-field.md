---
created: 2026-02-06T12:05
title: Adapt birthday sync to new Stadion ACF field model
area: sync
files:
  - steps/sync-important-dates.js
  - lib/stadion-db.js
---

## Problem

Stadion is changing its data model: birthdays will no longer be a separate post type (important dates) but a custom field directly on the person CPT. Our current birthday sync (`steps/sync-important-dates.js`) creates/updates separate important_date posts linked to people, which will become obsolete.

This also affects:
- The `stadion_important_dates` table in `stadion-sync.sqlite` (tracks synced birthday posts)
- Any hash-based change detection for birthdays
- The active debug session `birthday-sync-404-errors.md` (may become moot)

**Note:** Ask user for updated Stadion API documentation once the data model change is complete before starting implementation.

## Solution

TBD — wait for Stadion data model change to be completed and documented, then:
1. Get updated API docs from user
2. Replace important_date post creation with ACF field update on person
3. Simplify sync (one fewer API call per member)
4. Clean up or repurpose `stadion_important_dates` DB table
