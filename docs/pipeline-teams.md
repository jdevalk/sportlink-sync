# Teams Pipeline

Downloads team rosters from Sportlink, creates team posts in Stadion WordPress, and links members to teams via work history.

## Schedule

Runs **weekly** on Sunday at 6:00 AM (Amsterdam time).

```bash
scripts/sync.sh teams           # Production (with locking + email report)
node sync-teams.js --verbose    # Direct execution (verbose)
```

## Pipeline Flow

```
sync-teams.js
├── Step 1: download-teams-from-sportlink.js   → stadion-sync.sqlite
├── Step 2: submit-stadion-teams.js            → Stadion WordPress API (teams)
└── Step 3: submit-stadion-work-history.js     → Stadion WordPress API (person work_history)
```

## Step-by-Step Details

### Step 1: Download Teams from Sportlink

**Script:** `download-teams-from-sportlink.js`
**Function:** `runTeamDownload({ logger, verbose })`

1. Launches headless Chromium via Playwright
2. Logs into Sportlink Club
3. Calls Sportlink API to fetch team data:
   - `UnionTeams` (KNVB-assigned teams, preferred source)
   - `ClubTeams` (club-assigned teams, fallback)
4. For each team, fetches the team roster:
   - Players with their roles (Speler, Keeper, etc.)
   - Staff members with their roles (Trainer, Leider, etc.)
5. Stores team metadata in `stadion-sync.sqlite` → `stadion_teams`:
   - `team_name`, `sportlink_id`, `game_activity`, `gender`, `player_count`, `staff_count`
6. Stores team membership in `stadion-sync.sqlite` → `sportlink_team_members`:
   - `sportlink_team_id`, `sportlink_person_id`, `member_type` (player/staff), `role_description`

**Output:** `{ success, teamCount, memberCount }`

**Rate limiting:** 500ms-1.5s random jitter between member scrapes.

### Step 2: Sync Teams to Stadion

**Script:** `submit-stadion-teams.js`
**Function:** `runSync({ logger, verbose, force, currentSportlinkIds })`

1. Reads all teams from `stadion-sync.sqlite` → `stadion_teams`
2. For each team where `source_hash != last_synced_hash`:
   - **No `stadion_id`**: `POST /wp/v2/teams` (create new team)
   - **Has `stadion_id`**: `PUT /wp/v2/teams/{stadion_id}` (update existing)
3. Stores returned WordPress post ID as `stadion_id`
4. Updates `last_synced_hash` on success
5. Detects **orphan teams** (teams in Stadion DB but not in current Sportlink download) and optionally removes them

**Output:** `{ total, synced, created, updated, skipped, deleted, errors }`

**Team renames:** Uses `sportlink_id` as the conflict key, so renamed teams update the existing WordPress post instead of creating duplicates.

### Step 3: Sync Work History

**Script:** `submit-stadion-work-history.js`
**Function:** `runSync({ logger, verbose, force })`

1. Reads team membership from `sportlink_team_members` joined with `stadion_teams` and `stadion_members`
2. Compares current team assignments against `stadion_work_history` table
3. For each member with changes:
   - Fetches current `work_history` ACF repeater from Stadion
   - Adds new team assignments (creates new rows in the repeater)
   - Ends removed assignments (sets `is_current: false`, `end_date: today`)
   - Only modifies sync-created entries (manual entries are preserved)
4. Sends `PUT /wp/v2/people/{stadion_id}` with updated `work_history` repeater
5. Skips members without a `stadion_id`

**Output:** `{ total, synced, created, ended, skipped, errors }`

**Important:** The work history sync only touches entries it previously created (tracked via `stadion_work_history` table). Manually added work history entries in Stadion are left untouched.

## Field Mappings

### Sportlink → Stadion Teams

| Stadion Field | Sportlink Source | Notes |
|---|---|---|
| `title` | `TeamName` / `Name` | Post title |
| `acf.publicteamid` | `PublicTeamId` | Sportlink team identifier |
| `acf.activiteit` | `GameActivityDescription` | "Veld" or "Zaal" |
| `acf.gender` | `Gender` | Mannen→male, Vrouwen→female, Gemengd→skipped |

### Sportlink → Stadion Work History

The ACF `work_history` is a repeater field on person posts:

| Repeater Field | Source | Notes |
|---|---|---|
| `team` | `stadion_teams.stadion_id` | WordPress post ID of the team |
| `job_title` | `role_description` or fallback | "Speler", "Keeper", "Trainer", "Staflid" |
| `is_current` | Computed | `true` if currently on team |
| `start_date` | Computed | Today for new assignments, empty for backfill |
| `end_date` | Computed | Empty if current, today when removed |

## Database Tables Used

| Database | Table | Usage |
|---|---|---|
| `stadion-sync.sqlite` | `stadion_teams` | Team → WordPress ID mapping + metadata |
| `stadion-sync.sqlite` | `sportlink_team_members` | Raw team roster data from Sportlink |
| `stadion-sync.sqlite` | `stadion_work_history` | Tracks which work_history entries sync created |
| `stadion-sync.sqlite` | `stadion_members` | KNVB ID → Stadion ID lookup (for work history) |

## CLI Flags

| Flag | Effect |
|------|--------|
| `--verbose` | Detailed per-team/per-member logging |
| `--force` | Skip change detection, sync all teams and work history |

## Error Handling

- Team download failure doesn't prevent team sync (uses cached data)
- Individual team sync failures don't stop the pipeline
- Work history sync skips members not yet in Stadion (counted as `skipped`)
- All errors collected in summary report

## Source Files

| File | Purpose |
|------|---------|
| `sync-teams.js` | Pipeline orchestrator |
| `download-teams-from-sportlink.js` | Sportlink team scraping (Playwright) |
| `submit-stadion-teams.js` | Stadion team API sync |
| `submit-stadion-work-history.js` | Stadion work history API sync |
| `prepare-stadion-teams.js` | Team data preparation |
| `lib/stadion-db.js` | SQLite operations |
| `lib/stadion-client.js` | Stadion HTTP client |
| `lib/sportlink-login.js` | Sportlink authentication |
