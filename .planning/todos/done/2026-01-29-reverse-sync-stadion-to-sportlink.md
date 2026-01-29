---
created: 2026-01-29T14:30
title: Reverse sync Stadion to Sportlink
area: sync
files: []
---

## Problem

Current sync architecture is one-way only:
- Sportlink → Stadion (members, photos, teams, functions)
- Nikki → Stadion (contributions)

There is no mechanism to push data changes made in Stadion back to Sportlink. This means:
- Corrections made in Stadion must be manually re-entered in Sportlink
- Stadion is purely a downstream consumer, not a source of truth for any data
- Duplicate data maintenance burden

## Solution

TBD - Requires investigation:

**Key questions to answer:**
1. Does Sportlink have a writable API, or only read-only exports?
2. What authentication/authorization is needed for writes?
3. Which fields should be writable from Stadion?
4. How to handle conflicts (Sportlink vs Stadion as source of truth)?
5. What audit trail/logging is needed for reverse changes?

**Potential approaches:**
- Browser automation (if no API) - mirror existing download approach
- Direct API if Sportlink exposes write endpoints
- Hybrid: flag changes in Stadion, generate reports for manual Sportlink entry

**Architecture considerations:**
- Change detection in Stadion (modified_date tracking?)
- Conflict resolution strategy
- Separate sync schedule or integrate with existing?
