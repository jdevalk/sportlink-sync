# Technology Stack

**Analysis Date:** 2026-01-24

## Languages

**Primary:**
- JavaScript (Node.js) - All application code and scripts

**Secondary:**
- JSON - Configuration and field mapping files

## Runtime

**Environment:**
- Node.js v23.11.0+ (project requires Node 18+)
- NPM v11.7.0+

**Package Manager:**
- NPM (Node Package Manager)
- Lockfile: `package-lock.json` (present, lockfileVersion 3)

## Frameworks

**Core:**
- None - Vanilla Node.js CLI application

**Database:**
- better-sqlite3 (latest) - Embedded SQLite database for local member tracking

**Automation/Scraping:**
- playwright (latest) - Browser automation for Sportlink web scraping

**Utilities:**
- dotenv (latest) - Environment variable management
- otplib (latest) - TOTP/OTP code generation for 2FA

## Key Dependencies

**Critical:**
- `better-sqlite3` - Provides SQLite database for tracking member sync state and Sportlink results
- `playwright` - Enables browser automation to scrape data from Sportlink Club web interface (https://club.sportlink.com/)
- `otplib` - Generates time-based one-time passwords for Sportlink 2FA authentication

**Infrastructure:**
- `dotenv` - Loads environment variables from `.env` file for credentials and configuration

## Configuration

**Environment:**
- Configuration via `.env` file (see `.env.example`)
- Environment variables required:
  - `SPORTLINK_USERNAME` - Sportlink Club login username
  - `SPORTLINK_PASSWORD` - Sportlink Club login password
  - `SPORTLINK_OTP_SECRET` - Base32-encoded TOTP secret for 2FA
  - `LAPOSTA_API_KEY` - API key for Laposta email marketing API
  - `LAPOSTA_LIST` - List ID for primary Laposta list
  - `LAPOSTA_LIST2` - List ID for secondary Laposta list
  - `LAPOSTA_LIST3` - List ID for tertiary Laposta list
  - `LAPOSTA_LIST4` - List ID for quaternary Laposta list
  - `DEBUG_LOG` (optional, default: false) - Enable request/response logging

**Build:**
- No build process required - runs directly with Node.js
- Entry points defined in `package.json` scripts

## Platform Requirements

**Development:**
- Node.js 18 or later (tested with 23.11.0)
- NPM for dependency management
- macOS, Linux, or Windows with Node.js support
- `.env` file with valid Sportlink and Laposta credentials

**Production:**
- Node.js 18+ runtime
- Persistent filesystem for SQLite database (`laposta-sync.sqlite`)
- Network access to:
  - https://club.sportlink.com (web interface)
  - https://api.laposta.nl (REST API)
- Chromium browser (automatically downloaded by playwright)

## Database

**Local Storage:**
- SQLite database at `./laposta-sync.sqlite`
- Stores:
  - Sportlink member query results (raw JSON)
  - Member data with sync state tracking
  - Laposta field definitions for reference
  - Sync history and hashes for change detection

---

*Stack analysis: 2026-01-24*
