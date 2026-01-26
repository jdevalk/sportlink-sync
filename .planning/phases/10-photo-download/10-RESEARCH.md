# Phase 10: Photo Download - Research

**Researched:** 2026-01-26
**Domain:** Browser automation with Playwright for photo extraction
**Confidence:** HIGH

## Summary

This phase extends the existing Playwright browser automation (download-data-from-sportlink.js) to navigate member detail pages and download photos. The standard approach reuses the authenticated browser session from CSV download, navigates to member pages sequentially, extracts image URLs from modals or img elements, and saves files to disk using Node.js fs module with proper extension detection.

Phase 9 already provides the foundation: PersonImageDate tracking in SQLite identifies which members have photos and detects changes. This phase consumes that state (photo_state = 'pending_download') and produces local files in photos/ directory, updating state to 'downloaded' on success.

**Primary recommendation:** Extend the existing download-data-from-sportlink.js with a new exported function (runPhotoDownload) that accepts an authenticated page/context, processes members sequentially with natural delays (1-3 sec random), extracts images via response interception or direct URL fetch, detects format from Content-Type header, and saves with proper extensions. Use better-sqlite3 transactions for batch state updates and track failures separately for retry capability.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | latest (already installed) | Browser automation | Industry standard for headless browser control, used in existing CSV download |
| better-sqlite3 | latest (already installed) | State tracking database | Synchronous API perfect for transaction-based state updates, already used for Stadion sync |
| Node.js fs/promises | Node 18+ native | File I/O operations | Built-in async file operations, no dependencies needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| file-type | 19.x (if needed) | MIME type detection from buffer | Only if Content-Type headers are unreliable, NOT recommended for initial implementation |
| axios | N/A | HTTP client | NOT NEEDED - Playwright's page.context().request.get() provides built-in HTTP client |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright request API | axios + fs streams | Axios requires additional dependency; Playwright already provides HTTP client via APIRequestContext |
| Content-Type header mapping | file-type npm package | file-type adds dependency and processing overhead; Content-Type is standard and reliable |
| Sequential processing | Parallel batching | Parallel increases complexity and rate-limit risk; sequential is simpler and more debuggable per user decision |

**Installation:**
No additional packages needed - all dependencies already in package.json.

## Architecture Patterns

### Recommended Project Structure
```
sportlink-sync/
├── download-data-from-sportlink.js  # Extend with photo download function
├── photos/                           # NEW: Local photo storage (gitignored)
│   ├── <PublicPersonId>.jpg
│   ├── <PublicPersonId>.png
│   └── <PublicPersonId>.webp
├── lib/
│   ├── stadion-db.js                # Already has getMembersByPhotoState
│   └── logger.js                    # Reuse existing logger
└── logs/                            # Existing log directory
```

### Pattern 1: Extend Existing Browser Session
**What:** Add photo download as second phase after CSV download completes, reusing authenticated browser context
**When to use:** When you need authenticated access and want to minimize login overhead
**Example:**
```javascript
// Source: Existing pattern from download-data-from-sportlink.js + Playwright auth docs
async function runDownload(options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Existing CSV download logic...
  await loginAndDownloadCSV(page);

  // NEW: Photo download using same session
  await downloadPhotos(page, context, logger);

  await browser.close();
}
```

### Pattern 2: Response Interception for Image Extraction
**What:** Use Playwright's response events to capture image requests during navigation
**When to use:** When images load dynamically in modals or require click actions to trigger
**Example:**
```javascript
// Source: Playwright response handling patterns
async function extractPhotoFromModal(page, memberUrl, knvbId) {
  const imagePromise = page.waitForResponse(
    resp => resp.url().includes('image') && resp.ok(),
    { timeout: 10000 }
  );

  await page.goto(memberUrl);
  await page.click('.photo-thumbnail'); // Opens modal

  const response = await imagePromise;
  const buffer = await response.body();
  const contentType = response.headers()['content-type'];
  const ext = mimeToExtension(contentType);

  await fs.writeFile(`photos/${knvbId}.${ext}`, buffer);
}
```

