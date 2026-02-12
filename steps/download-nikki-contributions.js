require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');
const { parse } = require('csv-parse');
const { openDb, upsertContributions, pruneOldContributions } = require('../lib/nikki-db');
const { createSyncLogger } = require('../lib/logger');
const { readEnv, parseCliArgs } = require('../lib/utils');
const { createDebugLogger, isDebugEnabled } = require('../lib/log-adapters');
const { generateTotp } = require('../lib/totp');

/**
 * Parse European currency format to number.
 * "€ 1.234,56" → 1234.56
 * "€ 0,00" → 0
 * @param {string} value - Currency string
 * @returns {number} - Parsed number
 */
function parseEuroAmount(value) {
  if (!value || typeof value !== 'string') return 0;

  // Remove currency symbol, spaces, and non-breaking spaces
  let cleaned = value.replace(/[€\s\u00A0]/g, '').trim();

  if (!cleaned) return 0;

  // European format: 1.234,56 → remove dots (thousands), replace comma (decimal) with period
  // Handle both formats in case of inconsistency
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // 1.234,56 format - dot is thousands, comma is decimal
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Just comma - assume decimal separator
    cleaned = cleaned.replace(',', '.');
  }
  // If just periods, assume already in correct format

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Login to Nikki
 */
async function loginToNikki(page, logger) {
  const username = readEnv('NIKKI_USERNAME');
  const password = readEnv('NIKKI_PASSWORD');
  const otpSecret = readEnv('NIKKI_OTP_SECRET');

  if (!username || !password) {
    throw new Error('Missing NIKKI_USERNAME or NIKKI_PASSWORD');
  }

  logger.verbose('Navigating to Nikki login page...');
  await page.goto('https://mijn.nikki-online.nl/', { waitUntil: 'domcontentloaded' });

  // Wait for login form to load
  await page.waitForSelector('input[name="username"]', { timeout: 15000 });

  logger.verbose('Filling login credentials...');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);

  const otpField = await page.$('input[name="otp"]');
  if (otpField) {
    if (!otpSecret) {
      throw new Error('Missing NIKKI_OTP_SECRET - 2FA required but no secret configured');
    }
    logger.verbose('Generating OTP code...');
    const otpCode = generateTotp(otpSecret);
    await otpField.fill(otpCode);
  }

  await page.waitForTimeout(3000);
  await page.click('button[type="submit"]');

  logger.verbose('Waiting for login to complete...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL((url) => !url.includes('login'), { timeout: 15000 }).catch(() => null);

  // Verify login success by checking for a logged-in element
  try {
    // Look for navigation or user menu that indicates successful login
    await page.waitForSelector('nav, .navbar, .sidebar, [data-testid="user-menu"]', { timeout: 15000 });
    logger.verbose('Login successful');
  } catch (error) {
    // Try checking for /leden page access as alternative verification
    const currentUrl = page.url();
    if (!currentUrl.includes('login')) {
      logger.verbose('Login appears successful (no login page)');
    } else {
      throw new Error('Login failed: Still on login page after authentication');
    }
  }

  const cookies = await page.context().cookies();
  const phpSession = cookies.find((cookie) => cookie.name === 'PHPSESSID');
  if (phpSession) {
    logger.verbose(`PHPSESSID set for ${phpSession.domain}${phpSession.path}`);
  } else {
    logger.verbose('PHPSESSID cookie not found after login.');
  }

  const loginFormVisible = await page.$('input[name="username"], input[name="password"]');
  if (loginFormVisible) {
    logger.verbose('Login form still visible after submit.');
    const debugDir = path.join(process.cwd(), 'debug');
    await fs.mkdir(debugDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(debugDir, `nikki-login-failed-${timestamp}.png`);
    const htmlPath = path.join(debugDir, `nikki-login-failed-${timestamp}.html`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    logger.verbose(`  Saved debug screenshot: ${screenshotPath}`);
    logger.verbose(`  Saved debug HTML: ${htmlPath}`);
    throw new Error('Login failed: login form still visible');
  }
}

/**
 * Scrape contribution data from the /leden datatable.
 * Waits for DataTables AJAX to complete before scraping.
 */
async function scrapeContributions(page, logger) {
  logger.verbose('Navigating to /leden page...');
  await page.waitForTimeout(1000);
  await page.goto('https://mijn.nikki-online.nl/leden', { waitUntil: 'domcontentloaded' });

  // Check if we got redirected back to login
  const onLoginPage = await page.$('input[name="username"], input[name="password"]');
  if (onLoginPage) {
    throw new Error('Session expired: redirected to login page');
  }

  // Wait for DataTables to populate via AJAX before scraping
  logger.verbose('Waiting for DataTables to load data...');
  try {
    await page.waitForSelector('#datatable, table', { timeout: 10000 });
    await page.waitForSelector('#datatable tbody tr, table tbody tr', { timeout: 15000 });
    await page.waitForTimeout(2000);

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#datatable') || document.querySelector('table');
      return table ? table.querySelectorAll('tbody tr').length : 0;
    });
    logger.verbose(`Table loaded with ${rowCount} rows`);
  } catch (error) {
    logger.verbose(`Warning: Could not wait for table rows: ${error.message}`);
  }

  // Scrape from live DOM (after AJAX completes)
  const html = await page.content();
  const rows = await page.evaluate((rawHtml) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    const table = doc.querySelector('#datatable') || doc.querySelector('table');
    if (!table) return [];
    const rowNodes = table.querySelectorAll('tbody tr');
    return Array.from(rowNodes).map((row) => (
      Array.from(row.querySelectorAll('td')).map(cell => cell.textContent?.trim() || '')
    ));
  }, html);

  const contributions = rows
    .map((cells) => {
      if (!cells || cells.length < 8) return null;
      const [jaar, , , lidnr, , nikkiId, saldo, status] = cells;
      if (!jaar || !lidnr || !nikkiId) return null;
      return { year: jaar, knvb_id: lidnr, nikki_id: nikkiId, saldo_raw: saldo, status };
    })
    .filter(Boolean);

  logger.verbose(`Scraped ${contributions.length} rows from table`);
  return contributions;
}

