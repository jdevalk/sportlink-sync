---
phase: 27-csv-download---data-matching
plan: 01
subsystem: nikki-sync
tags: [csv, playwright, sqlite, data-merge]

# Dependency graph
requires: []
provides:
  - CSV download capability from Nikki Rapporten link
  - Hoofdsom field in nikki_contributions table
  - HTML/CSV data merge by nikki_id
affects:
  - 27-02: Enhanced display with hoofdsom data
  - 27-03: Status syncing (if applicable)

# Tech tracking
tech-stack:
  added:
    - csv-parse@6.1.0
  patterns:
    - Playwright download events (waitForEvent)
    - Data merge by key lookup (Map-based)
    - SQLite schema migration (ALTER TABLE)

# File tracking
key-files:
  created: []
  modified:
    - download-nikki-contributions.js
    - lib/nikki-db.js
    - package.json
    - package-lock.json
    - .gitignore

# Decisions
decisions:
  - id: 27-01-1
    choice: Use csv-parse library for CSV parsing
    reason: Stream-based parsing, handles BOM, flexible column mapping

# Metrics
duration: ~8 minutes
completed: 2026-02-01
---

# Phase 27 Plan 01: CSV Download & Data Matching Summary

**One-liner:** CSV download from Nikki Rapporten link with hoofdsom extraction merged to HTML table data by nikki_id.

## Changes Made

### 1. CSV Parsing Infrastructure
- Added `csv-parse@6.1.0` dependency for robust CSV parsing
- Added `downloads/` and `nikki-sync.sqlite` to `.gitignore`

### 2. CSV Download Capability (download-nikki-contributions.js)
- Added `acceptDownloads: true` to browser context for Playwright downloads
- Implemented `downloadAndParseCsv()` function:
  - Creates downloads directory if needed
  - Sets up download listener before clicking (race condition prevention)
  - Tries multiple selectors for Rapporten link robustness
  - Parses CSV with columns auto-detection, BOM handling, and trim
  - Cleans up downloaded file after parsing
  - Returns null gracefully if Rapporten link not found

### 3. Data Merge Functionality (download-nikki-contributions.js)
- Implemented `mergeHtmlAndCsvData()` function:
  - Builds Map lookup from CSV records by nikki_id
  - Tries multiple column name variants (nikki_id, nikkiId, NikkiId)
  - Extracts hoofdsom from CSV with multiple column name fallbacks
  - Gracefully sets hoofdsom to null for unmatched records
  - Logs match statistics for debugging

### 4. Database Schema Update (lib/nikki-db.js)
- Added `hoofdsom REAL` column to nikki_contributions table
- Added migration block to ALTER TABLE for existing databases
- Updated `computeContributionHash()` to include hoofdsom
- Updated `upsertContributions()` with hoofdsom in INSERT/UPDATE
- Updated all SELECT queries (5 functions) to include hoofdsom

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CSV library | csv-parse | Stream-based, handles BOM, flexible column mapping |
| Download handling | waitForEvent before click | Prevents race condition between click and download |
| Graceful degradation | Return null on missing Rapporten | Sync continues with HTML data only if CSV unavailable |
| Migration strategy | Try ALTER TABLE in initDb | Supports existing databases without manual migration |

## Verification Results

All success criteria verified:
- `npm ls csv-parse` shows csv-parse@6.1.0 installed
- `.gitignore` contains downloads/ and nikki-sync.sqlite entries
- `download-nikki-contributions.js` has acceptDownloads, downloadAndParseCsv, mergeHtmlAndCsvData
- `lib/nikki-db.js` has hoofdsom REAL column and migration
- Both files pass syntax check (`node -c`)

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 8cfd581 | chore | Setup csv-parse and gitignore |
| c7a2a94 | feat | Add CSV download and data merge capability |
| 05b01ca | feat | Add hoofdsom column to nikki database schema |

## Next Phase Readiness

**Ready for:** Plan 27-02 (Enhanced display with hoofdsom data)

**Dependencies satisfied:**
- CSV download infrastructure in place
- Database schema supports hoofdsom field
- Data merge flow integrated into download pipeline

**Testing note:** Full end-to-end testing requires Nikki credentials and live server execution. The code is designed to gracefully handle cases where the Rapporten link is not found or CSV format differs from expected.
