# Database Schema Documentation

This document provides complete schema documentation for all three SQLite databases used by sportlink-sync.

## Table of Contents

- [Overview](#overview)
- [Change Detection Pattern](#change-detection-pattern)
- [Database 1: laposta-sync.sqlite](#database-1-laposta-syncsqlite)
- [Database 2: stadion-sync.sqlite](#database-2-stadion-syncsqlite)
- [Database 3: nikki-sync.sqlite](#database-3-nikki-syncsqlite)
- [Photo State Machine](#photo-state-machine)
- [Key Relationships](#key-relationships)

---

## Overview

The sportlink-sync system uses three SQLite databases to track sync state between Sportlink Club (source) and downstream systems (Laposta, Stadion WordPress, Nikki).

**Critical:** These databases must only exist on the production server. Running sync from a local machine creates duplicate entries because each machine tracks its own `stadion_id` mappings.

### Database Locations

- `laposta-sync.sqlite` - Tracks Laposta email list synchronization
- `stadion-sync.sqlite` - Tracks Stadion WordPress synchronization
- `nikki-sync.sqlite` - Tracks Nikki contribution data

All databases are stored in the project root directory on the server at `/home/sportlink/`.

---

## Change Detection Pattern

All three databases use **hash-based change detection** to minimize API calls and avoid redundant updates.

### How It Works

Each trackable record has two hash fields:

- **`source_hash`** - SHA-256 hash of current data from Sportlink
- **`last_synced_hash`** - Hash of data last successfully synced to destination

### Sync Logic

```javascript
// Only sync if data has changed
WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
```

**On successful sync:** `last_synced_hash` is updated to match `source_hash`

**Benefits:**
- Idempotent: Can re-run sync without duplicate API calls
- Efficient: Only sends changed data
- Recoverable: Failed syncs leave `last_synced_hash` unchanged, will retry next run

---

## Database 1: laposta-sync.sqlite

**Purpose:** Tracks email list synchronization between Sportlink and Laposta marketing platform.

**Module:** `laposta-db.js`

### Tables

#### sportlink_runs

Stores raw JSON results from each Sportlink Club download for audit trail.

| Column        | Type    | Description                                    |
|---------------|---------|------------------------------------------------|
| id            | INTEGER | Primary key (auto-increment)                   |
| created_at    | TEXT    | ISO timestamp of download                      |
| results_json  | TEXT    | Complete JSON results from Sportlink download  |

**Purpose:** Historical record of all Sportlink downloads. Used for debugging and data recovery.

**Indexes:** None (append-only table)

---

#### laposta_fields

Caches Laposta list custom field definitions to avoid repeated API calls.

| Column        | Type    | Description                                                  |
|---------------|---------|--------------------------------------------------------------|
| list_id       | TEXT    | Laposta list ID (LAPOSTA_LIST env var)                       |
| field_id      | TEXT    | Laposta field ID (returned from API)                         |
| custom_name   | TEXT    | Field tag/name (e.g., "voornaam", "achternaam")              |
| datatype      | TEXT    | Field data type (text, numeric, select)                      |
| required      | INTEGER | 1 = required field, 0 = optional                             |
| options_json  | TEXT    | JSON array of select options (for dropdown fields)           |
| updated_at    | TEXT    | Last cache refresh timestamp                                 |

**Primary Key:** `(list_id, field_id)`

**Purpose:** Field metadata cache. Reduces API calls when preparing member data for sync.

**Indexes:** Primary key only

---

#### members

Central table tracking all members across up to 4 Laposta lists.

| Column                           | Type    | Description                                                    |
|----------------------------------|---------|----------------------------------------------------------------|
| id                               | INTEGER | Primary key (auto-increment)                                   |
| list_index                       | INTEGER | Which list: 0=LAPOSTA_LIST, 1=LAPOSTA_LIST2, 2=LAPOSTA_LIST3, 3=LAPOSTA_LIST4 |
| list_id                          | TEXT    | Laposta list ID (UUID)                                         |
| email                            | TEXT    | Member email address (primary identifier)                      |
| custom_fields_json               | TEXT    | JSON object of current custom field values                     |
| source_hash                      | TEXT    | SHA-256 hash of email + custom_fields (current state)          |
| last_seen_at                     | TEXT    | Last time member appeared in Sportlink data                    |
| last_synced_at                   | TEXT    | Last successful sync to Laposta                                |
| last_synced_hash                 | TEXT    | Hash of last synced data (compare to source_hash)              |
| last_synced_custom_fields_json   | TEXT    | Previous custom_fields JSON (for diff display)                 |
| created_at                       | TEXT    | First seen timestamp                                           |

**Unique Constraint:** `(list_index, email)` - Each email appears once per list

**Indexes:**
- `idx_members_list_hash` on `(list_index, source_hash, last_synced_hash)` - Optimizes sync queries

**Purpose:** Tracks member state for up to 4 lists. Enables incremental sync by comparing hashes.

**Example Query:**
```sql
-- Get members needing sync for list 0
SELECT email, custom_fields_json, source_hash
FROM members
WHERE list_index = 0
  AND (last_synced_hash IS NULL OR last_synced_hash != source_hash);
```

---

## Database 2: stadion-sync.sqlite

**Purpose:** Tracks WordPress Stadion synchronization including members, parents, teams, committees, work history, and photos.

**Module:** `lib/stadion-db.js`

### Tables

#### stadion_members

Primary member/person records synced to WordPress.

| Column                 | Type    | Description                                                        |
|------------------------|---------|--------------------------------------------------------------------|
| id                     | INTEGER | Primary key (auto-increment)                                       |
| knvb_id                | TEXT    | KNVB public person ID (primary identifier) - UNIQUE                |
| stadion_id             | INTEGER | WordPress post ID (for updates/deletes)                            |
| email                  | TEXT    | Member email address                                               |
| data_json              | TEXT    | Full member data as JSON (all fields for WordPress API)            |
| source_hash            | TEXT    | SHA-256 hash of knvb_id + data (current state)                     |
| last_seen_at           | TEXT    | Last time member appeared in Sportlink data                        |
| last_synced_at         | TEXT    | Last successful sync to Stadion                                    |
| last_synced_hash       | TEXT    | Hash of last synced data                                           |
| created_at             | TEXT    | First seen timestamp                                               |
| person_image_date      | TEXT    | Date of photo in Sportlink (for change detection)                  |
| photo_state            | TEXT    | Photo sync state: no_photo, pending_download, downloaded, pending_upload, synced, pending_delete |
| photo_state_updated_at | TEXT    | When photo state last changed                                      |

**Unique Constraint:** `knvb_id` (one record per KNVB ID)

**Indexes:**
- `idx_stadion_members_hash` on `(source_hash, last_synced_hash)`
- `idx_stadion_members_email` on `(email)`

**Critical Field:** `stadion_id` maps KNVB ID to WordPress post ID. Without this mapping, sync creates duplicates instead of updates.

---

#### stadion_parents

Parent/guardian records (have no KNVB ID, identified by email only).

| Column           | Type    | Description                                              |
|------------------|---------|----------------------------------------------------------|
| id               | INTEGER | Primary key (auto-increment)                             |
| email            | TEXT    | Parent email (primary identifier) - UNIQUE               |
| stadion_id       | INTEGER | WordPress post ID                                        |
| data_json        | TEXT    | Parent data + childKnvbIds array as JSON                 |
| source_hash      | TEXT    | SHA-256 hash of email + data                             |
| last_seen_at     | TEXT    | Last time parent appeared in Sportlink data              |
| last_synced_at   | TEXT    | Last successful sync to Stadion                          |
| last_synced_hash | TEXT    | Hash of last synced data                                 |
| created_at       | TEXT    | First seen timestamp                                     |

**Unique Constraint:** `email` (one record per parent email)

**Indexes:**
- `idx_stadion_parents_hash` on `(source_hash, last_synced_hash)`

**Note:** Parents have no KNVB ID. Email is the stable identifier. `data_json` includes `childKnvbIds` array for parent-child relationships.

---

#### stadion_important_dates

Birth dates and other important dates synced to Stadion.

| Column           | Type    | Description                                          |
|------------------|---------|------------------------------------------------------|
| id               | INTEGER | Primary key (auto-increment)                         |
| knvb_id          | TEXT    | Member KNVB ID                                       |
| date_type        | TEXT    | Date type (e.g., "birth_date")                       |
| date_value       | TEXT    | Date value (YYYY-MM-DD format)                       |
| stadion_date_id  | INTEGER | WordPress important_date post ID                     |
| source_hash      | TEXT    | SHA-256 hash of knvb_id + date_type + date_value    |
| last_synced_hash | TEXT    | Hash of last synced data                             |
| last_synced_at   | TEXT    | Last successful sync                                 |
| created_at       | TEXT    | First seen timestamp                                 |

**Unique Constraint:** `(knvb_id, date_type)` - One date per type per member

**Indexes:**
- `idx_stadion_important_dates_sync` on `(source_hash, last_synced_hash)`

**Purpose:** Tracks birth dates synced as WordPress important_date custom post type.

---

#### stadion_teams

Team records from Sportlink (e.g., "JO13-1", "Senioren Heren 2").

| Column           | Type    | Description                                              |
|------------------|---------|----------------------------------------------------------|
| id               | INTEGER | Primary key (auto-increment)                             |
| team_name        | TEXT    | Team name (case-insensitive via COLLATE NOCASE)          |
| sportlink_id     | TEXT    | Sportlink team ID - UNIQUE (handles team renames)        |
| stadion_id       | INTEGER | WordPress team post ID                                   |
| source_hash      | TEXT    | SHA-256 hash of team data                                |
| last_seen_at     | TEXT    | Last time team appeared in Sportlink                     |
| last_synced_at   | TEXT    | Last successful sync to Stadion                          |
| last_synced_hash | TEXT    | Hash of last synced data                                 |
| created_at       | TEXT    | First seen timestamp                                     |
| game_activity    | TEXT    | Game type: "Veld" or "Zaal"                              |
| gender           | TEXT    | M/V/Mixed                                                |
| player_count     | INTEGER | Number of players on team                                |
| staff_count      | INTEGER | Number of staff members                                  |

**Unique Constraint:** `sportlink_id` (handles team renames correctly)

**Indexes:**
- `idx_stadion_teams_hash` on `(source_hash, last_synced_hash)`
- `idx_stadion_teams_name` on `(team_name COLLATE NOCASE)`

**Team Renames:** Uses `sportlink_id` as conflict key so renamed teams update existing WordPress post instead of creating duplicates.

---

#### stadion_work_history

Member-team assignments (work history in WordPress).

| Column                   | Type    | Description                                              |
|--------------------------|---------|----------------------------------------------------------|
| id                       | INTEGER | Primary key (auto-increment)                             |
| knvb_id                  | TEXT    | Member KNVB ID                                           |
| team_name                | TEXT    | Team name                                                |
| stadion_work_history_id  | INTEGER | WordPress work_history row index                         |
| is_backfill              | INTEGER | 1 if from historical backfill, 0 if current              |
| source_hash              | TEXT    | SHA-256 hash of knvb_id + team_name                      |
| last_synced_hash         | TEXT    | Hash of last synced data                                 |
| last_synced_at           | TEXT    | Last successful sync                                     |
| created_at               | TEXT    | First seen timestamp                                     |

**Unique Constraint:** `(knvb_id, team_name)` - Each member can appear once per team

**Indexes:**
- `idx_stadion_work_history_member` on `(knvb_id)`

**Purpose:** Tracks which teams each member has been on. Synced to WordPress ACF repeater field.

---

#### sportlink_team_members

Raw team membership data from Sportlink (player/staff roles).

| Column               | Type    | Description                                          |
|----------------------|---------|------------------------------------------------------|
| id                   | INTEGER | Primary key (auto-increment)                         |
| sportlink_team_id    | TEXT    | Sportlink team ID                                    |
| sportlink_person_id  | TEXT    | Sportlink person ID (KNVB ID)                        |
| member_type          | TEXT    | "player" or "staff"                                  |
| role_description     | TEXT    | Role: "Trainer", "Keeper", "Speler", etc.            |
| source_hash          | TEXT    | SHA-256 hash of record                               |
| last_seen_at         | TEXT    | Last time membership appeared in Sportlink           |
| created_at           | TEXT    | First seen timestamp                                 |

**Unique Constraint:** `(sportlink_team_id, sportlink_person_id)` - Each person appears once per team

**Indexes:**
- `idx_sportlink_team_members_person` on `(sportlink_person_id)`
- `idx_sportlink_team_members_team` on `(sportlink_team_id)`

**Purpose:** Raw Sportlink team roster data. Used to determine roles when syncing work history.

---

#### stadion_commissies

Committee records (e.g., "Jeugdcommissie", "Technische commissie").

| Column           | Type    | Description                                          |
|------------------|---------|------------------------------------------------------|
| id               | INTEGER | Primary key (auto-increment)                         |
| commissie_name   | TEXT    | Committee name - UNIQUE                              |
| sportlink_id     | TEXT    | Sportlink committee ID - UNIQUE                      |
| stadion_id       | INTEGER | WordPress commissie post ID                          |
| source_hash      | TEXT    | SHA-256 hash of commissie data                       |
| last_seen_at     | TEXT    | Last time committee appeared in Sportlink            |
| last_synced_at   | TEXT    | Last successful sync to Stadion                      |
| last_synced_hash | TEXT    | Hash of last synced data                             |
| created_at       | TEXT    | First seen timestamp                                 |

**Unique Constraints:**
- `commissie_name`
- `sportlink_id`

**Indexes:**
- `idx_stadion_commissies_hash` on `(source_hash, last_synced_hash)`
- `idx_stadion_commissies_name` on `(commissie_name)`

---

#### sportlink_member_functions

Club-level functions (e.g., "Voorzitter", "Secretaris") held by members.

| Column               | Type    | Description                                      |
|----------------------|---------|--------------------------------------------------|
| id                   | INTEGER | Primary key (auto-increment)                     |
| knvb_id              | TEXT    | Member KNVB ID                                   |
| function_description | TEXT    | Function name (e.g., "Voorzitter")               |
| relation_start       | TEXT    | Start date of function                           |
| relation_end         | TEXT    | End date (NULL = current/active)                 |
| is_active            | INTEGER | 1 = currently active, 0 = ended                  |
| source_hash          | TEXT    | SHA-256 hash of function record                  |
| last_seen_at         | TEXT    | Last time function appeared in Sportlink         |
| created_at           | TEXT    | First seen timestamp                             |

**Unique Constraint:** `(knvb_id, function_description)` - Each member can have each function once

**Indexes:**
- `idx_sportlink_member_functions_knvb` on `(knvb_id)`

**Purpose:** Tracks board positions and club-level roles.

---

#### sportlink_member_committees

Committee memberships with roles (e.g., "Lid" of "Jeugdcommissie").

| Column                  | Type    | Description                                      |
|-------------------------|---------|--------------------------------------------------|
| id                      | INTEGER | Primary key (auto-increment)                     |
| knvb_id                 | TEXT    | Member KNVB ID                                   |
| committee_name          | TEXT    | Committee name                                   |
| sportlink_committee_id  | TEXT    | Sportlink committee ID                           |
| role_name               | TEXT    | Role within committee (e.g., "Voorzitter")       |
| relation_start          | TEXT    | Start date of membership                         |
| relation_end            | TEXT    | End date (NULL = current)                        |
| is_active               | INTEGER | 1 = active, 0 = ended                            |
| source_hash             | TEXT    | SHA-256 hash of membership record                |
| last_seen_at            | TEXT    | Last time membership appeared in Sportlink       |
| created_at              | TEXT    | First seen timestamp                             |

**Unique Constraint:** `(knvb_id, committee_name)` - Each member can be on each committee once

**Indexes:**
- `idx_sportlink_member_committees_knvb` on `(knvb_id)`

**Purpose:** Raw committee membership data from Sportlink.

---

#### stadion_commissie_work_history

Work history for committee memberships (synced to WordPress).

| Column                   | Type    | Description                                      |
|--------------------------|---------|--------------------------------------------------|
| id                       | INTEGER | Primary key (auto-increment)                     |
| knvb_id                  | TEXT    | Member KNVB ID                                   |
| commissie_name           | TEXT    | Committee name                                   |
| role_name                | TEXT    | Role in committee (optional)                     |
| stadion_work_history_id  | INTEGER | WordPress work_history row index                 |
| is_backfill              | INTEGER | 1 if from historical backfill, 0 if current      |
| source_hash              | TEXT    | SHA-256 hash of work history record              |
| last_synced_hash         | TEXT    | Hash of last synced data                         |
| last_synced_at           | TEXT    | Last successful sync                             |
| created_at               | TEXT    | First seen timestamp                             |

**Unique Constraint:** `(knvb_id, commissie_name, role_name)` - Each member/committee/role combination once

**Indexes:**
- `idx_stadion_commissie_work_history_member` on `(knvb_id)`

**Purpose:** Committee membership history synced to WordPress ACF repeater field.

---

#### sportlink_member_free_fields

Free fields from Sportlink /other tab (FreeScout ID, VOG certificate date).

| Column        | Type    | Description                                          |
|---------------|---------|------------------------------------------------------|
| id            | INTEGER | Primary key (auto-increment)                         |
| knvb_id       | TEXT    | Member KNVB ID - UNIQUE                              |
| freescout_id  | INTEGER | FreeScout customer ID (for support system)           |
| vog_datum     | TEXT    | VOG (criminal record check) certificate date         |
| source_hash   | TEXT    | SHA-256 hash of free fields                          |
| last_seen_at  | TEXT    | Last time fields appeared in Sportlink               |
| created_at    | TEXT    | First seen timestamp                                 |

**Unique Constraint:** `knvb_id`

**Indexes:**
- `idx_sportlink_member_free_fields_knvb` on `(knvb_id)`

**Purpose:** Additional member metadata from Sportlink's "other" tab.

---

## Database 3: nikki-sync.sqlite

**Purpose:** Tracks member contribution/dues data from Nikki accounting system.

**Module:** `lib/nikki-db.js`

### Tables

#### nikki_contributions

Member contribution records per year.

| Column       | Type    | Description                                              |
|--------------|---------|----------------------------------------------------------|
| id           | INTEGER | Primary key (auto-increment)                             |
| knvb_id      | TEXT    | Member KNVB ID                                           |
| year         | INTEGER | Contribution year                                        |
| nikki_id     | TEXT    | Nikki system ID                                          |
| saldo        | REAL    | Outstanding balance (positive = owes money)              |
| status       | TEXT    | Payment status                                           |
| source_hash  | TEXT    | SHA-256 hash of contribution record                      |
| last_seen_at | TEXT    | Last time contribution appeared in Nikki data            |
| created_at   | TEXT    | First seen timestamp                                     |

**Unique Constraint:** `(knvb_id, year)` - One contribution record per member per year

**Indexes:**
- `idx_nikki_contributions_knvb_id` on `(knvb_id)`
- `idx_nikki_contributions_year` on `(year)`
- `idx_nikki_contributions_saldo` on `(saldo)`

**Purpose:** Tracks member financial contributions. Used for financial reports and outstanding balance queries.

**Example Query:**
```sql
-- Get members with outstanding balance
SELECT knvb_id, year, saldo, status
FROM nikki_contributions
WHERE saldo > 0
ORDER BY saldo DESC;
```

---

## Photo State Machine

The `stadion_members.photo_state` field implements a state machine for photo synchronization.

### States

| State             | Description                                              |
|-------------------|----------------------------------------------------------|
| `no_photo`        | Member has no photo in Sportlink                         |
| `pending_download`| Photo exists in Sportlink, needs to be downloaded        |
| `downloaded`      | Photo downloaded to local filesystem                     |
| `pending_upload`  | Photo ready to be uploaded to Stadion                    |
| `synced`          | Photo successfully uploaded to Stadion                   |
| `pending_delete`  | Photo removed from Sportlink, needs deletion from Stadion|

### State Transitions

```
no_photo → pending_download  (photo added in Sportlink)
pending_download → downloaded (photo downloaded successfully)
downloaded → pending_upload   (ready for upload)
pending_upload → synced       (upload successful)
synced → pending_delete       (photo removed from Sportlink)
pending_delete → no_photo     (deletion successful)
synced → pending_download     (photo changed in Sportlink)
```

### Change Detection

Photo changes are detected by comparing `person_image_date`:
- **Added:** `person_image_date` changes from NULL to a date
- **Changed:** `person_image_date` changes to a different date
- **Removed:** `person_image_date` changes to NULL

The state machine ensures reliable photo sync even if process is interrupted.

---

## Key Relationships

### Member Identification

**Primary identifier:** `knvb_id` (KNVB public person ID)
- Used across all systems
- Stable over time
- Links members to teams, committees, contributions

**Parent identification:** `email` (no KNVB ID for parents)
- Parents identified solely by email
- Linked to children via `childKnvbIds` array in `data_json`

### Cross-Database Relationships

#### Member → Laposta Lists
```sql
-- Find member in laposta database by email
SELECT * FROM members WHERE email = 'member@example.com';
```

#### Member → Stadion WordPress
```sql
-- Get WordPress post ID for member
SELECT stadion_id FROM stadion_members WHERE knvb_id = 'KNVB123456';
```

#### Member → Nikki Contributions
```sql
-- Get all contributions for member
SELECT * FROM nikki_contributions WHERE knvb_id = 'KNVB123456' ORDER BY year DESC;
```

### Intra-Database Relationships (stadion-sync.sqlite)

#### Member → Teams
```sql
-- Get all teams for a member
SELECT team_name FROM stadion_work_history WHERE knvb_id = 'KNVB123456';
```

#### Member → Committees
```sql
-- Get all committee memberships for a member
SELECT committee_name, role_name FROM sportlink_member_committees WHERE knvb_id = 'KNVB123456';
```

#### Team → Members
```sql
-- Get all members on a team
SELECT sportlink_person_id, member_type, role_description
FROM sportlink_team_members
WHERE sportlink_team_id = 'TEAM_ID';
```

#### Parent → Children
```sql
-- Get children for parent (requires parsing data_json)
SELECT data_json FROM stadion_parents WHERE email = 'parent@example.com';
-- childKnvbIds is in the JSON
```

---

## Summary Statistics

| Database | Tables | Purpose |
|----------|--------|---------|
| laposta-sync.sqlite | 3 | Email marketing sync (Laposta) |
| stadion-sync.sqlite | 11 | WordPress sync (members, teams, committees, photos) |
| nikki-sync.sqlite | 1 | Contribution tracking (Nikki accounting) |

**Total:** 15 tables across 3 databases

**Common Pattern:** All tables use `source_hash` / `last_synced_hash` for efficient change detection and idempotent sync operations.
