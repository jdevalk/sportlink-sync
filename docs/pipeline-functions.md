# Functions Pipeline

Scrapes committee and club-level function memberships from Sportlink, creates commissie posts in Stadion WordPress, and links members to commissies via work history. Also scrapes free fields (FreeScout ID, VOG date, financial block) used by the People pipeline.

## Schedule

Runs on **two schedules**:

| Mode | Schedule | Command | Members Processed |
|------|----------|---------|-------------------|
| Recent | 4x daily (7:30, 10:30, 13:30, 16:30) | `scripts/sync.sh functions` | Only members with `LastUpdate` in last 2 days + VOG-filtered volunteers |
| Full | Weekly Sunday 1:00 AM | `scripts/sync.sh functions --all` | All tracked members (~1000+) |

The recent sync runs 30 minutes before each People sync to ensure fresh free fields are available.

```bash
scripts/sync.sh functions           # Recent updates (production)
scripts/sync.sh functions --all     # Full sync (production)
node pipelines/sync-functions.js --verbose    # Recent (direct)
node pipelines/sync-functions.js --all --verbose  # Full (direct)
```

## Pipeline Flow

```
pipelines/sync-functions.js
├── Step 1: steps/download-functions-from-sportlink.js   → stadion-sync.sqlite
│   ├── Scrape /functions tab (committees, club functions)
│   └── Scrape /other tab (free fields: FreeScout ID, VOG, financial block, photo URL)
├── Step 2: steps/submit-stadion-commissies.js           → Stadion WordPress API (commissies)
└── Step 3: steps/submit-stadion-commissie-work-history.js → Stadion WordPress API (person work_history)
```

## Step-by-Step Details

### Step 1: Download Functions from Sportlink

**Script:** `steps/download-functions-from-sportlink.js`
**Function:** `runFunctionsDownload({ logger, verbose, withInvoice, recentOnly, days })`

1. Launches headless Chromium via Playwright
2. Logs into Sportlink Club
3. Determines which members to process:
   - **Recent mode** (`recentOnly: true`, default): Only members with `LastUpdate` within the last N days (default 2), plus VOG-filtered volunteers from Stadion API
   - **Full mode** (`recentOnly: false`, `--all` flag): All tracked members from `stadion_members`
4. For each member, scrapes two pages:
   - **`/functions` tab**: Extracts committee memberships and club-level functions
     - Committee name, role, start/end dates, active status
     - Club functions (e.g., "Voorzitter", "Secretaris")
   - **`/other` tab**: Extracts free fields via two Sportlink APIs:
     - `MemberFreeFields` API: `Remarks3` (FreeScout ID), `Remarks8` (VOG date)
     - `MemberHeader` API: `HasFinancialTransferBlockOwnClub`, `Photo.Url`, `Photo.PhotoDate`
5. Stores data in `stadion-sync.sqlite`:
   - `sportlink_member_functions`: Club-level functions per member
   - `sportlink_member_committees`: Committee memberships per member
   - `sportlink_member_free_fields`: Free fields per member
6. **Table handling** differs by mode:
   - **Recent mode**: Upsert only (preserves existing data for members not in current run)
   - **Full mode**: Clear + replace atomically (fresh snapshot of all data)

**Output:** `{ success, total, functionsCount, committeesCount, errors }`

**Rate limiting:** 500ms-1.5s random jitter between member scrapes.

**Critical gotcha:** Never use clear+replace in recent mode. This was a bug that wiped data for members not in the current run, causing downstream hash mismatches. Fixed in commit `9d0136e`.

### Step 2: Sync Commissies to Stadion

**Script:** `steps/submit-stadion-commissies.js`
**Function:** `runSync({ logger, verbose, force, currentCommissieNames })`

1. Reads unique committee names from `sportlink_member_committees`
2. Creates a synthetic "Verenigingsbreed" commissie for club-level functions (not tied to a specific committee)
3. For each commissie where `source_hash != last_synced_hash`:
   - **No `stadion_id`**: `POST /wp/v2/commissies` (create new)
   - **Has `stadion_id`**: `PUT /wp/v2/commissies/{stadion_id}` (update)
4. Detects orphan commissies (in DB but not in current Sportlink data) and removes them
5. Updates `last_synced_hash` on success