/**
 * Download CSV from Rapporten link and parse it.
 * Returns array of { nikki_id, lid_nr, hoofdsom, ... }
 */
async function downloadAndParseCsv(page, logger) {
  logger.verbose('Starting CSV download from Rapporten link...');

  // Create downloads directory
  const downloadsDir = path.join(process.cwd(), 'downloads');
  await fs.mkdir(downloadsDir, { recursive: true });

  // CRITICAL: Set up download listener BEFORE clicking (race condition prevention)
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

  // Click the Rapporten link - try multiple selectors for robustness
  const rapportenSelectors = [
    'a:has-text("Rapporten")',
    'button:has-text("Rapporten")',
    '[href*="rapport"]',
    'a[href*="export"]',
    '.export-btn'
  ];

  let clicked = false;
  for (const selector of rapportenSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        clicked = true;
        logger.verbose(`Clicked Rapporten using selector: ${selector}`);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!clicked) {
    logger.verbose('Could not find Rapporten link - CSV download skipped');
    return null;
  }

  // Wait for download to complete
  let download;
  try {
    download = await downloadPromise;
  } catch (e) {
    logger.verbose(`Download did not start within timeout: ${e.message}`);
    return null;
  }

  // Save file
  const suggestedFilename = download.suggestedFilename() || 'nikki-export.csv';
  const filePath = path.join(downloadsDir, suggestedFilename);
  await download.saveAs(filePath);
  logger.verbose(`CSV downloaded to: ${filePath}`);

  // Parse CSV
  const records = await new Promise((resolve, reject) => {
    const rows = [];
    require('fs').createReadStream(filePath)
      .pipe(parse({
        columns: true,           // Use first row as column names
        delimiter: ';',          // European CSV format uses semicolon
        skip_empty_lines: true,
        trim: true,
        bom: true,               // Handle UTF-8 BOM
        relax_column_count: true, // Handle inconsistent column counts
        quote: false             // Disable quote parsing (Nikki CSV has malformed quotes)
      }))
      .on('data', (row) => rows.push(row))
      .on('error', (err) => {
        logger.error(`CSV parse error: ${err.message}`);
        reject(err);
      })
      .on('end', () => resolve(rows));
  });

  logger.verbose(`Parsed ${records.length} rows from CSV`);

  // Strip quotes from column names (quote:false makes them literal)
  const cleanedRecords = records.map(row => {
    const cleaned = {};
    for (const [key, value] of Object.entries(row)) {
      const cleanKey = key.replace(/^"|"$/g, '');
      const cleanValue = typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
      cleaned[cleanKey] = cleanValue;
    }
    return cleaned;
  });

  // Log column names for debugging (first row)
  if (cleanedRecords.length > 0) {
    logger.verbose(`CSV columns: ${Object.keys(cleanedRecords[0]).join(', ')}`);
  }

  // Clean up file after parsing
  try {
    await fs.unlink(filePath);
    logger.verbose('Cleaned up CSV file');
  } catch (e) {
    logger.verbose(`Could not delete CSV file: ${e.message}`);
  }

  return cleanedRecords;
}

