# Sportlink Sync

## What This Is

A CLI tool that synchronizes member data bidirectionally between Sportlink Club (a Dutch sports club management system) and multiple destinations: Laposta email marketing lists and Stadion (a WordPress-based member management app). It downloads member data via browser automation, transforms it according to field mappings, syncs changes to both destinations including photos and team assignments, enables corrections in Stadion to flow back to Sportlink via browser automation, and runs automatically on scheduled intervals with email reports via Postmark.

## Core Value

Keep downstream systems (Laposta, Stadion) automatically in sync with Sportlink member data without manual intervention — now bidirectionally.

## Current State (v2.0 Shipped)

**Shipped:** 2026-01-29

Full bidirectional sync pipeline operational:
- Member data downloads from Sportlink via browser automation
- Members sync to Laposta email lists with hash-based change detection
- Members and parents sync to Stadion WordPress with relationship linking
- Financial block status syncs bidirectionally with activity audit trail
- Photos download via HTTP (from MemberHeader API URLs) and upload to Stadion hourly
- Photo change detection uses Photo.PhotoDate for accuracy
- Teams extract from Sportlink and sync to Stadion
- Work history links persons to teams with change detection
- FreeScout customer sync from Stadion and Nikki databases
- Reverse sync pushes contact field corrections from Stadion to Sportlink
- Conflict resolution uses last-write-wins with 5-second grace period
- Five automated pipelines (people 4x daily, nikki daily, teams/functions weekly, reverse sync every 15 minutes)

## Requirements

### Validated

- ✓ Download member data from Sportlink via browser automation with OTP — existing
- ✓ Transform Sportlink fields to Laposta format via configurable mapping — existing
- ✓ Sync members to up to 4 Laposta lists — existing
- ✓ Track sync state in SQLite to only submit changed members — existing
- ✓ Support parent/child member associations — existing
- ✓ Deduplicate parent entries across lists — existing
- ✓ Inspect pending changes before sync — existing
- ✓ Cronjob setup for scheduled automated sync — v1.0
- ✓ Reduced/formatted output suitable for email reports — v1.0
- ✓ Send sync reports via Postmark transactional email — v1.1
- ✓ Configure Postmark via environment variables — v1.1
- ✓ Graceful failure handling if email fails — v1.1
- ✓ Sync reports sent as HTML email with semantic formatting — v1.2
- ✓ Email from name displays as "Sportlink SYNC" — v1.2
- ✓ Clean cron output without npm script header — v1.2
- ✓ Install-cron overwrites existing cron entries (idempotent) — v1.2
- ✓ Sync creates/updates person in Stadion via WordPress REST API — v1.3
- ✓ Authenticate with Stadion via application password — v1.3
- ✓ Map Sportlink fields to Stadion ACF structure — v1.3
- ✓ Store Sportlink relatiecode as "KNVB ID" field in Stadion — v1.3
- ✓ Match members by KNVB ID first, email fallback — v1.3
- ✓ Hash-based change detection for Stadion sync — v1.3
- ✓ Sync parents as separate person records — v1.3
- ✓ Deduplicate parents across members — v1.3
- ✓ Add Stadion sync to sync-all pipeline — v1.3
- ✓ Include Stadion results in email report — v1.3
- ✓ Download photos from Sportlink when PersonImageDate indicates presence — v1.4
- ✓ Track PersonImageDate in SQLite for change detection — v1.4
- ✓ Navigate to member detail page and extract photo from modal — v1.4
- ✓ Save photos locally with PublicPersonId as filename — v1.4
- ✓ Upload photos to Stadion via REST API endpoint — v1.4
- ✓ Delete photos from local and Stadion when removed in Sportlink — v1.4
- ✓ Integrate photo sync into sync-all pipeline — v1.4
- ✓ Include photo sync statistics in email report — v1.4
- ✓ Extract team from Sportlink UnionTeams field (fallback to ClubTeams) — v1.5
- ✓ Create teams in Stadion if they don't exist — v1.5
- ✓ Add work_history entry to persons with team reference and "Speler" job title — v1.5
- ✓ Track team assignments in SQLite for change detection — v1.5
- ✓ Include team sync statistics in email report — v1.5
- ✓ Capture MemberHeader API response when fetching free fields — v1.7
- ✓ Extract HasFinancialTransferBlockOwnClub and sync to Stadion financiele-blokkade field — v1.7
- ✓ Extract Photo.Url and Photo.PhotoDate from MemberHeader response — v1.7
- ✓ Replace browser DOM photo scraping with direct URL fetch — v1.7
- ✓ Use PhotoDate for change detection to skip unchanged photos — v1.7
- ✓ Sync operations track origin (user edit vs sync-initiated) to prevent infinite loops — v2.0
- ✓ SQLite tracks modification timestamps in both directions (forward and reverse) — v2.0
- ✓ All timestamps normalized to UTC before comparison — v2.0
- ✓ System compares modification timestamps to determine last-edit-wins — v2.0
- ✓ Conflict resolution operates at field level, not whole record — v2.0
- ✓ Operator receives notification when conflicts are detected and resolved — v2.0
- ✓ System queries Stadion to detect members with modifications newer than Sportlink — v2.0
- ✓ Contact fields (email, email2, mobile, phone) sync from Stadion to Sportlink /general page — v2.0
- ✓ Free fields (datum-vog, freescout-id) sync from Stadion to Sportlink /other page — v2.0
- ✓ Financial block toggle syncs from Stadion to Sportlink /financial page — v2.0
- ✓ All reverse sync operations logged with timestamps and field values for audit — v2.0
- ✓ Email reports include reverse sync statistics (members updated, conflicts resolved) — v2.0
- ✓ Reverse sync runs on separate cron schedule (every 15 minutes) — v2.0

