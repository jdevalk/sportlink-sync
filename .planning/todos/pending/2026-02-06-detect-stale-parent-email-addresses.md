---
created: 2026-02-06T12:20
title: Detect and flag stale parent email addresses
area: sync
files:
  - steps/prepare-parents.js
  - pipelines/sync-people.js
---

## Problem

When a parent is also a member themselves, they may update their email address via the KNVB's voetbal.nl app or other channels. Sportlink updates their member record's email, but their **old** email address often remains listed as the parent contact for their children's records. This creates data inaccuracies:

- The parent's member record says `new@example.com`
- Their children's parent fields still say `old@example.com`
- Downstream systems (Laposta, Stadion) end up with stale parent emails
- Communications may go to the wrong address

The sync currently processes both records independently and doesn't cross-reference parent emails against member emails to detect these mismatches.

## Solution

TBD — needs discussion on:
1. **Detection:** During sync, compare parent email addresses against all member emails. If a parent shares a name (or KNVB ID?) with a member but has a different email, flag it.
2. **Flagging mechanism:** How to surface these? Options include:
   - Include in sync report email (to operator)
   - Flag in Stadion/Rondo Club UI for board members
   - Create a dedicated report/tool (`tools/show-stale-parent-emails.js`)
   - Notify the ledenadministratie directly
3. **Who receives the flag:** Operator? Ledenadministratie? Both?
4. **Auto-fix vs manual:** Should we auto-correct parent emails when we detect a match, or just flag for human review? (Auto-fix risky — could be a different person with same name)