### Pattern 3: Direct Image URL Fetch
**What:** If image URL is directly accessible in page HTML, fetch via Playwright's request API
**When to use:** When image src is in DOM and doesn't require modal interaction (simpler/faster)
**Example:**
```javascript
// Source: Playwright APIRequestContext + WebSearch findings
async function downloadPhotoDirectly(context, imgUrl, knvbId) {
  const response = await context.request.get(imgUrl);
  if (!response.ok()) {
    throw new Error(`Failed to fetch image: ${response.status()}`);
  }

  const buffer = await response.body();
  const contentType = response.headers()['content-type'];
  const ext = mimeToExtension(contentType);

  await fs.promises.writeFile(`photos/${knvbId}.${ext}`, buffer);
}
```

### Pattern 4: State Management with Transactions
**What:** Use better-sqlite3 transactions for batch state updates, tracking success/failure separately
**When to use:** Always - ensures atomic updates and provides rollback on errors
**Example:**
```javascript
// Source: better-sqlite3 docs + existing stadion-db.js pattern
const { updatePhotoState } = require('./lib/stadion-db');

// Track results during processing
const results = { downloaded: 0, skipped: 0, failed: [] };

// Update states in transaction after batch completes
const updateStates = db.transaction((updates) => {
  updates.forEach(({ knvbId, state, error }) => {
    if (error) {
      // Track failure separately - could add error column to schema
      results.failed.push({ knvbId, error });
    } else {
      updatePhotoState(db, knvbId, state);
      results.downloaded++;
    }
  });
});

updateStates(batchResults);
```

### Anti-Patterns to Avoid
- **Opening new browser per member:** Wastes time re-authenticating; reuse context
- **Hardcoded file extensions:** Images may be jpg/png/webp; detect from Content-Type
- **Ignoring rate limits:** No delays between requests triggers anti-bot measures
- **Downloading unchanged photos:** Check PersonImageDate hash before fetching
- **Synchronous fs operations in loops:** Use fs.promises for better performance
- **Blocking on failures:** Log error and continue to next member; don't abort batch

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for images | Custom request wrapper | Playwright page.context().request | Already authenticated, handles cookies/sessions automatically |
| MIME type to extension | String parsing | Simple map object or Content-Type header | Standard mappings: image/jpeg→jpg, image/png→png, image/webp→webp |
| File existence checking | Manual fs.stat wrapping | fs.promises.access or direct writeFile | Overwrite strategy is simpler; check PersonImageDate instead |
| Retry logic with backoff | Custom exponential backoff | Sequential processing + error tracking | Small dataset, retry on next run is sufficient |
| Progress bars/spinners | CLI UI libraries | Simple console.log counters | Logger already provides structured output |

**Key insight:** Playwright provides authenticated HTTP client (APIRequestContext), state management is already in SQLite with transactions, and file operations are simple enough with native fs/promises. Don't over-engineer - the scope is ~50-200 photos, not millions.

## Common Pitfalls

### Pitfall 1: Session Expiration During Long Runs
**What goes wrong:** Sportlink session times out mid-processing, causing 401 errors on later member requests
**Why it happens:** Photo download runs after CSV download; combined time may exceed session timeout
**How to avoid:**
- Add session validity check before photo download phase starts
- If download list is large (>100), consider re-authenticating or checking for 401 responses
- Implement graceful degradation: log error, mark member as failed, continue processing
**Warning signs:** HTTP 401/403 responses, redirect to login page, missing expected DOM elements

### Pitfall 2: Incorrect File Extension Handling
**What goes wrong:** Saving all images as .jpg when some are .png or .webp, causing format corruption
**Why it happens:** Assuming JPEG format or using wrong Content-Type mapping
**How to avoid:**
- Always read Content-Type header from response
- Use standard MIME type mapping: `image/jpeg` → `jpg`, `image/png` → `png`, `image/webp` → `webp`
- Fallback to `.jpg` only if Content-Type is missing or unrecognized
- Log warnings when using fallback extension
**Warning signs:** Photos won't open, image viewers report format errors, file command shows mismatch

### Pitfall 3: Race Conditions in Modal Navigation
**What goes wrong:** Clicking photo triggers modal, but script tries to extract before image loads
**Why it happens:** Not waiting for image response or modal animation to complete
**How to avoid:**
- Use page.waitForResponse() with appropriate timeout before clicking
- Or use page.waitForSelector() on modal image element with visible state
- Set reasonable timeout (5-10 sec) and handle timeout errors gracefully
**Warning signs:** Timeout errors, null buffers, incomplete downloads, intermittent failures

