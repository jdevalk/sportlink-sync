# Phase 27: CSV Download & Data Matching - Research

**Researched:** 2026-02-01
**Domain:** File download automation (Playwright) + CSV parsing (Node.js)
**Confidence:** HIGH

## Summary

This phase adds CSV download capability to the existing Nikki scraper and implements data matching between CSV records and HTML table rows. The standard approach uses Playwright's download event API to handle file downloads triggered by button/link clicks, and csv-parse library (part of the node-csv ecosystem) for robust CSV parsing with streaming support.

The current implementation scrapes HTML tables from the /leden page extracting limited fields (year, knvb_id, nikki_id, saldo, status). The CSV download will provide additional data like "hoofdsom" (total amount) that isn't visible in the HTML table. The matching strategy should use nikki_id as the primary key since it's unique per member per year and appears in both the HTML table and CSV.

**Primary recommendation:** Use Playwright's `page.waitForEvent('download')` pattern for CSV download, csv-parse for parsing, and nikki_id as the matching key between HTML and CSV data sources.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | latest (already installed) | Browser automation & file downloads | Official Microsoft tool, handles download events natively, already in use |
| csv-parse | 5.x+ | CSV parsing | Part of node-csv ecosystem (1.4M weekly downloads), streaming support, RFC 4180 compliant |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | latest (already installed) | Store parsed CSV data | Already used for nikki-sync.sqlite |
| fs/promises | Node.js built-in | File system operations | Reading downloaded CSV files |
| path | Node.js built-in | Path manipulation | Constructing download paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| csv-parse | papaparse | papaparse is 2x faster but csv-parse has better streaming, larger community (1.4M vs 800k weekly), and better Node.js integration |
| csv-parse | fast-csv | fast-csv focuses only on speed, csv-parse has more configuration options and better ecosystem integration |
| csv-parse | csv-parser | csv-parser performs similarly but csv-parse has better documentation and is part of the official node-csv suite |

**Installation:**
```bash
npm install csv-parse
```

## Architecture Patterns

### Recommended Project Structure
```
download-nikki-contributions.js    # Modified to download CSV after scraping
lib/
├── nikki-db.js                     # Extended schema to store hoofdsom
└── logger.js                       # Existing logger
downloads/                          # Temporary CSV storage (gitignored)
```

### Pattern 1: Playwright Download Event Handling
**What:** Wait for download event before triggering the download action, then save the file.
**When to use:** Any scenario where a button/link triggers a file download.
**Example:**
```javascript
// Source: https://playwright.dev/docs/downloads
async function downloadCsvFromNikki(page, logger) {
  logger.verbose('Clicking Rapporten link to download CSV...');

  // Start waiting for download before clicking
  const downloadPromise = page.waitForEvent('download');

  // Trigger the download (adjust selector based on actual page)
  await page.click('a:has-text("Rapporten")'); // or button, or specific selector

  // Wait for download to start
  const download = await downloadPromise;

  // Save to downloads directory with suggested filename
  const downloadsDir = path.join(process.cwd(), 'downloads');
  await fs.mkdir(downloadsDir, { recursive: true });
  const filePath = path.join(downloadsDir, download.suggestedFilename());

  await download.saveAs(filePath);
  logger.verbose(`CSV downloaded to: ${filePath}`);

  return filePath;
}
```

### Pattern 2: CSV Parsing with Streaming
**What:** Parse CSV files using stream API for memory efficiency.
**When to use:** For any CSV file, especially large ones (>1000 rows).
**Example:**
```javascript
// Source: https://csv.js.org/parse/
const fs = require('fs');
const { parse } = require('csv-parse');

async function parseCsvFile(filePath, logger) {
  const records = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,           // Use first row as column names
        skip_empty_lines: true,  // Ignore blank lines
        trim: true,              // Trim whitespace from values
        bom: true,               // Handle UTF-8 BOM
        delimiter: ',',          // CSV delimiter
        relax_column_count: true // Handle inconsistent column counts
      }))
      .on('data', (row) => {
        records.push(row);
      })
      .on('error', (error) => {
        logger.error(`CSV parse error: ${error.message}`);
        reject(error);
      })
      .on('end', () => {
        logger.verbose(`Parsed ${records.length} rows from CSV`);
        resolve(records);
      });
  });
}
```

