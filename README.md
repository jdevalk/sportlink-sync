# Sportlink downloader

This script logs in to Sportlink Club and fetches member data as JSON.

## What does the script do?

The script automatically:
- Runs in headless mode
- Uses `https://club.sportlink.com/` as the login URL
- Waits for `#panelHeaderTasks` selector to confirm login success
- Saves the Sportlink results JSON into `laposta-sync.sqlite`

## Setup

Requires Node 18+ (for built-in `fetch`, `FormData`, and `Blob`).

```bash
npm install
```

## One-step sync

```bash
npm run sync-all
```

## Download

```bash
npm run download
```

## Laposta sync

The Laposta preparation script writes members to `laposta-sync.sqlite`, and the
sync script only submits members whose Sportlink-derived data changed since the
last sync.

```bash
npm run prepare-laposta
npm run sync-laposta
npm run sync-laposta -- 2
npm run sync-laposta -- --force
```

- Running without a list index syncs all four lists.
- The list index (1-4) selects which Laposta list to sync.
- Use `--force` to sync all members even if unchanged.

To see what would be sent to Laposta for a given email:

```bash
npm run show-laposta-member -- someone@example.com
npm run show-laposta-member -- someone@example.com 2
```

To see what is in the latest Sportlink results for an email:

```bash
npm run show-sportlink-member -- someone@example.com
```
- `submit-laposta-list.js` fetches Laposta fields via the API and stores them in
  the database for reference.

To remove duplicate parent members in Laposta (same email, missing last name)
across all lists:

```bash
npm run dedupe-laposta
npm run dedupe-laposta -- --apply
```

- The default run targets all four lists and is a dry run.
- Add `--apply` to delete duplicates.
- If you want a single list, pass a list index: `npm run dedupe-laposta -- 2 --apply`

Create a `.env` file in this folder with your credentials and config. Example:

```bash
SPORTLINK_USERNAME="you@example.com"
SPORTLINK_PASSWORD="your-password"
SPORTLINK_OTP_SECRET="your-totp-secret"
DEBUG_LOG=false
LAPOSTA_API_KEY=
LAPOSTA_LIST=
LAPOSTA_LIST2=
LAPOSTA_LIST3=
LAPOSTA_LIST4=
```
