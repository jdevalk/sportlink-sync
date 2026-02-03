# Project Milestones: Sportlink Sync

## v2.2 Discipline Cases (Shipped: 2026-02-03)

**Delivered:** Discipline case sync from Sportlink to Stadion with season-based organization, person linking, and weekly automated pipeline.

**Phases completed:** 30-32 (3 plans total)

**Key accomplishments:**

- Browser automation downloads individual discipline cases from Sportlink's `/competition-affairs/discipline-cases`
- SQLite storage with 12 data columns and hash-based change detection
- Season derivation from match date using August 1 boundary (matches KNVB season cycles)
- Person linking via PublicPersonId → stadion_id mapping with skip handling
- Pipeline integration: `scripts/sync.sh discipline`, Monday 11:30 PM cron, email reporting

**Stats:**

- 27 files modified
- 1,227 lines new code (discipline module)
- 20,224 lines total JavaScript (project)
- 3 phases, 3 plans
- 2 days (2026-02-02 → 2026-02-03)

**Git range:** `580868d` → `739db11`

**What's next:** To be determined in next milestone planning.

---

## v2.1 Improved Nikki Import (Shipped: 2026-02-02)

**Delivered:** Enhanced Nikki contribution sync with CSV data extraction, per-year ACF field storage in Stadion, and 4-year historical retention.

**Phases completed:** 27-29 (3 plans total)

**Key accomplishments:**

- CSV download from Nikki Rapporten link with Playwright download handling
- Hoofdsom extraction and data merge by nikki_id mapping
- 4-year historical retention via year-based pruning (replaces destructive clear)
- Per-year ACF field sync to Stadion (_nikki_{year}_total/saldo/status)
- Added csv-parse library for robust CSV parsing with BOM handling

**Stats:**

- 4 files created/modified
- 18,934 lines of JavaScript (project total)
- 3 phases, 3 plans
- 2 days (2026-02-01 → 2026-02-02)

**Git range:** `feat(27-01)` → `feat(29-01)`

**What's next:** To be determined in next milestone planning.

---

## v2.0 Bidirectional Sync (Shipped: 2026-01-29)

**Delivered:** Bidirectional sync enabling corrections made in Stadion to flow back to Sportlink via browser automation, with last-edit-wins conflict resolution at field level.

**Phases completed:** 20-26 (10 plans total)

**Key accomplishments:**

- Per-field bidirectional timestamp tracking (14 columns) for conflict detection
- Last-write-wins conflict resolution with 5-second grace period and audit trail
- Hash-based change detection identifies Stadion modifications for reverse sync
- Playwright-based reverse sync pushes contact field corrections to Sportlink
- Multi-page Sportlink updates for datum-vog, freescout-id, and financiele-blokkade
- Full pipeline integration with email reporting for conflicts and reverse sync stats

**Stats:**

- 21 files created/modified
- 17,547 lines of JavaScript (project total)
- 7 phases, 10 plans, ~27 tasks
- Same day development (2026-01-29, ~6 hours)

**Git range:** `feat(20-01)` → `feat(26-01)`

**What's next:** To be determined in next milestone planning.

---

## v1.7 MemberHeader API (Shipped: 2026-01-28)

**Delivered:** Financial block tracking and optimized photo sync via MemberHeader API, replacing browser-based photo download with direct HTTP fetch.

**Phases completed:** 17-19 (6 plans total)

**Key accomplishments:**

- MemberHeader API capture during existing `/other` page visit (zero overhead)
- Financial block status syncs to Stadion `financiele-blokkade` field with activity audit trail
- HTTP-based photo download replaces browser automation (faster, more reliable)
- Photo change detection using `Photo.PhotoDate` (more accurate than PersonImageDate)
- Simplified cron architecture (4 jobs instead of 5, photos merged into hourly people sync)
- ~400 lines of browser automation code removed

**Stats:**

- 35 files created/modified
- 14,961 lines of JavaScript (project total)
- 3 phases, 6 plans, ~17 tasks
- Same day development (2026-01-28)

**Git range:** `f7dd2a7` → `4d0e079`

**What's next:** To be determined in next milestone planning.

---

## v1.5 Team Sync (Shipped: 2026-01-26)

**Delivered:** Member teams from Sportlink now sync to Stadion with work history entries linking persons to their teams.

**Phases completed:** 13-15 (3 plans total)

**Key accomplishments:**

- Team extraction from Sportlink (UnionTeams priority, ClubTeams fallback)
- Team sync to Stadion WordPress via REST API with hash-based change detection
- Work history linking persons to teams via ACF repeater field with "Speler" job title
- Team change detection with automatic history tracking (ends old, creates new)
- Integrated into daily pipeline with team and work history stats in email reports
- Non-critical sync pattern ensures team failures don't block other operations

