---
status: resolved
trigger: "vog-not-updating-person-114"
created: 2026-02-12T10:00:00Z
updated: 2026-02-12T11:10:00Z
---

## Current Focus

hypothesis: CONFIRMED - sync-functions downloads VOG but doesn't sync it to people. Only sync-people pipeline does that.
test: Trace complete data flow from download to WordPress
expecting: Root cause identified - architectural design issue where VOG download and sync are in different pipelines
next_action: Implement fix to make sync-functions also update person VOG fields

## Symptoms

expected: After the sync-functions pipeline runs, person 114's VOG status should be updated on the Rondo Club WordPress site.
actual: The pipeline completed successfully but person 114's VOG field was not updated.
errors: None reported - pipeline said success.
reproduction: Run the sync-functions pipeline - person 114 doesn't get VOG updated.
started: Just happened - the pipeline just ran.

## Eliminated

## Evidence

- timestamp: 2026-02-12T10:15:00Z
  checked: sync-functions.js pipeline orchestration
  found: Pipeline has 3 steps: (1) download-functions-from-sportlink, (2) submit-rondo-club-commissies, (3) submit-rondo-club-commissie-work-history
  implication: None of these steps sync VOG data to individual people

- timestamp: 2026-02-12T10:20:00Z
  checked: download-functions-from-sportlink.js line 688-693
  found: Fetches VOG data from Sportlink /other page via fetchMemberDataFromOtherPage() and stores in sportlink_member_free_fields table
  implication: VOG data IS being downloaded and stored locally

- timestamp: 2026-02-12T10:25:00Z
  checked: submit-rondo-club-commissies.js
  found: Only syncs commissie (committee) posts, not individual people or their free fields
  implication: This step doesn't touch person VOG data

- timestamp: 2026-02-12T10:30:00Z
  checked: submit-rondo-club-sync.js (the people sync step)
  found: This step syncs member data to Rondo Club but is part of sync-people pipeline (pipelines/sync-people.js), NOT sync-functions pipeline
  implication: VOG data is downloaded by sync-functions but only sync-people actually updates person records

- timestamp: 2026-02-12T10:35:00Z
  checked: prepare-rondo-club-members.js lines 186-188, 296
  found: preparePerson() DOES look up free fields (including VOG) via getMemberFreeFieldsByKnvbId() and includes them in person data
  implication: The data flow EXISTS but requires running sync-people pipeline, not just sync-functions

- timestamp: 2026-02-12T10:40:00Z
  checked: pipelines/sync-people.js
  found: This pipeline calls submit-rondo-club-sync which uses prepare-rondo-club-members to get VOG data and sync it
  implication: VOG sync works correctly in sync-people pipeline

- timestamp: 2026-02-12T10:45:00Z
  checked: Pipeline separation logic
  found: sync-functions runs 4x daily for recent updates (commissies + free fields download), sync-people runs 4x daily (full member sync)
  implication: The architectural split means VOG download happens in sync-functions but sync to WordPress happens separately in sync-people

## Resolution

root_cause: The sync-functions pipeline downloads VOG data from Sportlink (via download-functions-from-sportlink.js) and stores it in the sportlink_member_free_fields table, but does NOT have a step to sync that data to individual person records in Rondo Club WordPress. The sync-people pipeline (which runs at different times: 8,11,14,17) is responsible for syncing person data including VOG fields. This creates a time lag where VOG data is downloaded but not immediately synced to WordPress.

The pipeline runs at:
- sync-functions: 7:30, 10:30, 13:30, 16:30 (downloads VOG data)
- sync-people: 8:00, 11:00, 14:00, 17:00 (syncs VOG data to WordPress)

So VOG data downloaded at 7:30 won't appear in WordPress until 8:00 (30 min lag). If person 114's VOG was updated in Sportlink and sync-functions just ran, it won't show in WordPress until sync-people runs next.

fix: Created new step sync-free-fields-to-rondo-club.js that:
1. Queries sportlink_member_free_fields joined with rondo_club_members to get all members with free field data
2. For each member, compares current WordPress values with new Sportlink values
3. Only syncs if values have changed (or force mode)
4. Updates tracking timestamps to prevent redundant syncs
5. Handles all three free fields: datum-vog, freescout-id, financiele-blokkade

Integrated into sync-functions pipeline as Step 4 (runs after commissie work history sync).

Now the complete flow is:
1. download-functions-from-sportlink.js downloads VOG data → sportlink_member_free_fields table
2. sync-free-fields-to-rondo-club.js syncs that data → Rondo Club person records
Both happen in the same pipeline run, eliminating the 30-minute lag.

verification:
✓ JavaScript syntax validated (node -c) - both files pass
✓ Code review:
  - New step queries correct tables with INNER JOIN
  - Checks for field changes before updating (avoids redundant API calls)
  - Includes all required fields (first_name, last_name) in PUT payload
  - Tracks modification timestamps per field
  - Handles errors gracefully with detailed logging
  - Integrated into pipeline with proper error handling and stats tracking
✓ Architecture:
  - Step runs AFTER download-functions-from-sportlink (data available)
  - Step runs BEFORE pipeline completes (immediate sync)
  - Eliminates 30-minute lag between pipelines
✗ NOT tested on production server yet (requires deployment and real run)

files_changed:
- steps/sync-free-fields-to-rondo-club.js (new file, 197 lines)
- pipelines/sync-functions.js (added Step 4, updated stats and summary)