### Pattern 3: Data Matching by ID
**What:** Match CSV records to HTML table records using nikki_id as primary key.
**When to use:** When combining data from multiple sources that share a common identifier.
**Example:**
```javascript
async function mergeHtmlAndCsvData(htmlRecords, csvRecords, logger) {
  // Create lookup map from CSV data (O(1) lookup)
  const csvMap = new Map();
  for (const csvRow of csvRecords) {
    // Assuming CSV has columns: nikki_id, lid_nr, hoofdsom, saldo, etc.
    const key = csvRow.nikki_id || csvRow.nikkiId; // Adjust based on actual column name
    if (key) {
      csvMap.set(key, csvRow);
    }
  }

  logger.verbose(`Built CSV lookup map with ${csvMap.size} entries`);

  // Merge data
  const merged = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const htmlRow of htmlRecords) {
    const csvData = csvMap.get(htmlRow.nikki_id);

    if (csvData) {
      // Matched: merge data
      merged.push({
        knvb_id: htmlRow.knvb_id,
        year: htmlRow.year,
        nikki_id: htmlRow.nikki_id,
        saldo: htmlRow.saldo,
        status: htmlRow.status,
        hoofdsom: parseEuroAmount(csvData.hoofdsom || csvData.total || '0'), // Adjust column name
        // Add any other CSV fields needed
      });
      matchedCount++;
    } else {
      // Not matched: use HTML data only, set hoofdsom to null
      merged.push({
        knvb_id: htmlRow.knvb_id,
        year: htmlRow.year,
        nikki_id: htmlRow.nikki_id,
        saldo: htmlRow.saldo,
        status: htmlRow.status,
        hoofdsom: null,
      });
      unmatchedCount++;
    }
  }

  logger.verbose(`Matched ${matchedCount} records, ${unmatchedCount} unmatched (gracefully handled)`);
  return merged;
}
```

### Pattern 4: Browser Context Configuration for Downloads
**What:** Configure browser context to enable downloads.
**When to use:** Before any download operations in Playwright.
**Example:**
```javascript
// Source: https://playwright.dev/docs/downloads
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true, // REQUIRED for download operations
  userAgent: 'Mozilla/5.0 ...'
});
const page = await context.newPage();
```

