# Phase 7: Parent Sync - Context

**Gathered:** 2026-01-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync parents as separate person records in Stadion, deduplicated and linked to their children. Parents are extracted from Sportlink child records (NameParent1/2, EmailAddressParent1/2, TelephoneParent1/2) and created as standalone Stadion persons with bidirectional relationship links.

</domain>

<decisions>
## Implementation Decisions

### Parent Deduplication
- Reuse Laposta's deduplication logic — extract to shared module so both syncs use same code
- Email-based deduplication (same normalized email = same parent)
- First wins for name conflicts when same parent appears with different names
- Within-run deduplication (not persisted across runs)
- Skip parents with no email AND no phone — can't dedupe reliably

### Relationship Linking
- Bidirectional relationships: parent has children, child has parents
- Use whatever format the Stadion ACF relationship field expects (investigate API)
- Process children first, then parents — ensures children exist when creating parent links
- Preserve existing manual relationships — only add new relationships from Sportlink, don't remove existing ones

### Parent Field Mapping
- Sync: name (NameParent1/2), phone (TelephoneParent1/2), email, address (from child record)
- Set `isParent: true` custom field (user will add this field to Stadion)
- KNVB ID field: leave empty for parents (they're not members)
- Gender field: leave empty (data not available in Sportlink)

### Update Behavior
- Multiple phone numbers: collect all phones from different child records (API allows multiples)
- Hash-based change detection: same approach as members, skip unchanged parents
- Match existing parents by email only (no KNVB ID for parents)
- Delete orphan parents: remove parent records that no longer have linked children in Sportlink

### Claude's Discretion
- Exact implementation of shared deduplication module
- ACF relationship field format details
- Hash computation for parent change detection
- Order of operations within sync run

</decisions>

<specifics>
## Specific Ideas

- "Use the same logic as Laposta" — single source of truth for parent deduplication
- Stadion API allows multiple phone numbers per person — merge rather than pick one
- `isParent` custom field will be manually added to Stadion before sync runs

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-parent-sync*
*Context gathered: 2026-01-25*