**Stats:**

- 24 files created/modified
- 6,754 lines of JavaScript (project total)
- 3 phases, 3 plans
- 5 days (2026-01-21 → 2026-01-26)

**Git range:** `1deceb6` → `02aeee6`

**What's next:** To be determined in next milestone planning.

---

## v1.4 Photo Sync (Shipped: 2026-01-26)

**Delivered:** Member photos from Sportlink now sync to Stadion with full lifecycle management (download, upload, deletion).

**Phases completed:** 9-12 (4 plans total)

**Key accomplishments:**

- Photo state tracking via PersonImageDate in SQLite
- Browser automation downloads photos from member detail pages
- Photos saved locally in `photos/` directory with PublicPersonId as filename
- Photos uploaded to Stadion via REST API endpoint
- Photo deletion when removed in Sportlink
- Integrated into daily pipeline with photo sync statistics in email report

**Stats:**

- 13 files created/modified
- 5,300+ lines of JavaScript (project total at time)
- 4 phases, 4 plans
- Same day development (2026-01-26)

**Git range:** `feat(09-01)` → `feat(12-01)`

**What's next:** Team sync milestone (v1.5)

---

## v1.3 Connect to Stadion (Shipped: 2026-01-25)

**Delivered:** Dual-system sync pipeline - Sportlink member data now syncs to both Laposta email lists and Stadion WordPress app via REST API.

**Phases completed:** 5-8 (8 plans total)

**Key accomplishments:**

- Created WordPress REST API client with application password authentication
- Implemented member sync with KNVB ID matching and email fallback
- Built hash-based change detection for efficient incremental sync
- Added parent sync as separate person records with bidirectional relationship linking
- Unified sync-all pipeline orchestrating both Laposta and Stadion destinations
- Extended email reports with dual-system statistics and consolidated error handling

**Stats:**

- 40 files created/modified
- 4,393 lines of JavaScript
- 4 phases, 8 plans
- Same day development (2026-01-25)

**Git range:** `feat(05-01)` → `feat(08-01)`

**What's next:** To be determined in next milestone planning.

---

## v1.2 Email Improvements (Shipped: 2026-01-25)

**Delivered:** Polished email reports with semantic HTML formatting and clean cron output.

**Phases completed:** 4 (2 plans total)

**Key accomplishments:**

- Converted sync report emails from pre-wrapped text to semantic HTML with headings and sections
- Added "Sportlink SYNC" sender display name in email From field
- Eliminated npm lifecycle header noise from cron-triggered sync output
- Made install-cron.sh idempotent (re-runnable without creating duplicate entries)

**Stats:**

- 3 files modified
- 2,619 lines of JavaScript + shell
- 1 phase, 2 plans, 4 tasks
- Same day as v1.1 ship

**Git range:** `fix(04-02)` -> `fix(04-01)`

**What's next:** To be determined in next milestone planning.

---

## v1.1 Postmark Email Delivery (Shipped: 2026-01-25)

**Delivered:** Reliable email delivery via Postmark - sync reports no longer land in spam.

**Phases completed:** 3 (2 plans total)

**Key accomplishments:**

- Created Node.js script for sending email via Postmark API
- Implemented environment variable validation for Postmark credentials
- Integrated email sending into cron wrapper with graceful failure handling
- Updated install script to prompt for Postmark credentials
- Removed dependency on unreliable local mail command

**Stats:**

- 9 files created/modified
- 2,574 lines of JavaScript + shell
- 1 phase, 2 plans, 5 tasks
- 4 days from v1.0 to ship

**Git range:** `feat(03-01)` -> `feat(03-02)`

**What's next:** To be determined in next milestone planning.

---

## v1.0 MVP (Shipped: 2026-01-24)

**Delivered:** Automated daily sync with email reports - cron runs sync at 6 AM Amsterdam time and emails summary to operator.

**Phases completed:** 1-2 (3 plans total)

**Key accomplishments:**

- Created dual-stream logger with stdout + date-based log files
- Modularized download/prepare/submit scripts with exportable functions
- Built sync-all orchestrator with clean, email-ready summary output
- Created cron wrapper with flock locking and email delivery
- Implemented cron install script with timezone-aware scheduling

**Stats:**

- 17 files created/modified
- 2,419 lines of JavaScript + shell
- 2 phases, 3 plans, 9 tasks
- 3 days from start to ship

**Git range:** `feat(01-01)` -> `feat(02-01)`

**What's next:** To be determined in next milestone planning.

---
