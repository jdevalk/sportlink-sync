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
- 🚧 **v3.1 Fetch Former Members** — Phase 40 (in progress)

## Phases

<details>
<summary>✅ v3.0 Web Dashboard (Phases 34-38) — SHIPPED 2026-02-09</summary>

- [x] Phase 34: Infrastructure Foundation (1/1 plan) — completed 2026-02-08
- [x] Phase 35: Run Tracking (1/1 plan) — completed 2026-02-08
- [x] Phase 36: Web Server and Authentication (2/2 plans) — completed 2026-02-09
- [x] Phase 37: Dashboard UI (2/2 plans) — completed 2026-02-09
- [x] Phase 38: Email Migration (1/1 plan) — completed 2026-02-09

</details>

### Deferred

- [ ] Phase 39: Multi-Club Readiness (0/1 plan) — deferred until second club onboards

### 🚧 v3.1 Fetch Former Members (In Progress)

**Milestone Goal:** One-time tool to download former members from Sportlink and sync to Rondo Club for tracking outstanding payments/equipment.

#### Phase 40: Former Member Import Tool

**Goal:** Operator can run one-time tool that downloads all former members from Sportlink (inactive status) and syncs them to Rondo Club with former_member flag

**Depends on:** Phase 38 (existing member sync infrastructure)

**Requirements:** DL-01, DL-02, DL-03, SYNC-01, SYNC-02, SYNC-03, SYNC-04, TOOL-01, TOOL-02, TOOL-03

**Success Criteria** (what must be TRUE):
1. Tool can authenticate to Sportlink and toggle status filter to INACTIVE members
2. Tool downloads former member data (name, contact, address, KNVB ID) from SearchMembers API
3. Tool downloads photo for each former member via MemberHeader API
4. Former members sync to Rondo Club as person records with acf.former_member = true
5. Former member photos upload to their Rondo Club person records
6. Tool skips members that already exist as active (no duplicates created)
7. Tool provides dry-run mode showing what would be synced without making changes
8. Tool outputs progress with counts (downloaded, synced, skipped, failed)

**Plans:** 2 plans

Plans:
- [ ] 40-01-PLAN.md — Download inactive members from Sportlink and sync to Rondo Club with former_member flag
- [ ] 40-02-PLAN.md — Download and upload photos for former members

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 34. Infrastructure Foundation | v3.0 | 1/1 | Complete | 2026-02-08 |
| 35. Run Tracking | v3.0 | 1/1 | Complete | 2026-02-08 |
| 36. Web Server and Authentication | v3.0 | 2/2 | Complete | 2026-02-09 |
| 37. Dashboard UI | v3.0 | 2/2 | Complete | 2026-02-09 |
| 38. Email Migration | v3.0 | 1/1 | Complete | 2026-02-09 |
| 39. Multi-Club Readiness | — | 0/1 | Deferred | - |
| 40. Former Member Import Tool | v3.1 | 0/2 | In progress | - |

---
*Roadmap created: 2026-02-08*
*Last updated: 2026-02-09 after v3.1 roadmap*