### Active

(None — ready for next milestone planning)

### Out of Scope

- Web UI — CLI tool is sufficient for operator use
- Real-time sync — scheduled batch sync is appropriate for member data
- Slack/Discord notifications — Email reports are sufficient for now
- Fallback to local mail — Postmark is reliable enough, no fallback needed
- Fail sync on email failure — Email is secondary to the actual sync operation
- Delete sync — Members removed from Sportlink stay in downstream systems
- Multiple team memberships — Members are on one team at a time per Sportlink
- Team history tracking — Only track current team assignment
- Team deletion sync — Teams persist in Stadion even if empty
- Parent team assignments — Parents don't have team data in Sportlink
- Three-way merge — Last-edit-wins is simpler and predictable
- Bidirectional photo sync — Photos only flow Sportlink → Stadion (correct design)
- Full bidirectional sync — Only specific fields sync back; Sportlink remains primary source

## Context

**Codebase:**
- ~17,500 lines of JavaScript + shell
- Node.js with Playwright for browser automation
- SQLite for state tracking (Laposta, Stadion, FreeScout, Nikki)
- Shell scripts for cron automation

**Tech stack:** Node.js 18+, Playwright/Chromium, SQLite, Bash, Postmark, WordPress REST API

**Server requirements:**
- Chromium (downloaded by Playwright) for Sportlink scraping
- Network access to club.sportlink.com, api.laposta.nl, api.postmarkapp.com, and Stadion WordPress site
- Credentials in `.env` file (Sportlink, Laposta, Postmark, Stadion)

## Constraints

