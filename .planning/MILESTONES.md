# Project Milestones: Rondo Sync

## v3.2 Stadion-to-Rondo Rename (Shipped: 2026-02-11)

**Delivered:** Renamed all "stadion" references to "rondo_club" across the entire codebase — database tables, columns, SQL queries, variables, function names, and documentation — with safe live migration.

**Phases completed:** 41-43 (8 plans total)

**Key accomplishments:**

- Idempotent stadion-to-rondo_club migration using CREATE+INSERT+DROP for 8 SQLite tables with safe live migration
- Updated 80+ SQL query functions and all variable/function names in database layer
- Renamed all stadion references across 17 code files (pipelines, tools, lib)
- Renamed 200+ stadion references across 15 internal docs, CLAUDE.md, and package.json
- Renamed 184 stadion references across 13 developer docs site files
- Zero stadion references remain outside migration code (verified codebase-wide)

**Stats:**

- 67 files modified (+4,336 / -1,012)
- 25,064 lines total JavaScript (project)
- 3 phases, 8 plans
- Same day development (2026-02-11)

**Git range:** `fc5feb5` → `a80eacf`

**What's next:** To be determined in next milestone planning.

---

## v3.1 Fetch Former Members (Shipped: 2026-02-09)

**Delivered:** One-time import tool that fetches inactive members from Sportlink via browser automation and syncs them to Rondo Club as former member records with photos.

**Phases completed:** 40 (2 plans total, 3 tasks)

**Key accomplishments:**

- Playwright-based inactive member download from Sportlink with 3-strategy fallback status filter toggle
- One-time import tool with dry-run-by-default safety pattern and --import flag to execute
- Former members synced to Rondo Club with `acf.former_member = true` and duplicate detection
- Photo download via MemberHeader API and multipart upload to WordPress
- Cached download results enable resume-after-failure workflow

**Stats:**

- 8 files modified (1,141 insertions)
- 1 phase, 2 plans, 3 tasks
- Same day development (2026-02-09, ~33 min)
- Total execution time: 4 min

**Git range:** `824b05e` → `9adbfa2`

**What's next:** To be determined in next milestone planning.

---

## v3.0 Web Dashboard (Shipped: 2026-02-09)

**Delivered:** Web-based monitoring dashboard for sync pipelines with per-user authentication, run tracking, error browser, and error-only email alerts — replacing SSH-based monitoring and always-send email reports.

**Phases completed:** 34-38 (7 plans total, 14 tasks)

**Key accomplishments:**

- WAL mode on all 5 SQLite databases with 5s busy_timeout for concurrent cron + web server access
- RunTracker class instruments all 7 pipelines with per-step counts and individual error recording
- Fastify web server with Argon2id auth, SQLite sessions, deployed at https://sync.rondo.club via nginx/TLS + systemd
- Dashboard pipeline overview with traffic-light status (green/yellow/red) and overdue detection
- Run history, run detail, error browser with filtering, and error detail with expandable stack traces
- Error-only email alerts with dashboard links replace always-send reports; periodic overdue checks with 4-hour cooldown

**Stats:**

- 80 files modified (code)
- 23,129 lines total JavaScript (project)
- 5 phases, 7 plans, 14 tasks
- 2 days (2026-02-08 → 2026-02-09)
- Total execution time: 103 min

**Git range:** `271f312` → `9e599a4`

**Known limitations:**
- INFRA-04 partial: web server runs as root (no sportlink user on server) — tracked as pending todo
- MULTI-02 deferred: multi-club architecture for Phase 39 when second club onboards

**What's next:** To be determined in next milestone planning.

---

## v2.3 Birthday Field Migration (Shipped: 2026-02-06)

**Delivered:** Migrated birthday handling from separate important_date posts to a simple `acf.birthdate` field on person records, simplifying the data model and removing an entire sync lifecycle.

**Phases completed:** 33 (2 plans total)

**Key accomplishments:**

- Birthdate now syncs as `acf.birthdate` (Y-m-d) on person records via existing person pipeline
- Removed birthday sync step from people pipeline (8 steps → 7 steps)
- Deprecated `stadion_important_dates` DB table and 8 associated functions with backward compatibility
- Updated 14 documentation files to reflect simplified architecture
- Resolved birthday sync 404 errors by eliminating the important_date post lifecycle entirely

**Stats:**

- 28 files modified
- 20,956 lines total JavaScript (project)
- 1 phase, 2 plans, 4 tasks
- Same day development (2026-02-06)

**Git range:** `b8b7761` → `d1c02e1`

**What's next:** To be determined in next milestone planning.

---

## v2.2 Discipline Cases (Shipped: 2026-02-03)

**Delivered:** Discipline case sync from Sportlink to Rondo Club with season-based organization, person linking, and weekly automated pipeline.

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

**Delivered:** Enhanced Nikki contribution sync with CSV data extraction, per-year ACF field storage in Rondo Club, and 4-year historical retention.

**Phases completed:** 27-29 (3 plans total)

**Key accomplishments:**

- CSV download from Nikki Rapporten link with Playwright download handling
- Hoofdsom extraction and data merge by nikki_id mapping
- 4-year historical retention via year-based pruning (replaces destructive clear)
- Per-year ACF field sync to Rondo Club (_nikki_{year}_total/saldo/status)
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

**Delivered:** Bidirectional sync enabling corrections made in Rondo Club to flow back to Sportlink via browser automation, with last-edit-wins conflict resolution at field level.

**Phases completed:** 20-26 (10 plans total)

**Key accomplishments:**

- Per-field bidirectional timestamp tracking (14 columns) for conflict detection
- Last-write-wins conflict resolution with 5-second grace period and audit trail
- Hash-based change detection identifies Rondo Club modifications for reverse sync
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
- Financial block status syncs to Rondo Club `financiele-blokkade` field with activity audit trail
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

**Delivered:** Member teams from Sportlink now sync to Rondo Club with work history entries linking persons to their teams.

**Phases completed:** 13-15 (3 plans total)

**Key accomplishments:**

- Team extraction from Sportlink (UnionTeams priority, ClubTeams fallback)
- Team sync to Rondo Club WordPress via REST API with hash-based change detection
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

**Delivered:** Member photos from Sportlink now sync to Rondo Club with full lifecycle management (download, upload, deletion).

**Phases completed:** 9-12 (4 plans total)

**Key accomplishments:**

- Photo state tracking via PersonImageDate in SQLite
- Browser automation downloads photos from member detail pages
- Photos saved locally in `photos/` directory with PublicPersonId as filename
- Photos uploaded to Rondo Club via REST API endpoint
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

## v1.3 Connect to Rondo Club (Shipped: 2026-01-25)

**Delivered:** Dual-system sync pipeline - Sportlink member data now syncs to both Laposta email lists and Rondo Club WordPress app via REST API.

**Phases completed:** 5-8 (8 plans total)

**Key accomplishments:**

- Created WordPress REST API client with application password authentication
- Implemented member sync with KNVB ID matching and email fallback
- Built hash-based change detection for efficient incremental sync
- Added parent sync as separate person records with bidirectional relationship linking
- Unified sync-all pipeline orchestrating both Laposta and Rondo Club destinations
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


