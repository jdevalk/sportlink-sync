# Phase 31: Sync Discipline Cases to Stadion - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Push downloaded discipline cases from SQLite to Stadion WordPress as `discipline-cases` custom post type. Link cases to persons via PublicPersonId mapping. Organize cases by season category derived from match date. This phase handles the sync code only — Stadion-side configuration (post type, ACF fields, taxonomy) is a separate concern.

</domain>

<decisions>
## Implementation Decisions

### Field Mapping
- Use lowercase-hyphenated field names matching existing Stadion patterns
- Keep ChargeDescription and SanctionDescription as separate ACF fields (`charge-description`, `sanction-description`)
- Store both AdministrativeFee (money amount) and IsCharged (boolean) fields
- Case title format: "Jan Jansen - JO11-1 vs Ajax - 2026-01-15" (person name + match description + date)

### Person Linking
- ACF relationship field named `person`
- Skip cases where PublicPersonId doesn't exist in Stadion yet (no orphan cases)
- Auto-retry on subsequent sync runs — case syncs once person exists
- Email report includes count of skipped cases due to missing persons

### Season Logic
- August 1 is the season boundary (July 31 = previous season, Aug 1 = new season)
- Season naming: full years format "2025-2026"
- Store season as WordPress category taxonomy (enables admin filtering, archive pages)
- Taxonomy slug: `seizoen` (Dutch, shareable with other post types)
- Auto-create season category if it doesn't exist

### Sync Behavior
- Update existing cases when data changes (DossierId as unique key)
- Hash-based change detection to avoid unnecessary API calls
- Track DossierId → stadion_id mapping in SQLite for reliable updates
- Use separate database file: `discipline-sync.sqlite`

### Claude's Discretion
- Exact field slug names (following lowercase-hyphenated pattern)
- Hash algorithm implementation (likely MD5 or SHA256)
- Rate limiting between API calls
- Error handling and retry logic

</decisions>

<specifics>
## Specific Ideas

- Follow existing sync patterns from submit-stadion-teams.js and submit-stadion-sync.js
- Match the hash-based change detection pattern used in other syncs
- Person title comes from Stadion lookup when linking (need to fetch person name)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

Stadion-side requirements (post type, ACF fields, taxonomy registration) documented separately in `31-STADION-REQUIREMENTS.md` for implementation in Stadion codebase.

</deferred>

---

*Phase: 31-sync-discipline-to-stadion*
*Context gathered: 2026-02-03*