- **Runtime**: Node.js 18+ with Playwright browser automation
- **Dependencies**: Requires Chromium for Sportlink scraping
- **Network**: Needs access to club.sportlink.com, api.laposta.nl, api.postmarkapp.com, and Stadion WordPress site
- **Credentials**: Sportlink username/password/OTP secret, Laposta API key, Postmark API key, and Stadion application password in `.env`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Browser automation for Sportlink | No API available, must scrape web interface | ✓ Good |
| SQLite for state tracking | Simple, no external database needed, portable | ✓ Good |
| Hash-based change detection | Avoids timestamp issues, reliable diff detection | ✓ Good |
| Dual-stream logger (stdout + file) | Simple logging, email-ready output | ✓ Good |
| Module/CLI hybrid pattern | Scripts work standalone and as imports | ✓ Good |
| Plain text summary format | Clean in email clients, no ANSI codes | ✓ Good |
| Cron timezone Europe/Amsterdam | Club operates in Amsterdam timezone | ✓ Good |
| Email in wrapper vs MAILTO | Enables custom subject lines | ✓ Good |
| flock-based locking | Prevents overlapping sync executions | ✓ Good |
| Postmark for email delivery | Reliable transactional email, doesn't land in spam | ✓ Good |
| Graceful email failure | Sync succeeds even if email fails | ✓ Good |
| Store credentials via upsert | BSD sed compatible, handles existing .env | ✓ Good |
| WordPress application password auth | Simpler than browser automation, native WordPress feature | ✓ Good |
| KNVB ID as primary match key | Stable identifier from Sportlink (relatiecode) | ✓ Good |
| Email fallback for matching | Handles members without KNVB ID in Stadion | ✓ Good |
| Parents as separate persons | Enables proper relationship modeling in Stadion | ✓ Good |
| Bidirectional relationship linking | Parent.children and child.parents arrays stay in sync | ✓ Good |
| Stadion sync non-critical | Pipeline continues if Stadion fails, Laposta is primary | ✓ Good |
| 2 second API rate limiting | Prevents WordPress timeout on slow servers | ✓ Good |
| Photo state CHECK constraint | Limits photo_state column to 6 valid states, prevents invalid states | ✓ Good |
| Empty string normalization to NULL | PersonImageDate empty strings normalized to null for SQL correctness | ✓ Good |
| Atomic state detection in ON CONFLICT | State transitions handled entirely in SQL ON CONFLICT clause | ✓ Good |
| COLLATE NOCASE on team_name | Prevents duplicate teams with different capitalization | ✓ Good |
| UnionTeams priority over ClubTeams | KNVB data more authoritative than club-assigned | ✓ Good |
| Track WordPress repeater field row indices | Enables targeting sync-created vs manual entries | ✓ Good |
| Preserve manual WordPress entries | Only modify sync-created work_history | ✓ Good |
| Composite unique key for work history | (knvb_id, team_name) prevents duplicates, enables change detection | ✓ Good |
| Team sync before work history | Work history references team IDs | ✓ Good |
| Non-critical team/work history sync | Prevents blocking Laposta or core Stadion sync | ✓ Good |
| MemberHeader API capture during /other page | Already fetched, no additional overhead | ✓ Good |
| INTEGER for has_financial_block | SQLite has no native boolean type | ✓ Good |
| Activity logging as non-blocking | Field sync is critical, activity is nice-to-have | ✓ Good |
| Store photo_url/photo_date in stadion_members | Avoids JOIN complexity, direct access | ✓ Good |
| HTTP photo fetch with 3-retry backoff | Resilience for transient network failures | ✓ Good |
| Photo sync integrated into people pipeline | Hourly vs daily, simpler cron (4 vs 5 jobs) | ✓ Good |
| Delete obsolete browser photo scripts | Clean architecture, ~400 lines removed | ✓ Good |
| Per-field timestamp tracking | 14 columns for 7 fields × 2 systems enables conflict detection | ✓ Good |
| 5-second clock drift tolerance | Prevents false conflicts from minor time differences | ✓ Good |
| NULL timestamps as "unknown" | Existing data predates tracking, don't backfill | ✓ Good |
| Sportlink wins on timestamp tie | Forward sync has precedence as Sportlink is source of truth | ✓ Good |
| Skip member on conflict failure | Individual errors shouldn't abort entire sync | ✓ Good |
| Plain text conflict summary | Existing email system (formatAsHtml) converts to HTML | ✓ Good |
| Playwright for reverse sync | Sportlink lacks API for member updates | ✓ Good |
| Verify field values after save | Catches silent failures in Sportlink forms | ✓ Good |
| Sequential processing with delay | Prevents rate limiting, 1-2s between members | ✓ Good |
| Exponential backoff retry | 3 attempts with jitter for flaky Sportlink UI | ✓ Good |
| Multi-page order general→other→financial | Consistent ordering for Sportlink navigation | ✓ Good |
| Fail-fast per member | If any page fails, skip entire member | ✓ Good |
| 15-minute reverse sync schedule | Balances responsiveness vs Sportlink load | ✓ Good |
| Separate lockfile per sync type | Allows parallel execution of different pipelines | ✓ Good |

---
*Last updated: 2026-01-29 after v2.0 milestone*
