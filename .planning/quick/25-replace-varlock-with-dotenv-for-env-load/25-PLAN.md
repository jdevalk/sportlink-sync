---
phase: 25-replace-varlock-with-dotenv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - .gitignore
  - CLAUDE.md
  - README.md
  - lib/web-server.js
  - lib/alert-email.js
  - lib/rondo-club-client.js
  - lib/sportlink-login.js
  - lib/freescout-client.js
  - lib/reverse-sync-sportlink.js
  - pipelines/sync-all.js
  - pipelines/sync-people.js
  - pipelines/sync-teams.js
  - pipelines/sync-functions.js
  - pipelines/sync-freescout.js
  - pipelines/sync-nikki.js
  - pipelines/sync-discipline.js
  - pipelines/sync-individual.js
  - pipelines/sync-former-members.js
  - pipelines/reverse-sync.js
  - steps/download-data-from-sportlink.js
  - steps/download-teams-from-sportlink.js
  - steps/download-functions-from-sportlink.js
  - steps/download-photos-from-api.js
  - steps/download-inactive-members.js
  - steps/download-discipline-cases.js
  - steps/download-nikki-contributions.js
  - steps/prepare-rondo-club-members.js
  - steps/prepare-rondo-club-parents.js
  - steps/prepare-rondo-club-teams.js
  - steps/prepare-laposta-members.js
  - steps/prepare-freescout-customers.js
  - steps/submit-rondo-club-sync.js
  - steps/submit-rondo-club-teams.js
  - steps/submit-rondo-club-commissies.js
  - steps/submit-rondo-club-commissie-work-history.js
  - steps/submit-rondo-club-work-history.js
  - steps/submit-rondo-club-discipline.js
  - steps/submit-freescout-sync.js
  - steps/submit-laposta-list.js
  - steps/upload-photos-to-rondo-club.js
  - steps/sync-important-dates.js
  - steps/sync-nikki-to-rondo-club.js
  - steps/sync-freescout-ids-to-rondo-club.js
  - steps/reverse-sync-contact-fields.js
  - tools/cleanup-rondo-club-duplicates.js
  - tools/cleanup-duplicate-former-members.js
  - tools/cleanup-duplicate-relationships.js
  - tools/cleanup-orphan-relationships.js
  - tools/cleanup-comma-teams.js
  - tools/clear-commissie-work-history.js
  - tools/verify-rondo-club-data.js
  - tools/validate-rondo-club-ids.js
  - tools/repopulate-rondo-club-ids.js
  - tools/merge-duplicate-parents.js
  - tools/merge-duplicate-person.js
  - tools/unmerge-parent-from-child.js
  - tools/reset-photo-states.js
  - tools/delete-duplicates.js
  - tools/find-orphan-dates.js
  - tools/show-laposta-changes.js
  - tools/show-laposta-member.js
  - tools/show-sportlink-member.js
  - tools/show-nikki-contributions.js
  - tools/check-photo-consistency.js
  - tools/test-csv-download.js
  - tools/dedupe-laposta-list.js
autonomous: true
must_haves:
  truths:
    - "All 63 JS files load .env via dotenv instead of varlock"
    - "varlock is fully removed from the project (package.json, node_modules, .gitignore)"
    - "All existing sync pipelines still work after the change"
  artifacts:
    - path: "package.json"
      provides: "dotenv dependency, no varlock dependency"
      contains: "dotenv"
    - path: ".gitignore"
      provides: "No .varlock/ entry"
  key_links:
    - from: "all entry point JS files"
      to: "dotenv/config"
      via: "require at line 1"
      pattern: "require\\('dotenv/config'\\)"
---

<objective>
Replace varlock with dotenv for .env loading across the entire codebase.

Purpose: varlock is a niche package pinned to "latest" (v0.1.5). dotenv is the industry-standard .env loader with millions of weekly downloads. The project only uses varlock's auto-load feature, which `require('dotenv/config')` replaces exactly.

Output: All 63 JS files use dotenv, varlock fully removed, docs updated.
</objective>

<execution_context>
@/Users/joostdevalk/.claude/get-shit-done/workflows/execute-plan.md
@/Users/joostdevalk/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@package.json
@.gitignore
@README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install dotenv, remove varlock, replace all requires</name>
  <files>package.json, package-lock.json, and all 63 JS files listed in files_modified</files>
  <action>
1. Run `npm install dotenv` and `npm uninstall varlock` in the project root.

2. Replace `require('varlock/auto-load')` with `require('dotenv/config')` in all 63 JS files. Use a single sed command:
   ```
   sed -i '' "s/require('varlock\/auto-load')/require('dotenv\/config')/g" lib/*.js pipelines/*.js steps/*.js tools/*.js
   ```
   Then verify with grep that zero files still contain `varlock/auto-load`.

3. Note: Some files (like `tools/verify-rondo-club-data.js`, `tools/reset-photo-states.js`, `tools/delete-duplicates.js`, `tools/find-orphan-dates.js`, `tools/cleanup-duplicate-relationships.js`, `tools/merge-duplicate-person.js`) have the require on a line OTHER than line 1 (e.g., after comments or other requires). The sed command handles this correctly since it replaces the string wherever it appears.

4. The `.env.example` file is plain key=value format with no varlock-specific syntax -- no changes needed there.
  </action>
  <verify>
- `grep -r "varlock" lib/ steps/ tools/ pipelines/` returns zero matches
- `grep -r "require('dotenv/config')" lib/ steps/ tools/ pipelines/ | wc -l` returns 63
- `node -e "require('dotenv/config')"` exits cleanly (dotenv installed correctly)
- `cat package.json | grep varlock` returns nothing
- `cat package.json | grep dotenv` shows the dependency
  </verify>
  <done>All 63 JS files use `require('dotenv/config')`, varlock removed from package.json, dotenv installed</done>
</task>

<task type="auto">
  <name>Task 2: Clean up .gitignore and update documentation</name>
  <files>.gitignore, CLAUDE.md, README.md</files>
  <action>
1. In `.gitignore`: Remove the `.varlock/` entry and its `# Varlock` comment (lines 22-23).

2. In `CLAUDE.md` (project-level, at `/Users/joostdevalk/Code/rondo/rondo-sync/CLAUDE.md`):
   - Line 125: Change `varlock (env loading)` to `dotenv (env loading)` in the Tech Stack line.

3. In `README.md`:
   - Line 105: Change `varlock` to `dotenv` in the Tech Stack line.

4. Do NOT update any files under `.planning/` -- those are historical records.
  </action>
  <verify>
- `grep -i varlock .gitignore CLAUDE.md README.md` returns zero matches
- `grep dotenv CLAUDE.md README.md` shows updated references
- `.gitignore` no longer has `.varlock/` entry
  </verify>
  <done>.gitignore cleaned, CLAUDE.md and README.md reference dotenv instead of varlock</done>
</task>

</tasks>

<verification>
- `grep -r "varlock" --include="*.js" --include="*.json" --include="*.md" . | grep -v node_modules | grep -v .planning/` returns zero matches (varlock fully purged from active codebase)
- `node -e "require('dotenv/config'); console.log('OK')"` prints OK
- No `.varlock/` directory reference remains
</verification>

<success_criteria>
- All 63 JS entry points load .env via `require('dotenv/config')`
- varlock completely removed from package.json and node_modules
- .gitignore, CLAUDE.md, README.md updated
- No functional change to how .env variables are loaded
</success_criteria>

<output>
After completion, create `.planning/quick/25-replace-varlock-with-dotenv-for-env-load/25-SUMMARY.md`
</output>
