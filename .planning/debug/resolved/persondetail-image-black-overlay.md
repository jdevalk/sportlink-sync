---
status: resolved
trigger: "The image of people on PersonDetail page in the Rondo Club WordPress theme is not showing because there's a black element covering it, literally with a `bg-black` CSS class."
created: 2026-02-09T00:00:00Z
updated: 2026-02-09T00:00:00Z
---

## Current Focus

hypothesis: Tailwind v4 syntax change - bg-opacity-* classes no longer work, need to use /opacity syntax
test: Replace bg-opacity-0 and bg-opacity-50 with new v4 syntax (bg-black/0 and bg-black/50)
expecting: The overlay will be transparent by default, become semi-transparent on hover
next_action: Fix PersonDetail.jsx line 976 to use Tailwind v4 opacity syntax

## Symptoms

expected: Person's photo/image should be visible on the PersonDetail page
actual: A black overlay (using `bg-black` class) is covering/hiding the person's image
errors: None reported — it's a visual/CSS issue
reproduction: View any person's detail page on the Rondo Club site
started: After a recent deploy — it worked before

## Eliminated

## Evidence

- timestamp: 2026-02-09T00:01:00Z
  checked: /Users/joostdevalk/Code/rondo/rondo-club/src/pages/People/PersonDetail.jsx
  found: Line 976 has upload overlay div with `bg-black bg-opacity-0 group-hover:bg-opacity-50` - this overlay covers the person image
  implication: The overlay is always present with `bg-black`, but opacity is set to 0 by default. If the `bg-opacity-0` class is not working, the black overlay would be visible

- timestamp: 2026-02-09T00:02:00Z
  checked: dist/assets/main-rMy4YOF-.css (compiled CSS)
  found: `bg-opacity-0` class does NOT exist in the compiled CSS
  implication: Tailwind is not generating the bg-opacity-0 utility class, so the overlay remains fully black (opaque)

- timestamp: 2026-02-09T00:03:00Z
  checked: Tailwind CSS version and documentation
  found: Project uses Tailwind v4 (@tailwindcss/vite@4.1.18), which replaced bg-opacity-* with /opacity syntax
  implication: All bg-opacity-* classes throughout the codebase need updating to v4 syntax

- timestamp: 2026-02-09T00:04:00Z
  checked: All source files for bg-opacity patterns
  found: 3 unique patterns across 27 files: bg-black bg-opacity-0, bg-black bg-opacity-50, bg-gray-600 bg-opacity-75
  implication: This is a systematic migration issue affecting modals, overlays, and hover states

- timestamp: 2026-02-09T00:05:00Z
  action: Replaced all bg-opacity patterns with v4 syntax via sed
  found: All 27 files updated, 0 remaining bg-opacity instances
  implication: Build should now generate correct opacity classes

- timestamp: 2026-02-09T00:06:00Z
  checked: dist/assets/main-q0vZgeEp.css after rebuild
  found: .bg-black/0 and .bg-black/50 classes now exist in compiled CSS
  implication: Fix is complete, ready for verification

## Resolution

root_cause: Tailwind CSS v4 removed bg-opacity-* utilities in favor of /opacity syntax. The code uses bg-black bg-opacity-0 which doesn't compile in v4, so the overlay remains fully opaque black.
fix: Replaced all bg-opacity-* patterns with Tailwind v4 /opacity syntax across 27 files. Three patterns fixed: bg-black bg-opacity-0 → bg-black/0, bg-black bg-opacity-50 → bg-black/50, bg-gray-600 bg-opacity-75 → bg-gray-600/75
verification: ✓ CSS rebuild successful, ✓ .bg-black/0 and .bg-black/50 classes present in compiled CSS, ✓ All source files updated (0 bg-opacity instances remaining)
files_changed:
  - src/pages/People/PersonDetail.jsx (photo upload overlay + mobile todos backdrop)
  - src/pages/Teams/TeamDetail.jsx (photo upload overlay)
  - src/pages/Commissies/CommissieDetail.jsx (photo upload overlay)
  - src/pages/People/ColumnSettingsModal.jsx (modal backdrop)
  - src/pages/People/PeopleList.jsx (modal backdrops)
  - src/pages/VOG/VOGList.jsx (modal backdrops)
  - src/components/layout/Layout.jsx (sidebar backdrop)
  - Plus 20 modal components (AddressEditModal, ContactEditModal, TeamEditModal, etc.)
