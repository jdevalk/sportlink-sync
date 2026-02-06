---
created: 2026-02-06T12:00
title: Review deleted member handling across all downstream systems
area: sync
files:
  - steps/sync-nikki-to-stadion.js:93-124
  - lib/stadion-client.js:72-95
---

## Problem

When a member leaves the club and is deleted from Sportlink (and subsequently from Stadion), the sync pipelines don't handle this gracefully. Discovered when person SVMY52J (stadion_id 4545) was deleted from Stadion, causing the Nikki sync to hit a 500 fatal error on `GET /wp/v2/people/4545?_fields=acf`.

Questions to review across all pipelines:

1. **Stadion:** When a person is deleted from Sportlink, do we delete/trash them in Stadion? Or do they linger with stale `stadion_id` mappings in `stadion_members`?
2. **Laposta:** Do we auto-remove members from Laposta lists when they leave the club? Or do they stay subscribed?
3. **FreeScout:** Do we clean up FreeScout customers for departed members?
4. **Database mappings:** When a Stadion person is deleted, the `stadion_members` table still holds the old `stadion_id`, causing 404/500 errors on subsequent syncs.
5. **Error handling:** Should sync steps gracefully handle 404/410 (deleted) responses by clearing the stale mapping instead of just logging an error?

The Nikki sync specifically crashes because it needs `first_name`/`last_name` from the existing person record before it can do a PUT update — if the person is gone, it can't proceed.

## Solution

TBD — needs a review of the full member lifecycle across all downstream systems and a decision on the desired behavior for each.
