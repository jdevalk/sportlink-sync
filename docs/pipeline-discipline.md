# Discipline Pipeline

Downloads discipline (tucht) cases from Sportlink and syncs them to Stadion WordPress as `discipline_case` posts linked to person records.

## Schedule

Runs **weekly** on Monday at 11:30 PM (Amsterdam time).

```bash
scripts/sync.sh discipline           # Production (with locking + email report)
node pipelines/sync-discipline.js --verbose    # Direct execution (verbose)
```

## Pipeline Flow

```
pipelines/sync-discipline.js
├── Step 1: steps/download-discipline-cases.js       → stadion-sync.sqlite
└── Step 2: steps/submit-stadion-discipline.js       → Stadion WordPress API
```

## Step-by-Step Details

### Step 1: Download Discipline Cases

**Script:** `steps/download-discipline-cases.js`
**Function:** `runDownload({ logger, verbose })`

1. Launches headless Chromium via Playwright
2. Logs into Sportlink Club
3. Navigates to the discipline cases section
4. Scrapes case data from the Sportlink interface
5. For each case, extracts:
   - `dossier_id` (unique case identifier, e.g., "T-12345")
   - `public_person_id` (KNVB ID of the person involved)
   - `match_date`, `match_description`, `team_name`
   - `charge_codes`, `charge_description`
   - `sanction_description`, `processing_date`
   - `administrative_fee`, `is_charged`
6. Computes `source_hash` per case
7. Upserts into `stadion-sync.sqlite` → `discipline_cases` table

**Output:** `{ success, caseCount }`

### Step 2: Sync Cases to Stadion

**Script:** `steps/submit-stadion-discipline.js`
**Function:** `runSync({ logger, verbose, force })`

1. Reads cases from `stadion-sync.sqlite` → `discipline_cases`
2. Looks up `stadion_id` for each case's `public_person_id` from `stadion_members`
3. Gets or creates the season taxonomy term (e.g., "2025-2026"):
   - `GET /wp/v2/seizoen?slug=2025-2026`
   - If not found: `POST /wp/v2/seizoen`
4. For each case:
   - Checks if case already exists: `GET /wp/v2/discipline-cases?meta_key=dossier_id&meta_value=T-12345`
   - **New case**: `POST /wp/v2/discipline-cases`
   - **Existing case**: `PUT /wp/v2/discipline-cases/{id}`
   - Links to person via `acf.person` (Post Object field, single integer ID)
5. Cases without a matching person are skipped (counted as `skipped_no_person`)

**Output:** `{ total, synced, created, updated, skipped, skipped_no_person, errors }`

## Field Mappings

### Sportlink → Stadion Discipline Cases

**Post type:** `discipline_case`
**REST endpoint:** `wp/v2/discipline-cases`

| Stadion ACF Field | SQLite Column | Type | Notes |
|---|---|---|---|
| `dossier_id` | `dossier_id` | Text | Unique case ID (e.g., T-12345). Has server-side uniqueness validation. |
| `person` | → `stadion_members.stadion_id` | Post Object | Single integer ID (not array). Looked up via `public_person_id`. |
| `match_date` | `match_date` | Date Picker | Returns `Ymd` format (e.g., "20260115") |
| `match_description` | `match_description` | Text | e.g., "JO11-1 vs Ajax JO11-2" |
| `team_name` | `team_name` | Text | Team name from Sportlink |
| `charge_codes` | `charge_codes` | Text | KNVB charge code (e.g., "R2.3") |
| `charge_description` | `charge_description` | Textarea | Full charge description |
| `sanction_description` | `sanction_description` | Textarea | Penalty/sanction description |
| `processing_date` | `processing_date` | Date Picker | `Ymd` format |
| `administrative_fee` | `administrative_fee` | Number | Fee in euros (e.g., 25.00) |
| `is_charged` | `is_charged` | True/False | Whether fee was charged ("Is doorbelast") |

### Taxonomy

**Taxonomy:** `seizoen` (non-hierarchical, like tags)
- Used to categorize cases by season (e.g., "2025-2026")
- Created automatically when new seasons are encountered
- Term meta `is_current_season` marks the active season

### Post Title

Generated as: `"{person_name} - {match_description} - {match_date}"`

## Database Tables Used

| Database | Table | Usage |
|---|---|---|
| `stadion-sync.sqlite` | `discipline_cases` | Case data + dossier_id (unique key) |
| `stadion-sync.sqlite` | `stadion_members` | KNVB ID → Stadion ID lookup (for person linking) |

## Stadion WordPress Requirements

- **ACF Pro** (for Post Object fields and REST API integration)
- **Custom post type:** `discipline_case` with `show_in_rest = true`
- **Taxonomy:** `seizoen` with `show_in_rest = true`
- **Capability:** `fairplay` - only users with this capability can view cases in the UI
- All ACF fields must have `show_in_rest = true`
- `person` field uses **Post Object** type (returns single integer, not array)
- `dossier_id` has server-side uniqueness validation

## CLI Flags

| Flag | Effect |
|------|--------|
| `--verbose` | Detailed per-case logging |
| `--force` | Skip change detection, sync all cases |

## Error Handling

- Download failure is logged but doesn't prevent sync of previously downloaded cases
- Cases without a matching person in Stadion are skipped (not an error)
- Individual case sync failures don't stop the pipeline
- All errors collected in summary report

## Source Files

| File | Purpose |
|------|---------|
| `pipelines/sync-discipline.js` | Pipeline orchestrator |
| `steps/download-discipline-cases.js` | Sportlink discipline case scraping (Playwright) |
| `steps/submit-stadion-discipline.js` | Stadion discipline case API sync |
| `lib/discipline-db.js` | Discipline SQLite operations |
| `lib/stadion-db.js` | Stadion member ID lookup |
| `lib/stadion-client.js` | Stadion HTTP client |
| `lib/sportlink-login.js` | Sportlink authentication |