### Anti-Patterns to Avoid
- **Manual CSV parsing with string.split():** Doesn't handle quoted fields, escaped characters, or multiline values. Always use a library.
- **Loading entire CSV into memory without streaming:** For large files (>10MB), use streaming to prevent memory issues.
- **Hardcoding CSV column names:** CSV structure may change. Use flexible column mapping or validate columns exist.
- **Assuming all records have matching data:** Always handle missing nikki_id gracefully (set hoofdsom to null, don't error).
- **Clicking download before setting up event listener:** Race condition - download event must be waited for BEFORE clicking.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | String.split() + manual logic | csv-parse library | Handles quoted fields, escaped characters, multiline values, BOM, different delimiters, malformed input |
| File download handling | Custom HTTP request to guess URL | Playwright download event API | Browser handles download triggers (JavaScript, redirects, Content-Disposition headers), gets actual filename from server |
| European currency parsing | Custom regex | Existing parseEuroAmount() function | Already handles €1.234,56 format with thousands separator and decimal comma |
| Data matching | Nested loops (O(n²)) | Map-based lookup (O(n)) | 100x faster for 1000+ records |

**Key insight:** CSV parsing has many edge cases (quotes, escapes, multiline fields, BOM markers, encoding issues). Using a battle-tested library prevents bugs and ensures RFC 4180 compliance.

## Common Pitfalls

### Pitfall 1: Download Event Race Condition
**What goes wrong:** Clicking download button before setting up download event listener causes the download event to be missed.
**Why it happens:** Downloads happen asynchronously; if the event listener isn't attached before the click, the event fires and is lost.
**How to avoid:** Always call `page.waitForEvent('download')` BEFORE the click action, store the promise, then await it after clicking.
**Warning signs:** Downloads work in headful mode (slower) but fail in headless mode (faster).

### Pitfall 2: CSV Column Name Assumptions
**What goes wrong:** Code assumes specific column names (like "hoofdsom") but CSV uses different names or language.
**Why it happens:** CSV structure isn't documented, may change, or may vary between exports.
**How to avoid:**
  - Log the actual CSV columns when parsing: `logger.verbose('CSV columns:', Object.keys(firstRow))`
  - Use flexible column mapping: check for multiple possible names
  - Validate expected columns exist before processing
**Warning signs:** Parsing succeeds but all values are undefined or null.

### Pitfall 3: Missing nikki_id Handling
**What goes wrong:** Code throws errors or skips entire records when nikki_id is missing.
**Why it happens:** Not all members have nikki_id (new members, inactive members, data quality issues).
**How to avoid:**
  - Explicitly check for nikki_id before matching
  - Set hoofdsom to null for unmatched records
  - Log stats: "Matched X records, Y unmatched (gracefully handled)"
  - Continue processing, don't fail entire sync
**Warning signs:** Sync fails on valid data, fewer records stored than scraped.

### Pitfall 4: File Cleanup
**What goes wrong:** Downloaded CSV files accumulate in downloads/ directory, consuming disk space.
**Why it happens:** Playwright doesn't auto-delete files, only cleans up on context close.
**How to avoid:**
  - Delete CSV file after parsing: `await fs.unlink(filePath)`
  - Or use temporary directory that gets cleaned periodically
  - Add downloads/ to .gitignore
**Warning signs:** Disk usage grows over time, hundreds of CSV files in downloads/.

### Pitfall 5: European Number Format in CSV
**What goes wrong:** CSV contains amounts like "€ 1.234,56" which parseFloat() incorrectly parses as 1.234.
**Why it happens:** European format uses comma for decimal, period for thousands (opposite of US format).
**How to avoid:** Use the existing `parseEuroAmount()` function which handles this format correctly.
**Warning signs:** All amounts are off by 100x or 1000x (e.g., €1.234,56 parsed as 1.234 instead of 1234.56).

### Pitfall 6: Browser Context acceptDownloads
**What goes wrong:** Downloads fail silently or hang indefinitely.
**Why it happens:** Browser context must have `acceptDownloads: true` option set.
**How to avoid:** Add `acceptDownloads: true` to context creation (see Pattern 4).
**Warning signs:** Download promise never resolves, no file appears in downloads directory.

## Code Examples

Verified patterns from official sources:

### Complete Download and Parse Flow
```javascript
// Source: Playwright docs + csv-parse docs
const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');
const { parse } = require('csv-parse');

async function downloadAndParseCsv(page, logger) {
  // 1. Download CSV
  logger.verbose('Starting CSV download...');
  const downloadPromise = page.waitForEvent('download');
  await page.click('a:has-text("Rapporten")'); // Adjust selector
  const download = await downloadPromise;

  const downloadsDir = path.join(process.cwd(), 'downloads');
  await fs.mkdir(downloadsDir, { recursive: true });
  const filePath = path.join(downloadsDir, download.suggestedFilename());
  await download.saveAs(filePath);
  logger.verbose(`Downloaded: ${filePath}`);

  // 2. Parse CSV
  const records = await new Promise((resolve, reject) => {
    const rows = [];
    require('fs').createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });

  logger.verbose(`Parsed ${records.length} CSV rows`);

  // Log columns for debugging
  if (records.length > 0) {
    logger.verbose('CSV columns:', Object.keys(records[0]).join(', '));
  }

  // 3. Clean up file
  await fs.unlink(filePath);
  logger.verbose('Cleaned up CSV file');

  return records;
}
```

### Database Schema Extension
```javascript
// Source: Existing nikki-db.js pattern
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nikki_contributions (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      nikki_id TEXT NOT NULL,
      saldo REAL,
      hoofdsom REAL,              -- NEW: total amount from CSV
      status TEXT,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, year)
    );
  `);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual download URL construction | Playwright download event API | 2020+ (Playwright 1.0) | More reliable, handles dynamic downloads, gets correct filename |
| Synchronous CSV parsing | Streaming with csv-parse | 2015+ (Node.js streams maturity) | Memory efficient, handles large files |
| Nested loop matching (O(n²)) | Map-based lookup (O(n)) | Standard practice | 100x faster for 1000+ records |

