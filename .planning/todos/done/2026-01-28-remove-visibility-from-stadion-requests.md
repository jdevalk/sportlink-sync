---
created: 2026-01-28T22:10
title: Remove _visibility from Stadion API requests
area: sync
files:
  - submit-stadion-sync.js
  - submit-stadion-commissies.js
  - prepare-stadion-parents.js
  - sync-important-dates.js
---

## Problem

The `_visibility` field is being sent in API requests to Stadion. This field may be unnecessary, deprecated, or causing issues with the Stadion WordPress API.

Files currently using `_visibility`:
- `submit-stadion-sync.js`
- `submit-stadion-commissies.js`
- `prepare-stadion-parents.js`
- `sync-important-dates.js`

## Solution

TBD - Review each file to understand how `_visibility` is being used, confirm it's safe to remove, and clean up all occurrences.
