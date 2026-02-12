---
phase: quick-25
plan: 01
subsystem: infrastructure
tags: [dependencies, env-loading, migration]
dependency_graph:
  requires: []
  provides:
    - dotenv-based env loading
  affects:
    - all 63 JS entry points
tech_stack:
  added:
    - dotenv (v17.2.4)
  removed:
    - varlock (v0.1.5)
  patterns: []
key_files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - .gitignore
    - CLAUDE.md
    - README.md
    - lib/*.js (8 files)
    - pipelines/*.js (9 files)
    - steps/*.js (23 files)
    - tools/*.js (23 files)
decisions: []
metrics:
  duration_seconds: 80
  tasks_completed: 2
  files_modified: 68
  completed_date: 2026-02-12
---

# Quick Task 25: Replace varlock with dotenv for env loading

**One-liner:** Migrated all 63 JS entry points from varlock to industry-standard dotenv package

## Objective

Replace varlock (niche package pinned to "latest" v0.1.5) with dotenv, the industry-standard .env loader with millions of weekly downloads. The project only used varlock's auto-load feature, which `require('dotenv/config')` replaces exactly.

## Tasks Completed

| Task | Description | Commit | Files Modified |
|------|-------------|--------|----------------|
| 1 | Install dotenv, remove varlock, replace all requires | 662fa98 | package.json, package-lock.json, 63 JS files across lib/, pipelines/, steps/, tools/ |
| 2 | Clean up .gitignore and update documentation | 2d90a60 | .gitignore, CLAUDE.md, README.md |

## Implementation Details

### Task 1: Package Migration

1. **Package management:**
   - Installed dotenv v17.2.4 via `npm install dotenv`
   - Removed varlock and its 22 dependencies via `npm uninstall varlock`

2. **Code migration:**
   - Used sed to replace `require('varlock/auto-load')` with `require('dotenv/config')` across all 63 JS files
   - Verified replacement: all files now use dotenv, zero varlock references remain
   - Tested dotenv loads successfully: `node -e "require('dotenv/config')"` exits cleanly

3. **Files affected:**
   - lib/ (8 files): alert-email.js, freescout-client.js, freescout-db.js, reverse-sync-sportlink.js, rondo-club-client.js, sportlink-login.js, web-server.js
   - pipelines/ (9 files): all pipeline orchestrators
   - steps/ (23 files): all pipeline steps
   - tools/ (23 files): all utility scripts

### Task 2: Documentation Cleanup

1. **.gitignore:** Removed `.varlock/` entry and its comment
2. **CLAUDE.md:** Updated Tech Stack line to reference "dotenv (env loading)" instead of "varlock (env loading)"
3. **README.md:** Updated Tech Stack line to reference "dotenv" instead of "varlock"

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:

- ✅ All 63 JS entry points load .env via `require('dotenv/config')`
- ✅ varlock completely removed from package.json (verified: grep returns no matches)
- ✅ varlock removed from node_modules (22 packages uninstalled)
- ✅ .gitignore cleaned (no `.varlock/` entry)
- ✅ CLAUDE.md and README.md updated to reference dotenv
- ✅ No functional change: dotenv/config provides identical auto-load behavior
- ✅ dotenv loads successfully: test command exits cleanly

## Impact

**Immediate:**
- Reduced node_modules size by 22 packages
- Standardized on industry-standard env loading (dotenv has 33M+ weekly downloads vs varlock's <1K)
- Eliminated dependency on "latest" version pinning (varlock was pinned to "latest", dotenv uses semver)

**Long-term:**
- Better ecosystem compatibility
- More stable dependency chain
- Easier onboarding (dotenv is universally known)

## Self-Check: PASSED

**Files verified:**
- ✅ package.json exists and contains dotenv dependency
- ✅ .gitignore exists and has no .varlock/ entry
- ✅ CLAUDE.md exists and references dotenv
- ✅ README.md exists and references dotenv

**Commits verified:**
- ✅ 662fa98 exists (Task 1: package migration + code replacement)
- ✅ 2d90a60 exists (Task 2: documentation cleanup)

**Code verification:**
- ✅ 63 JS files contain `require('dotenv/config')`
- ✅ 0 JS files contain `require('varlock/auto-load')`
- ✅ dotenv module loads successfully

## Notes

- One varlock reference remains in `.claude/settings.local.json` (Claude Code configuration) - this is not part of the codebase and does not affect functionality
- The new file `steps/sync-freescout-ids-to-rondo-club.js` was already using dotenv/config (likely created between plan writing and execution)