### Pitfall 4: Not Handling Missing Photos Gracefully
**What goes wrong:** Member has PersonImageDate but photo doesn't exist on page (data sync lag)
**Why it happens:** Sportlink data and web UI may be out of sync temporarily
**How to avoid:**
- Try to locate photo element/URL; if not found, log warning and skip
- Don't mark as error - may resolve on next run
- Track as separate "not_found" count distinct from failures
**Warning signs:** Selector errors, 404 responses, empty img src attributes

### Pitfall 5: File System Permissions and Directory Creation
**What goes wrong:** fs.writeFile fails because photos/ directory doesn't exist
**Why it happens:** Assuming directory exists, not creating it proactively
**How to avoid:**
- Create photos/ directory with fs.promises.mkdir(path, { recursive: true }) before processing
- Follow existing pattern from logger.js (ensureLogsDir function)
- Add photos/ to .gitignore
**Warning signs:** ENOENT errors, file write failures

### Pitfall 6: Transaction Scope Too Large
**What goes wrong:** Wrapping entire download loop in single transaction causes rollback on any error
**Why it happens:** Misunderstanding better-sqlite3 transaction behavior - async breaks transactions
**How to avoid:**
- Transactions only work with synchronous code
- Photo download is async (network I/O) - can't wrap in transaction
- Instead: collect results in memory, then update states in transaction after batch completes
- Follow pattern: async work → collect results → sync transaction for DB updates
**Warning signs:** "Cannot use transaction with async functions" errors, premature commits

## Code Examples

Verified patterns from official sources:

### MIME Type to Extension Mapping
```javascript
// Source: HTTP Content-Type standards + web search findings
function mimeToExtension(contentType) {
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  // Extract base MIME type (ignore charset)
  const baseType = (contentType || '').split(';')[0].trim().toLowerCase();
  return mimeMap[baseType] || 'jpg'; // Fallback to jpg
}
```

### Natural Pacing with Random Delays
```javascript
// Source: Existing pattern in download-data-from-sportlink.js lines 103-105
async function randomDelay(minSeconds = 1, maxSeconds = 3) {
  const waitSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
}

// Usage in loop:
for (const member of membersToProcess) {
  await downloadPhoto(member);
  await randomDelay(1, 3); // 1-3 second delay
}
```

### Directory Initialization
```javascript
// Source: Existing pattern from lib/logger.js lines 15-18
const fs = require('fs/promises');
const path = require('path');

const PHOTOS_DIR = path.join(process.cwd(), 'photos');

async function ensurePhotosDir() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
}
```

### Photo Download with Error Handling
```javascript
// Source: Playwright request API + existing error handling patterns
async function downloadMemberPhoto(context, member, logger) {
  try {
    // Construct member detail page URL (pattern TBD - need to inspect Sportlink)
    const memberUrl = `https://club.sportlink.com/member/${member.knvb_id}`;

    // Navigate and extract image URL (approach depends on page structure)
    const imgUrl = await extractImageUrl(page, memberUrl);
    if (!imgUrl) {
      logger.verbose(`No photo found for member ${member.knvb_id}`);
      return { knvbId: member.knvb_id, status: 'not_found' };
    }

    // Fetch image
    const response = await context.request.get(imgUrl);
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()}`);
    }

    // Save to disk
    const buffer = await response.body();
    const contentType = response.headers()['content-type'];
    const ext = mimeToExtension(contentType);
    const filename = `${member.knvb_id}.${ext}`;
    const filepath = path.join(PHOTOS_DIR, filename);

    await fs.writeFile(filepath, buffer);

    logger.verbose(`Downloaded photo for ${member.knvb_id} (${buffer.length} bytes, ${ext})`);
    return { knvbId: member.knvb_id, status: 'downloaded', filepath };

  } catch (err) {
    logger.error(`Failed to download photo for ${member.knvb_id}: ${err.message}`);
    return { knvbId: member.knvb_id, status: 'failed', error: err.message };
  }
}
```