**Output:** `{ total, synced, created, updated, skipped, deleted, errors }`

### Step 3: Sync Commissie Work History

**Script:** `steps/submit-stadion-commissie-work-history.js`
**Function:** `runSync({ logger, verbose, force })`

1. Reads committee memberships from `sportlink_member_committees` joined with `stadion_commissies` and `stadion_members`
2. Also reads club functions from `sportlink_member_functions` (mapped to "Verenigingsbreed" commissie)
3. Compares against `stadion_commissie_work_history` table
4. For each member with changes:
   - Fetches current `work_history` ACF repeater from Stadion
   - Adds new commissie assignments
   - Ends removed assignments (sets `is_current: false`)
   - Only modifies sync-created entries (manual entries preserved)
5. Sends `PUT /wp/v2/people/{stadion_id}` with updated `work_history`
6. Skips members without a `stadion_id`

**Output:** `{ total, synced, created, ended, skipped, errors }`

## Field Mappings

### Sportlink → Stadion Commissies

| Stadion Field | Source | Notes |
|---|---|---|
| `title` | Committee name | Post title |
| `status` | Hardcoded `publish` | Always published |

### Sportlink → Stadion Commissie Work History

| Repeater Field | Source | Notes |
|---|---|---|
| `team` | `stadion_commissies.stadion_id` | WordPress post ID of the commissie |
| `job_title` | `role_name` or "Lid" (fallback) | Role within committee |
| `is_current` | `is_active` from Sportlink | Based on `RelationEnd` and `Status` |
| `start_date` | `relation_start` | Normalized to YYYY-MM-DD |
| `end_date` | `relation_end` | Empty if current |

### Free Fields (Used by People Pipeline)

These are scraped during the functions pipeline but consumed by the People pipeline:

| Sportlink API | Sportlink Field | SQLite Column | Stadion ACF Field |
|---|---|---|---|
| `MemberFreeFields` | `Remarks3.Value` | `freescout_id` | `freescout-id` |
| `MemberFreeFields` | `Remarks8.Value` | `vog_datum` | `datum-vog` |
| `MemberHeader` | `HasFinancialTransferBlockOwnClub` | `has_financial_block` | `financiele-blokkade` |
| `MemberHeader` | `Photo.Url` | `photo_url` | *(used by photo download)* |
| `MemberHeader` | `Photo.PhotoDate` | `photo_date` | *(used by photo change detection)* |

## Database Tables Used

| Database | Table | Usage |
|---|---|---|
| `stadion-sync.sqlite` | `sportlink_member_functions` | Club-level functions per member |
| `stadion-sync.sqlite` | `sportlink_member_committees` | Committee memberships per member |
| `stadion-sync.sqlite` | `sportlink_member_free_fields` | Free fields (FreeScout ID, VOG, etc.) |
| `stadion-sync.sqlite` | `stadion_commissies` | Commissie → WordPress ID mapping |
| `stadion-sync.sqlite` | `stadion_commissie_work_history` | Tracks sync-created work history entries |
| `stadion-sync.sqlite` | `stadion_members` | KNVB ID → Stadion ID lookup |

## CLI Flags

| Flag | Effect |
|------|--------|
| `--verbose` | Detailed per-member logging |
| `--force` | Skip change detection |
| `--all` | Full sync (all members instead of recent only) |
| `--days N` | Override LastUpdate window (default: 2 days) |
| `--with-invoice` | Also scrape invoice data from /financial tab |

## Error Handling

- Individual member scrape failures don't stop the pipeline (error logged, member skipped)
- Commissie sync failures don't prevent work history sync
- Members without a `stadion_id` are skipped for work history
- All errors collected in summary report

## Source Files

| File | Purpose |
|------|---------|
| `pipelines/sync-functions.js` | Pipeline orchestrator |
| `steps/download-functions-from-sportlink.js` | Sportlink function/committee scraping (Playwright) |
| `steps/submit-stadion-commissies.js` | Stadion commissie API sync |
| `steps/submit-stadion-commissie-work-history.js` | Stadion commissie work history sync |
| `lib/stadion-db.js` | SQLite operations |
| `lib/stadion-client.js` | Stadion HTTP client |
| `lib/sportlink-login.js` | Sportlink authentication |
