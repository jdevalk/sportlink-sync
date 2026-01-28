require('varlock/auto-load');

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const otplib = require('otplib');
const { chromium } = require('playwright');
const {
  openDb,
  upsertContributions,
  getContributionCount,
  clearContributions
} = require('./lib/nikki-db');
const { createSyncLogger } = require('./lib/logger');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function createDebugLogger(enabled) {
  return (...args) => {
    if (enabled) {
      console.log(...args);
    }
  };
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function generateAsciiTotp(secret, digits = 6, step = 30) {
  const counter = Math.floor(Date.now() / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'ascii')).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  const otp = (code % (10 ** digits)).toString().padStart(digits, '0');
  return otp;
}

function decodeBase32(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function parseOtpAuthUrl(value) {
  if (!value || !value.startsWith('otpauth://')) return null;
  let url = null;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secret = url.searchParams.get('secret') || '';
  const issuer = url.searchParams.get('issuer') || '';
  const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  const digits = Number.parseInt(url.searchParams.get('digits') || '6', 10);
  const period = Number.parseInt(url.searchParams.get('period') || '30', 10);
  return { secret, issuer, algorithm, digits, period };
}

function generateTotpFromSecret(secretValue) {
  const parsed = parseOtpAuthUrl(secretValue);
  if (parsed) {
    const key = decodeBase32(parsed.secret);
    return generateTotpWithKey(key, parsed.digits, parsed.period, parsed.algorithm);
  }
  return generateAsciiTotp(secretValue);
}

function generateTotpWithKey(key, digits = 6, step = 30, algorithm = 'SHA1') {
  const counter = Math.floor(Date.now() / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const algo = String(algorithm || 'SHA1').toLowerCase();
  const hmac = crypto.createHmac(algo, key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  const otp = (code % (10 ** digits)).toString().padStart(digits, '0');
  return otp;
}

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
    const otpCode = generateTotpFromSecret(otpSecret);
    if (!otpCode) {
      throw new Error('OTP generation failed');
    }
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
 * Scrape contribution data from the /leden datatable
 */
async function scrapeContributions(page, logger) {
  logger.verbose('Navigating to /leden page...');
  await page.waitForTimeout(1000);
  const response = await page.goto('https://mijn.nikki-online.nl/leden', { waitUntil: 'domcontentloaded' });
  if (response) {
    logger.verbose(`  /leden response: ${response.status()} ${response.url()}`);
  }
  logger.verbose(`  /leden URL: ${page.url()}`);
  try {
    const title = await page.title();
    logger.verbose(`  /leden title: ${title}`);
  } catch (error) {
    logger.verbose(`  /leden title unavailable: ${error.message}`);
  }
  const onLoginPage = await page.$('input[name="username"], input[name="password"]');
  if (onLoginPage) {
    logger.verbose('  /leden appears to show login form.');
  }
  try {
    const htmlLength = await page.evaluate(() => document.documentElement?.outerHTML?.length || 0);
    logger.verbose(`  /leden HTML size: ${htmlLength} chars`);
  } catch (error) {
    logger.verbose(`  /leden HTML size unavailable: ${error.message}`);
  }

  logger.verbose('Scraping table data from response HTML...');
  const html = response ? await response.text() : await page.content();
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
      const jaar = cells[0];
      const lidnr = cells[3];
      const nikkiId = cells[5];
      const saldo = cells[6];
      const status = cells[7];
      if (!jaar || !lidnr || !nikkiId) return null;
      return {
        year: jaar,
        knvb_id: lidnr,
        nikki_id: nikkiId,
        saldo_raw: saldo,
        status: status
      };
    })
    .filter(Boolean);

  logger.verbose(`Scraped ${contributions.length} rows from table`);
  return contributions;
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

    const debugEnabled = parseBool(readEnv('DEBUG_LOG', 'false'));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url === 'https://ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js' ||
        url === 'https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/js/bootstrap.min.js' ||
        url === 'https://mijn.nikki-online.nl/js/main.js'
      ) {
        route.abort();
        return;
      }
      route.continue();
    });
    const page = await context.newPage();
    const runtimeUserAgent = await page.evaluate(() => navigator.userAgent);
    logger.verbose(`Using user agent: ${runtimeUserAgent}`);

    if (debugEnabled) {
      const logDebug = createDebugLogger(true);
      page.on('request', r => logDebug('>>', r.method(), r.url()));
      page.on('response', r => logDebug('<<', r.status(), r.url()));
    }

    try {
      await loginToNikki(page, logger);

      const rawContributions = await scrapeContributions(page, logger);

      // Parse and validate contributions
      const contributions = rawContributions.map((raw) => {
        const year = parseInt(raw.year, 10);
        const saldo = parseEuroAmount(raw.saldo_raw);

        return {
          knvb_id: raw.knvb_id,
          year: isNaN(year) ? 0 : year,
          nikki_id: raw.nikki_id,
          saldo: saldo,
          status: raw.status || null
        };
      }).filter((c) => c.knvb_id && c.year > 0 && c.nikki_id);

      logger.verbose(`Parsed ${contributions.length} valid contributions`);

      if (contributions.length > 0) {
        // Clear existing data for fresh import
        clearContributions(db);

        // Store to database
        upsertContributions(db, contributions);
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

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runNikkiDownload({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
