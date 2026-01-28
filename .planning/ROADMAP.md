# Roadmap: Sportlink Sync

## Milestones

- ✅ **v1.0 MVP** — Phases 1-2 (shipped 2026-01-24)
- ✅ **v1.1 Postmark Email** — Phase 3 (shipped 2026-01-25)
- ✅ **v1.2 Email Polish** — Phase 4 (shipped 2026-01-25)
- ✅ **v1.3 Connect to Stadion** — Phases 5-8 (shipped 2026-01-25)
- ✅ **v1.4 Photo Sync** — Phases 9-12 (shipped 2026-01-26)
- ✅ **v1.5 Team Sync** — Phases 13-15 (shipped 2026-01-26)
- 🚧 **v1.6 FreeScout Integration** — Phase 16 (in progress)

## Phases

<details>
<summary>✅ v1.0-v1.5 (Phases 1-15) — SHIPPED</summary>

See `.planning/MILESTONES.md` for completed work.

Archives:
- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.1-ROADMAP.md`
- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.3-ROADMAP.md`
- `.planning/milestones/v1.4-ROADMAP.md` (pending)
- `.planning/milestones/v1.5-ROADMAP.md`

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-2. MVP | v1.0 | 3/3 | Complete | 2026-01-24 |
| 3. Postmark | v1.1 | 2/2 | Complete | 2026-01-25 |
| 4. Email Polish | v1.2 | 2/2 | Complete | 2026-01-25 |
| 5. Stadion Foundation | v1.3 | 1/1 | Complete | 2026-01-25 |
| 6. Member Sync | v1.3 | 3/3 | Complete | 2026-01-25 |
| 7. Parent Sync | v1.3 | 3/3 | Complete | 2026-01-25 |
| 8. Pipeline Integration | v1.3 | 1/1 | Complete | 2026-01-25 |
| 9. Photo State Tracking | v1.4 | 1/1 | Complete | 2026-01-26 |
| 10. Photo Download | v1.4 | 1/1 | Complete | 2026-01-26 |
| 11. Photo Upload/Deletion | v1.4 | 1/1 | Complete | 2026-01-26 |
| 12. Pipeline Integration | v1.4 | 1/1 | Complete | 2026-01-26 |
| 13. Team Extraction | v1.5 | 1/1 | Complete | 2026-01-26 |
| 14. Work History | v1.5 | 1/1 | Complete | 2026-01-26 |
| 15. Pipeline Integration | v1.5 | 1/1 | Complete | 2026-01-26 |
| 16. FreeScout Sync | v1.6 | 0/2 | Planned | - |

**Total:** 16 phases (15 complete, 1 planned)

---

## Current Milestone: v1.6 FreeScout Integration

Sync member data to FreeScout helpdesk as Customers.

### Phase 16: FreeScout Customer Sync

**Goal:** Sync member data to FreeScout helpdesk customers via API

**Depends on:** Phases 1-15 (core sync infrastructure)

**Plans:** 2 plans

**Details:**

Sync member data to FreeScout Customers:
- If we have a FreeScout ID, update that Customer
- If not, search by email and update if found, otherwise create
- Map fields: firstName, lastName, phone, photoUrl (Stadion), emails
- Custom fields:
  - 1 → UnionTeams
  - 4 → PublicPersonId (KNVB ID)
  - 5 → MemberSince
  - 7 → Nikki saldo (most recent year)
  - 8 → Nikki status (most recent year)

API: https://api-docs.freescout.net/

Plans:
- [ ] 16-01-PLAN.md — FreeScout foundation (database + API client)
- [ ] 16-02-PLAN.md — FreeScout sync (prepare, submit, pipeline integration)

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-28 — Phase 16 planned*
