# Roadmap: Rondo Sync

## Milestones

- ✅ **v1.0 MVP** — Phases 1-2 (shipped 2026-01-24)
- ✅ **v1.1 Postmark Email** — Phase 3 (shipped 2026-01-25)
- ✅ **v1.2 Email Polish** — Phase 4 (shipped 2026-01-25)
- ✅ **v1.3 Connect to Rondo Club** — Phases 5-8 (shipped 2026-01-25)
- ✅ **v1.4 Photo Sync** — Phases 9-12 (shipped 2026-01-26)
- ✅ **v1.5 Team Sync** — Phases 13-15 (shipped 2026-01-26)
- ✅ **v1.7 MemberHeader API** — Phases 17-19 (shipped 2026-01-28)
- ✅ **v2.0 Bidirectional Sync** — Phases 20-26 (shipped 2026-01-29)
- ✅ **v2.1 Nikki Import** — Phases 27-29 (shipped 2026-02-02)
- ✅ **v2.2 Discipline Cases** — Phases 30-32 (shipped 2026-02-03)
- ✅ **v2.3 Birthday Migration** — Phase 33 (shipped 2026-02-06)
- ✅ **v3.0 Web Dashboard** — Phases 34-38 (shipped 2026-02-09)
- ✅ **v3.1 Fetch Former Members** — Phase 40 (shipped 2026-02-09)
- ✅ **v3.2 Stadion-to-Rondo Rename** — Phases 41-43 (shipped 2026-02-11)
- 🚧 **v3.3 FreeScout Integration** — Phases 44-46 (in progress)

## Phases

<details>
<summary>✅ v3.0 Web Dashboard (Phases 34-38) — SHIPPED 2026-02-09</summary>

- [x] Phase 34: Infrastructure Foundation (1/1 plan) — completed 2026-02-08
- [x] Phase 35: Run Tracking (1/1 plan) — completed 2026-02-08
- [x] Phase 36: Web Server and Authentication (2/2 plans) — completed 2026-02-09
- [x] Phase 37: Dashboard UI (2/2 plans) — completed 2026-02-09
- [x] Phase 38: Email Migration (1/1 plan) — completed 2026-02-09

</details>

<details>
<summary>✅ v3.1 Fetch Former Members (Phase 40) — SHIPPED 2026-02-09</summary>

- [x] Phase 40: Former Member Import Tool (2/2 plans) — completed 2026-02-09

</details>

<details>
<summary>✅ v3.2 Stadion-to-Rondo Rename (Phases 41-43) — SHIPPED 2026-02-11</summary>

- [x] Phase 41: Database Migration (3/3 plans) — completed 2026-02-11
- [x] Phase 42: Code References (3/3 plans) — completed 2026-02-11
- [x] Phase 43: Documentation (2/2 plans) — completed 2026-02-11

</details>

### 🚧 v3.3 FreeScout Integration (In Progress)

**Milestone Goal:** Deepen FreeScout ↔ Rondo Club integration with email activity visibility, photo sync, and additional field mapping.

#### Phase 44: RelationEnd Field Mapping

**Goal:** Sportlink RelationEnd date syncs to FreeScout custom field for membership expiration visibility

**Depends on:** Phase 43 (v3.2 complete)

**Requirements:** FIELD-01, FIELD-02

**Success Criteria** (what must be TRUE):
1. RelationEnd date from Sportlink appears in FreeScout custom field ID 9 ("Lid tot")
2. Date format is normalized to YYYY-MM-DD regardless of source format
3. Support agents can see membership expiration dates in FreeScout without switching to Sportlink
4. Null/invalid dates are handled gracefully (field left empty, no API errors)

**Plans:** 1 plan

Plans:
- [x] 44-01-PLAN.md — Add RelationEnd date normalization and FreeScout field mapping — completed 2026-02-12

#### Phase 45: Photo URL Sync to FreeScout

**Goal:** Member photos from Rondo Club automatically appear as FreeScout customer avatars

**Depends on:** Phase 44

**Requirements:** PHOTO-01, PHOTO-02, PHOTO-03

**Success Criteria** (what must be TRUE):
1. Member photos from Sportlink appear as FreeScout customer avatars in ticket view
2. Photo changes in Sportlink propagate to FreeScout on next sync (no stale avatars)
3. Customers without photos in Rondo Club are skipped (no broken image URLs in FreeScout)
4. Photo sync uses hash-based change detection (unchanged photos not re-uploaded)

**Plans:** 1 plan

Plans:
- [x] 45-01-PLAN.md — Implement photo URL fetching from Rondo Club API and FreeScout payload inclusion — completed 2026-02-12

#### Phase 46: FreeScout Conversations as Activities

**Goal:** FreeScout email conversations visible as activities on Rondo Club person timeline

**Depends on:** Phase 45

**Requirements:** CONV-01, CONV-02, CONV-03, CONV-04, CONV-05

**Success Criteria** (what must be TRUE):
1. FreeScout email conversations appear in Rondo Club person activity timeline
2. Support agents working in Rondo Club can see conversation history without tab switching
3. Conversation sync handles customers with 50+ conversations (pagination works correctly)
4. Each conversation syncs only once (no duplicate timeline entries on re-sync)
5. Incremental sync only fetches new conversations since last run (not all conversations every time)

**Plans:** TBD

Plans:
- [ ] 46-01: TBD

### Deferred

- [ ] Phase 39: Multi-Club Readiness (0/1 plan) — deferred until second club onboards

## Progress

**Execution Order:** Phases execute in numeric order.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 44. RelationEnd Field Mapping | v3.3 | 1/1 | ✓ Complete | 2026-02-12 |
| 45. Photo URL Sync | v3.3 | 1/1 | ✓ Complete | 2026-02-12 |
| 46. Conversations as Activities | v3.3 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-08*
*Last updated: 2026-02-12 after phase 45 completed*
