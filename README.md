# Sportlink Sync

A CLI tool that synchronizes member data from Sportlink Club to Laposta email marketing lists. It downloads member data via browser automation, transforms it according to field mappings, and syncs changes to up to 4 Laposta lists.

## Features

- **Automated sync**: Daily cron job at 6:00 AM with email reports
- **Change detection**: Only submits members whose data actually changed
- **Multi-list support**: Sync to up to 4 Laposta lists
- **Parent deduplication**: Handles parent/child member associations
- **Summary output**: Clean, email-friendly sync reports

## What does the script do?

The script automatically:
- Runs in headless mode
- Uses `https://club.sportlink.com/` as the login URL
- Waits for `#panelHeaderTasks` selector to confirm login success
- Saves the Sportlink results JSON into `laposta-sync.sqlite`

## Setup

Requires Node 18+ (for built-in `fetch`, `FormData`, and `Blob`).

For cron automation, also requires:
- `mail` command (usually from `mailutils` or `sendmail`)
- Cron daemon running on the system

```bash
npm install
```

## One-step sync

```bash
npm run sync-all
```

For verbose output (shows per-member progress):

```bash
npm run sync-all-verbose
```

## Automated daily sync

Set up a cron job that runs the sync daily at 6:00 AM (Amsterdam time) and emails the report:

```bash
npm run install-cron
```

This will:
- Prompt for your operator email address
- Install crontab entries for daily sync at 6:00 AM
- Configure automatic retry at 8:00 AM if the first sync fails
- Send email reports after each sync

To verify installation:

```bash
crontab -l
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

To see the full list of members pending sync (changes only, with diffs):

```bash
npm run show-laposta-changes
npm run show-laposta-changes -- 2
```

To see all members that would be sent (including unchanged, with diffs):

```bash
npm run show-laposta-changes -- --all
```

Note: diffs are based on the last successful Laposta sync.

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
