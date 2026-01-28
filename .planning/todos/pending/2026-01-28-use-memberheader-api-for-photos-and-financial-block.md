---
created: 2026-01-28T19:30
title: Use MemberHeader API for photos and financial block
area: sync
files:
  - download-data-from-sportlink.js:fetchMemberFreeFields
  - download-photos-from-sportlink.js
  - submit-stadion-sync.js
---

## Problem

When fetching VOG details on the "Other" page via `fetchMemberFreeFields`, the `member/MemberHeader` API response is already available but we're not using it. This response contains two valuable pieces of data:

1. **`HasFinancialTransferBlockOwnClub`** - Boolean indicating whether the person cannot transfer away from the club until they've paid what they owe. This needs to sync to Stadion on the `financiele-blokkade` field.

2. **`Photo` object** with `Url` and `PhotoDate` fields - This could entirely replace the current photo download approach which uses browser automation. Getting photo URLs directly from the API would be significantly more efficient than the current screenshot/download approach.

## Solution

**Part 1: Financial Block**
- In `fetchMemberFreeFields`, also capture the `member/MemberHeader` response
- Extract `HasFinancialTransferBlockOwnClub` value
- Add to member data and sync to Stadion `financiele-blokkade` field

**Part 2: Photo Optimization**
- Use `Photo.Url` and `Photo.PhotoDate` from MemberHeader response
- Replace `download-photos-from-sportlink.js` browser automation with direct URL fetching
- This eliminates the need for headless browser photo downloads entirely
- Keep `PhotoDate` to detect when photos have changed (skip re-upload if unchanged)

This is a significant optimization opportunity - the current photo sync is one of the slower pipelines due to browser automation.
