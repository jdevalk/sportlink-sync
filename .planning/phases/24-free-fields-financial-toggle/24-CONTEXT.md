# Phase 24: Free Fields & Financial Toggle Reverse Sync - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend reverse sync to remaining target fields: datum-vog and freescout-id on the /other page, and financiele-blokkade toggle on the /financial page. Builds on Phase 23's contact field foundation. This completes bidirectional sync for all 7 tracked fields.

</domain>

<decisions>
## Implementation Decisions

### Page navigation strategy
- Single browser session handles all needed pages for a member (login once, visit multiple pages)
- Visit pages in predictable order: /general → /other → /financial (top to bottom)
- If any page navigation fails after 3 retries, skip the entire member (fail fast, don't risk partial state)
- On Sportlink session timeout mid-sync: re-authenticate and continue from where left off with next member

### Claude's Discretion
- Error handling & partial failures strategy (not discussed)
- Scheduling & pipeline integration approach (not discussed)
- Reporting granularity in email reports (not discussed)
- Exact delay between page transitions
- Session timeout detection mechanism
- How to track which members completed before timeout

</decisions>

<specifics>
## Specific Ideas

- Leverage existing Phase 23 infrastructure for Playwright automation
- Same retry/backoff patterns as contact field sync
- Same verification approach (read back saved values)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-free-fields-financial-toggle*
*Context gathered: 2026-01-29*
