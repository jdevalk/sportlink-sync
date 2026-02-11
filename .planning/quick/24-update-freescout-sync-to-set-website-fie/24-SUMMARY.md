---
phase: 24-update-freescout-sync-to-set-website-fie
plan: 01
subsystem: freescout-sync
tags: [freescout, integration, ux]
dependency_graph:
  requires: []
  provides: ["website-urls-in-freescout"]
  affects: ["freescout-customer-sync"]
tech_stack:
  added: []
  patterns: ["website-url-construction"]
key_files:
  created: []
  modified:
    - "steps/prepare-freescout-customers.js"
    - "steps/submit-freescout-sync.js"
decisions: []
metrics:
  duration_seconds: 55
  completed_at: "2026-02-11T10:57:43Z"
  tasks_completed: 2
  files_modified: 2
  commits: 2
---

# Quick Task 24: Update FreeScout Sync to Set Website Field

FreeScout customers now include clickable links to both Sportlink member pages and Rondo Club person pages, giving helpdesk agents one-click access to full member records.

## Commits

| Commit | Message |
|--------|---------|
| 707ccf3 | feat(24): add website URLs to FreeScout customer data |
| 86eab65 | feat(24): send website URLs in FreeScout API payloads |

## Implementation

### Task 1: Add website URLs to prepared customer data

Modified `prepareCustomer()` function in `steps/prepare-freescout-customers.js`:

1. Imported `readEnv` utility from `lib/utils`
2. Built `websites` array in returned `data` object
3. Always includes Sportlink member page: `https://club.sportlink.com/member/member-details/{KNVB ID}/general`
4. Conditionally includes Rondo Club person page: `{RONDO_URL}/people/{rondo_club_id}` (only when member has WordPress post)
5. Strips trailing slash from `RONDO_URL` to ensure clean URLs
6. Follows FreeScout API format: array of `{value: "url"}` objects

### Task 2: Send websites in FreeScout create and update payloads

Modified both API functions in `steps/submit-freescout-sync.js`:

1. **createCustomer()**: Added websites to payload when available
2. **updateCustomer()**: Added websites to payload when available
3. Follows same conditional pattern used for phones field
4. FreeScout REST API accepts `websites` array on both POST and PUT

## Verification

- Both modules load without syntax errors
- Code follows existing patterns (matches phones field handling)
- Website URLs include correct member identifiers
- Change detection will trigger resync on next `--force` run (hash includes websites data)

## Next Steps

1. Deploy to server: `git push && ssh root@46.202.155.16 "cd /home/rondo && git pull"`
2. Run sync with force flag: `scripts/sync.sh freescout --force`
3. Spot-check FreeScout customer to confirm both URLs appear in sidebar

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

**Hash-based change detection**: Adding the `websites` field to `data` changes the source hash for all customers, so next `--force` sync will update all FreeScout customers with the new website URLs.

**Conditional Rondo URL**: Members without a `rondo_club_id` (new members not yet synced to WordPress) only get the Sportlink URL. Once they're synced, subsequent updates will add the Rondo Club URL.

**URL construction**: Sportlink URLs use the KNVB ID directly from the member record. Rondo Club URLs use the `rondo_club_id` which is already queried and assigned in `runPrepare()` at line 254/270 of the prepare script.

## Self-Check: PASSED

Files verified:
- FOUND: /Users/joostdevalk/Code/rondo/rondo-sync/steps/prepare-freescout-customers.js
- FOUND: /Users/joostdevalk/Code/rondo/rondo-sync/steps/submit-freescout-sync.js

Commits verified:
- FOUND: 707ccf3
- FOUND: 86eab65
