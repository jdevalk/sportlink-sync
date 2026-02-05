# Quick Task 015: Add Infix Field for Stadion API

## What Changed

Stadion's API now accepts `infix` (tussenvoegsel) as a separate ACF field on person records, instead of expecting it merged into `last_name`. The WordPress title is now auto-generated server-side from `first_name`, `infix`, and `last_name`.

## Changes Made

**`prepare-stadion-members.js`** (commit `8fd1a03`):

1. **`buildName()`** - No longer merges infix into last_name. Returns `{first_name, infix, last_name}` as three separate fields.
2. **`preparePerson()`** - Adds `infix` to ACF payload when non-empty (follows same pattern as other optional fields like `gender`).

## No Other Files Changed

- `submit-stadion-sync.js` - Sends full `data` object from `preparePerson`, so `infix` flows through automatically
- `prepare-stadion-parents.js` - Parents use free-text `NameParent1`/`NameParent2` fields, no infix available

## Before/After

**Before:** `{first_name: "Jan", last_name: "van de Berg"}`
**After:** `{first_name: "Jan", infix: "van de", last_name: "Berg"}`

Members without infix: `infix` key is omitted from the ACF payload entirely.

## Verification

Tested with `preparePerson()` directly:
- With infix: `first_name: "Jan"`, `infix: "van de"`, `last_name: "Berg"`
- Without infix: `first_name: "Piet"`, `last_name: "Bakker"` (no infix key)

## Deployment Note

After deploying, run a full people sync to update all existing records with the split name fields:
```bash
ssh root@46.202.155.16 "cd /home/sportlink && git pull && scripts/sync.sh people"
```