/**
 * Merge HTML table data with CSV data by nikki_id.
 * CSV provides hoofdsom (total amount) not available in HTML.
 */
function mergeHtmlAndCsvData(htmlRecords, csvRecords, logger) {
  if (!csvRecords || csvRecords.length === 0) {
    logger.verbose('No CSV data to merge - using HTML data only');
    return htmlRecords.map(r => ({ ...r, hoofdsom: null }));
  }

  // Build lookup map from CSV (nikki_id -> row)
  const csvMap = new Map();
  for (const csvRow of csvRecords) {
    // Try multiple possible column names for nikki_id
    const key = csvRow.nikki_id || csvRow.nikkiId || csvRow.nikki || csvRow.NikkiId;
    if (key) {
      csvMap.set(key, csvRow);
    }
  }

  logger.verbose(`Built CSV lookup map with ${csvMap.size} entries`);

  // Merge data
  let matchedCount = 0;
  let unmatchedCount = 0;

  const merged = htmlRecords.map(htmlRow => {
    const csvData = csvMap.get(htmlRow.nikki_id);

    if (csvData) {
      // Extract hoofdsom from CSV - try multiple column names
      const hoofdsomRaw = csvData.hoofdsom || csvData.Hoofdsom || csvData.total || csvData.Total || csvData.totaal || csvData.Totaal || '0';
      const hoofdsom = parseEuroAmount(hoofdsomRaw);
      matchedCount++;

      return {
        ...htmlRow,
        hoofdsom: hoofdsom
      };
    } else {
      // No match - gracefully set hoofdsom to null
      unmatchedCount++;
      return {
        ...htmlRow,
        hoofdsom: null
      };
    }
  });

  logger.verbose(`Merged: ${matchedCount} matched, ${unmatchedCount} unmatched (gracefully handled)`);
  return merged;
}

/**
 * Main download orchestration
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, count: number, error?: string}>}
 */
async function runNikkiDownload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'nikki' });

  const result = {
    success: true,
    count: 0,
    error: null
  };

  const db = openDb();
  try {
    logger.log('Starting Nikki contributions download');

    const logDebug = createDebugLogger();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    });

    // Block problematic JS files that interfere with scraping
    const blockedUrls = [
      'https://ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js',
      'https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/js/bootstrap.min.js',
      'https://mijn.nikki-online.nl/js/main.js'
    ];
    await context.route('**/*', (route) => {
      if (blockedUrls.includes(route.request().url())) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const page = await context.newPage();

    if (isDebugEnabled()) {
      page.on('request', r => logDebug('>>', r.method(), r.url()));
      page.on('response', r => logDebug('<<', r.status(), r.url()));
    }

    try {
      await loginToNikki(page, logger);

      const rawContributions = await scrapeContributions(page, logger);
      const csvRecords = await downloadAndParseCsv(page, logger);

      // Parse and validate contributions from HTML
      const htmlContributions = rawContributions
        .map((raw) => ({
          knvb_id: raw.knvb_id,
          year: parseInt(raw.year, 10),
          nikki_id: raw.nikki_id,
          saldo: parseEuroAmount(raw.saldo_raw),
          status: raw.status || null
        }))
        .filter((c) => c.knvb_id && c.year > 0 && c.nikki_id);

      // Merge with CSV data (adds hoofdsom field)
      const contributions = mergeHtmlAndCsvData(htmlContributions, csvRecords, logger);
      logger.verbose(`Parsed ${contributions.length} valid contributions`);

      if (contributions.length > 0) {
        upsertContributions(db, contributions);

        const pruned = pruneOldContributions(db);
        if (pruned > 0) {
          logger.verbose(`Pruned ${pruned} old contribution records`);
        }

        result.count = contributions.length;
      }

      logger.log(`Downloaded ${result.count} contributions from Nikki`);
    } finally {
      await browser.close();
    }

    return result;
  } catch (error) {
    result.success = false;
    result.error = error.message;
    logger.error(`Download failed: ${error.message}`);
    return result;
  } finally {
    db.close();
  }
}

module.exports = { runNikkiDownload, parseEuroAmount };

if (require.main === module) {
  const { verbose } = parseCliArgs();
  runNikkiDownload({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
