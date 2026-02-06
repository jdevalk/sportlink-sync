# Roadmap: Sportlink Sync

## Milestones

- v1.0 through v2.2: See MILESTONES.md
- **v2.3 Birthday Field Migration** - Phase 33 (complete)

## v2.3 Birthday Field Migration

**Milestone Goal:** Replace the separate important_date post type birthday sync with a direct `acf.birthdate` field on the person CPT, simplifying the data model and removing an entire sync lifecycle.

### Phase 33: Birthday Field Migration
**Goal**: Birthdate syncs as an ACF field on the person record, replacing the separate important_date post lifecycle entirely
**Depends on**: Nothing (standalone migration within existing people pipeline)
**Requirements**: BDAY-01, BDAY-02, BDAY-03, BDAY-04
**Success Criteria** (what must be TRUE):
  1. Running `scripts/sync.sh people` populates `acf.birthdate` (Y-m-d format) on every person in Stadion that has a DateOfBirth in Sportlink
  2. The people pipeline no longer creates, updates, or deletes `important_date` posts for birthdays
  3. The `stadion_important_dates` table no longer exists (or is fully unused) in `stadion-sync.sqlite`
  4. Email report after a people sync shows birthdate sync results without a separate "Important Dates" section
**Plans**: 2 plans

Plans:
- [x] 33-01-PLAN.md — Add birthdate to person ACF payload and remove birthday sync step
- [x] 33-02-PLAN.md — Deprecate DB table and update docs/tools

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 33. Birthday Field Migration | v2.3 | 2/2 | Complete | 2026-02-06 |
