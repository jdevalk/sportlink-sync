# Stadion Requirements: Discipline Cases

**Purpose:** Define what needs to be configured in the Stadion WordPress codebase to support discipline case sync from Sportlink.

**Relationship:** This is a dependency for Phase 31 sync code. The sync script assumes these exist in Stadion.

---

## Custom Post Type

**Post Type:** `discipline-cases`

**Labels:**
- Singular: Tuchtzaak
- Plural: Tuchtzaken

**Supports:**
- title (formatted as: "Person Name - Match Description - Date")
- editor (optional, for notes)
- custom-fields (ACF)

---

## ACF Fields

All fields use lowercase-hyphenated naming to match existing Stadion patterns.

| Field Name | Field Type | Description | Required |
|------------|-----------|-------------|----------|
| `dossier-id` | Text | Unique case identifier from Sportlink (T-12345) | Yes |
| `person` | Relationship | Links to person post type (single value) | Yes |
| `match-date` | Date | Date of the match | Yes |
| `match-description` | Text | Match details (e.g., "JO11-1 vs Ajax") | Yes |
| `team-name` | Text | Team name from Sportlink | Yes |
| `charge-codes` | Text | Charge code(s) from KNVB | No |
| `charge-description` | Textarea | Full charge description | Yes |
| `sanction-description` | Textarea | Sanction/penalty description | Yes |
| `processing-date` | Date | Date case was processed | No |
| `administrative-fee` | Number | Fee amount in euros | No |
| `is-charged` | True/False | Whether fee was charged | No |

**Field Group:** "Discipline Case Details" assigned to post type `discipline-cases`

---

## Taxonomy

**Taxonomy:** `seizoen`

**Settings:**
- Hierarchical: No (like tags)
- Public: Yes
- Show in REST: Yes (required for sync API)

**Attached to:** `discipline-cases` (potentially shareable with other post types later)

**Expected Terms:**
- "2024-2025"
- "2025-2026"
- "2026-2027"
- (created automatically by sync when new seasons encountered)

---

## REST API Requirements

The sync script will use these endpoints:

### Create/Update Cases
```
POST /wp-json/wp/v2/discipline-cases
PUT /wp-json/wp/v2/discipline-cases/{id}
```

**Expected fields in request body:**
```json
{
  "title": "Jan Jansen - JO11-1 vs Ajax - 2026-01-15",
  "status": "publish",
  "seizoen": [123],
  "acf": {
    "dossier-id": "T-12345",
    "person": 456,
    "match-date": "2026-01-15",
    "match-description": "JO11-1 vs Ajax JO11-2",
    "team-name": "JO11-1",
    "charge-codes": "R2.3",
    "charge-description": "Wangedrag tegen scheidsrechter",
    "sanction-description": "1 wedstrijd schorsing",
    "processing-date": "2026-01-20",
    "administrative-fee": 25.00,
    "is-charged": true
  }
}
```

### Query by Dossier ID
```
GET /wp-json/wp/v2/discipline-cases?acf_dossier-id=T-12345
```

Or custom meta query if needed for lookup during sync.

### Create/Get Seasons
```
POST /wp-json/wp/v2/seizoen
GET /wp-json/wp/v2/seizoen?slug=2025-2026
```

---

## Implementation Notes

1. **ACF Pro required** — relationship fields and REST API integration need ACF Pro

2. **REST API exposure** — Ensure `show_in_rest` is true for:
   - `discipline-cases` post type
   - `seizoen` taxonomy
   - All ACF fields (via field group settings)

3. **Person relationship** — The `person` field links to existing person post type. Sync uses `stadion_id` from mapping table.

4. **No delete sync** — Cases persist in Stadion even if removed from Sportlink (historical record per requirements)

---

*Document for: Stadion codebase*
*Related phase: 31-sync-discipline-to-stadion*
*Created: 2026-02-03*
