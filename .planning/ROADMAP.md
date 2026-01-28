# Roadmap: v1.7 MemberHeader API

**Milestone:** v1.7 MemberHeader API
**Goal:** Use MemberHeader API response to capture financial block status and optimize photo sync by replacing browser DOM scraping with direct API photo URLs
**Depth:** Quick
**Created:** 2026-01-28

## Overview

This milestone optimizes data capture and photo sync by using the MemberHeader API response already available during the `/other` page visit. Instead of browser scraping for photos and missing financial data entirely, we extract structured data from the API response: financial transfer block status and direct photo URLs with dates. This enables new financial block tracking in Stadion and eliminates brittle browser-based photo downloads.

## Phases

### Phase 17: MemberHeader Data Capture

**Goal:** Extract and store financial block status and photo metadata from MemberHeader API response

**Dependencies:** None (extends existing `/other` page visit)

**Requirements:**
- DATA-01: Capture MemberHeader API response when visiting `/other` page
- DATA-02: Extract `HasFinancialTransferBlockOwnClub` boolean from MemberHeader response
- DATA-03: Extract `Photo.Url` and `Photo.PhotoDate` from MemberHeader response
- DATA-04: Store captured data in SQLite database for downstream sync

**Success Criteria:**
1. MemberHeader API response is captured alongside existing MemberFreeFields capture during `/other` page visit
2. Financial block boolean (`HasFinancialTransferBlockOwnClub`) is extracted and stored in database for each member
3. Photo URL and PhotoDate are extracted from MemberHeader (handling null/missing Photo object gracefully)
4. SQLite tables store new fields (financial block, photo URL, photo date) with proper schema

**Notes:**
- Reuses existing browser navigation to `/other` page (no additional page loads)
- Foundation for Phases 18 and 19

**Plans:** 1 plan

Plans:
- [x] 17-01-PLAN.md - Capture MemberHeader API and store financial block + photo metadata

---

### Phase 18: Financial Block Sync

**Goal:** Sync financial transfer block status from Sportlink to Stadion WordPress

**Dependencies:** Phase 17 (requires financial block data in database)

**Requirements:**
- FINB-01: Store financial block status (`has_financial_block` boolean) in stadion_members table
- FINB-02: Sync financial block status to Stadion `financiele-blokkade` ACF field
- FINB-03: Include financial block changes in hash-based change detection

**Success Criteria:**
1. Financial block status is stored in stadion_members table as boolean column
2. Financial block status syncs to Stadion ACF field `financiele-blokkade` during member sync
3. Changes to financial block status trigger hash update and member re-sync (not suppressed as unchanged)
4. Email report shows financial block changes in sync statistics

**Notes:**
- Extends existing Stadion sync flow (submit-stadion-sync.js)
- Non-critical sync (failures don't block other operations)

**Plans:** 1 plan

Plans:
- [x] 18-01-PLAN.md - Sync financial block to Stadion ACF field with activity logging

---

### Phase 19: Photo API Optimization

**Goal:** Replace browser-based photo download with direct API URL fetch

**Dependencies:** Phase 17 (requires Photo.Url and Photo.PhotoDate in database)

**Requirements:**
- PHOT-01: Fetch photos directly from `Photo.Url` instead of browser DOM scraping
- PHOT-02: Use `Photo.PhotoDate` for change detection (skip re-download if date unchanged)
- PHOT-03: Handle members without photos (null/missing Photo object)
- PHOT-04: Remove browser-based photo download code (`download-photos-from-sportlink.js`)
- PHOT-05: Maintain existing photo upload/deletion flow to Stadion

**Success Criteria:**
1. Photos are fetched via HTTP request to `Photo.Url` (no browser navigation to detail pages)
2. Photo change detection uses `Photo.PhotoDate` instead of PersonImageDate (skip re-download when date unchanged)
3. Members without photos (null Photo object) are handled gracefully (no errors, no placeholder downloads)
4. Old browser-based photo download script is removed from codebase
5. Photo upload to Stadion and deletion flows remain unchanged (existing behavior preserved)

**Notes:**
- Significantly faster than browser automation (direct URL fetch vs page navigation + modal interaction)
- Reduces failure surface (no DOM selectors to break)
- Photo upload and deletion logic stays the same (only download changes)

**Plans:** 4 plans

Plans:
- [x] 19-01-PLAN.md - Extend MemberHeader capture to ALL members, add photo_url/photo_date to stadion_members
- [x] 19-02-PLAN.md - Create HTTP-based photo download script with retry logic
- [x] 19-03-PLAN.md - Integrate photo sync into people pipeline, update cron
- [x] 19-04-PLAN.md - Delete obsolete files, update documentation

---

## Progress

| Phase | Status | Requirements | Plans | Completed |
|-------|--------|--------------|-------|-----------|
| 17 - MemberHeader Data Capture | Complete | 4 | 1 | 2026-01-28 |
| 18 - Financial Block Sync | Complete | 3 | 1 | 2026-01-28 |
| 19 - Photo API Optimization | Complete | 5 | 4 | 2026-01-28 |

**Total:** 3 phases, 12 requirements

---

## Coverage

All 12 v1.7 requirements mapped:

| Requirement | Phase | Description |
|-------------|-------|-------------|
| DATA-01 | 17 | Capture MemberHeader API response |
| DATA-02 | 17 | Extract HasFinancialTransferBlockOwnClub |
| DATA-03 | 17 | Extract Photo.Url and Photo.PhotoDate |
| DATA-04 | 17 | Store captured data in SQLite |
| FINB-01 | 18 | Store financial block in stadion_members table |
| FINB-02 | 18 | Sync financial block to Stadion ACF field |
| FINB-03 | 18 | Include financial block in hash detection |
| PHOT-01 | 19 | Fetch photos from Photo.Url directly |
| PHOT-02 | 19 | Use Photo.PhotoDate for change detection |
| PHOT-03 | 19 | Handle members without photos |
| PHOT-04 | 19 | Remove browser-based photo download |
| PHOT-05 | 19 | Maintain existing upload/deletion flow |

**Coverage:** 12/12 requirements mapped (100%)

---

*Last updated: 2026-01-28 (Phase 19 complete - Milestone v1.7 complete)*
