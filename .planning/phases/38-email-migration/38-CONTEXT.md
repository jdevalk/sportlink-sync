# Phase 38: Email Migration - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Switch email reports from always-send to error-only alerts with dashboard links. Currently, every pipeline run (via sync.sh) sends a detailed email report parsed from log files. After this phase, emails only fire on pipeline failures and overdue pipelines, with minimal content and a link to the dashboard for details.

</domain>

<decisions>
## Implementation Decisions

### Error threshold
- Email only on **pipeline failure** (crash, non-zero exit) — not on individual member sync errors
- Individual member errors are completely silent in email — visible only in the dashboard
- **Overdue pipelines also trigger email alerts** — if a pipeline misses its cron schedule

### Overdue alert mechanism
- Periodic check detects overdue pipelines and sends email alerts
- Group all currently overdue pipelines into a single email per check cycle
- Repeat alerts with a **4-hour cooldown** while a pipeline remains overdue
- Claude's discretion: whether to implement via web server periodic task or separate cron job

### Email content
- **Minimal + link**: which pipeline failed, when, and a clickable link to the dashboard run detail page
- Overdue alerts use the same minimal style: which pipeline(s) are overdue, how long, dashboard overview link
- **Simple HTML** format with clickable dashboard link
- **Alert-style subject lines**: `[Rondo Sync] FAILED: people pipeline` or `[Rondo Sync] OVERDUE: people, nikki`

### Pipeline grouping
- **One email per failed pipeline** — even when `sync all` runs multiple pipelines, each failure gets its own email
- Overdue alerts are **grouped**: one email per check listing all currently overdue pipelines

### Transition behavior
- **Cold switch** — remove old always-send email code entirely, no parallel period
- **Replace send-email.js entirely** — delete the old log-parsing email script, write a new alert module that sends minimal emails from pipeline/run data
- No success confirmation emails — dashboard is the source of truth for successful runs
- No weekly digests — check the dashboard if you want to verify things are running

### Claude's Discretion
- Whether to keep log files in sync.sh (dashboard captures run data, but logs may still be useful for debugging)
- Overdue check implementation approach (web server periodic task vs cron job)
- Exact HTML template for alert emails
- How to detect pipeline failure in sync.sh (exit code, error count, etc.)

</decisions>

<specifics>
## Specific Ideas

- Current send-email.js reads log files and parses them into HTML — this entire approach is being replaced, not adapted
- The new alert module should work with pipeline/run data directly, not log file parsing
- Dashboard links should point to the specific run detail page for failures, and the overview page for overdue alerts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 38-email-migration*
*Context gathered: 2026-02-09*