**Deprecated/outdated:**
- **csv NPM package without specific subpackage**: Use csv-parse specifically instead of the generic 'csv' package (which includes parse, stringify, transform, generate).
- **Loading entire file with fs.readFileSync()**: Prefer streaming for any CSV that might grow large.

## Open Questions

Things that couldn't be fully resolved:

1. **Location and behavior of "Rapporten" link**
   - What we know: The phase description mentions a "Rapporten" link on the /leden page
   - What's unclear: Exact selector, whether it's a link/button, whether it opens modal or directly downloads
   - Recommendation: Inspect the actual page during implementation. Use flexible selectors (try multiple: `a:has-text("Rapporten")`, `button:has-text("Rapporten")`, `[href*="rapport"]`, etc.)

2. **CSV column names and format**
   - What we know: CSV should contain nikki_id, lid_nr, hoofdsom, saldo and possibly other columns
   - What's unclear: Exact column names (case sensitivity, language), delimiter (comma vs semicolon common in Europe), encoding (UTF-8 vs Latin-1)
   - Recommendation: Log actual column names on first run. Use flexible column mapping to handle variations. Configure csv-parse with `bom: true` and `relax_column_count: true` for robustness.

3. **Definition of "hoofdsom" vs "saldo"**
   - What we know: Both are financial amounts, saldo is already scraped from HTML
   - What's unclear: Exact business meaning - assumed hoofdsom = total amount owed, saldo = remaining balance, but not confirmed
   - Recommendation: Validate with a stakeholder or by comparing sample data. Document the meaning in code comments once confirmed.

4. **Matching strategy when lid_nr differs from knvb_id**
   - What we know: HTML table has knvb_id, CSV has both nikki_id and lid_nr
   - What's unclear: Is lid_nr always equal to knvb_id? Should we match by nikki_id only, or also validate lid_nr matches?
   - Recommendation: Primary match by nikki_id (appears in both sources). Optionally log warning if lid_nr != knvb_id when both are present.

5. **Members without nikki_id**
   - What we know: Requirement MATCH-03 says handle missing nikki_id gracefully
   - What's unclear: How common is this? Should we create nikki_id for them, or just skip CSV matching?
   - Recommendation: Skip CSV matching for records without nikki_id, set hoofdsom to null, log count of unmatched records. Don't fail sync.

## Sources

### Primary (HIGH confidence)
- [Playwright Downloads Documentation](https://playwright.dev/docs/downloads) - Official API for download handling
- [Playwright Download Class API](https://playwright.dev/docs/api/class-download) - download.saveAs(), download.suggestedFilename() methods
- [csv-parse Documentation](https://csv.js.org/parse/) - Official Node.js CSV parsing library
- Existing codebase: download-nikki-contributions.js, lib/nikki-db.js - Current implementation patterns

### Secondary (MEDIUM confidence)
- [How to download a file with Playwright - ScrapingAnt](https://scrapingant.com/blog/playwright-download-file) - Practical examples verified against official docs
- [How to Download Files with Playwright - Checkly](https://www.checklyhq.com/docs/learn/playwright/file-download/) - Additional download patterns
- [JavaScript CSV Parsers Comparison - Leany Labs](https://leanylabs.com/blog/js-csv-parsers-benchmarks/) - Performance benchmarks (csv-parse vs papaparse vs others)
- [Top 5 JavaScript CSV Parsers - OneSchema](https://www.oneschema.co/blog/top-5-javascript-csv-parsers) - Library comparison and use cases
- [Papa Parse vs csv-parse performance - npm-compare](https://npm-compare.com/csv-parse,csv-parser,fast-csv,papaparse) - Weekly download stats and performance comparison

### Tertiary (LOW confidence)
- [CSV Formatting Tips - Integrate.io](https://www.integrate.io/blog/csv-formatting-tips-and-tricks-for-data-accuracy/) - General CSV best practices
- [Ultimate Guide to CSV File Validation - Disbug](https://disbug.io/en/blog/ultimate-guide-csv-file-validation-data-quality-systems/) - Validation patterns (not library-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Playwright and csv-parse are industry standards with official documentation
- Architecture: HIGH - Patterns verified against official Playwright and csv-parse docs, plus existing codebase patterns
- Pitfalls: MEDIUM - Derived from official docs + community experience, but some specific to Nikki site behavior (unknown until tested)

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - stable libraries, slow-moving domain)