### Batch State Update with Transaction
```javascript
// Source: better-sqlite3 docs + existing stadion-db.js pattern
const { openDb, updatePhotoState } = require('./lib/stadion-db');

function updatePhotoStates(results) {
  const db = openDb();

  try {
    const updateBatch = db.transaction((items) => {
      items.forEach(item => {
        if (item.status === 'downloaded') {
          updatePhotoState(db, item.knvbId, 'downloaded');
        }
        // Note: failures tracked separately, retry on next run
      });
    });

    updateBatch(results);
  } finally {
    db.close();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| download.path() for files | download.saveAs() with explicit path | Playwright 1.12+ | More explicit control over download location |
| page.waitForSelector for images | page.waitForResponse for network requests | Current best practice | More reliable for dynamic content |
| request module for HTTP | Playwright APIRequestContext | request deprecated 2020 | Reuse authenticated session, fewer dependencies |
| manual MIME detection | Content-Type header reading | Always standard | Simpler, more reliable than magic number detection |

**Deprecated/outdated:**
- **request npm package**: Deprecated since 2020; use Playwright's built-in request API or native fetch
- **download.path() without saveAs**: Temporary files are deleted when context closes; always use saveAs for persistence
- **Synchronous fs methods in async code**: Use fs.promises for better performance and cleaner code

## Open Questions

Things that couldn't be fully resolved:

1. **Sportlink Photo Page Structure**
   - What we know: Members have PersonImageDate field, implying photos exist
   - What's unclear: Exact URL pattern for member detail pages, whether photo is in DOM or requires modal click
   - Recommendation: First task should inspect Sportlink member page structure manually or with DEBUG_LOG=true to identify selectors and navigation pattern

2. **Photo Modal Behavior**
   - What we know: User decision indicates "click thumbnail/avatar to open full-size photo modal"
   - What's unclear: Whether modal shows image as img src or loads via fetch, modal selector pattern
   - Recommendation: Use page.on('response') listener to capture image request, or locate img element in modal and extract src attribute

3. **Resume Strategy After Failure**
   - What we know: User wants "resumable on re-run: skip already-downloaded photos (fresh login required)"
   - What's unclear: Whether to check file existence or rely on photo_state column exclusively
   - Recommendation: Check photo_state = 'pending_download' only; if file exists but state is 'downloaded', skip. This handles manual file deletion correctly.

4. **Handling Members with Photos But No Detail Page**
   - What we know: Edge case where PersonImageDate exists but member page doesn't (data sync delay)
   - What's unclear: How frequent this is, whether to retry immediately or mark for later
   - Recommendation: Log as "not_found", don't update state, will retry on next run when data syncs

## Sources

### Primary (HIGH confidence)
- [Playwright Downloads Documentation](https://playwright.dev/docs/downloads) - Download event handling, saveAs method
- [Playwright Authentication Documentation](https://playwright.dev/docs/auth) - Session reuse, browser context management
- [better-sqlite3 API Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) - Transaction handling, error management
- Existing codebase:
  - download-data-from-sportlink.js (lines 52-159) - Browser automation patterns, random delays
  - lib/stadion-db.js (lines 410-450) - Photo state tracking functions
  - lib/logger.js (lines 15-18, 99-110) - Directory initialization, logging patterns

### Secondary (MEDIUM confidence)
- [BrowserStack Playwright Best Practices 2026](https://www.browserstack.com/guide/playwright-best-practices) - Test isolation, selector stability, verified with official docs
- [Playwright Web Scraping Tutorial](https://www.checklyhq.com/docs/learn/playwright/web-scraping/) - Web scraping patterns with Playwright, getAttribute for src extraction
- [Web Scraping Rate Limiting Best Practices](https://www.scrapehero.com/rate-limiting-in-web-scraping/) - Random delays 1-5 seconds, exponential backoff patterns
- [Node.js fs.writeFile with Buffers](https://nodejs.org/api/fs.html) - Official Node.js documentation for file I/O

### Tertiary (LOW confidence - flagged for validation)
- [file-type npm package](https://www.npmjs.com/package/file-type) - MIME detection from buffer, marked LOW because Content-Type headers should be sufficient
- [image-downloader package](https://www.npmjs.com/package/image-downloader) - Not recommended; Playwright provides better integration

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Playwright and better-sqlite3 already in use, patterns proven in existing code
- Architecture: HIGH - Patterns verified against official Playwright docs and existing codebase patterns
- Pitfalls: MEDIUM - Based on common Playwright issues and better-sqlite3 async constraints; actual Sportlink page structure unknown until inspection

**Research date:** 2026-01-26
**Valid until:** 2026-02-25 (30 days - stable domain with mature tooling)
