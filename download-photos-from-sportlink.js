require('varlock/auto-load');

const fs = require('fs/promises');
const path = require('path');
const otplib = require('otplib');
const { chromium } = require('playwright');
const { openDb, getMembersByPhotoState, updatePhotoState } = require('./lib/stadion-db');
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

/**
 * MIME type to file extension mapping
 */
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

/**
 * Extract base MIME type and map to file extension
 */
function mimeToExtension(contentType) {
  const baseType = (contentType || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[baseType] || 'jpg';
}

function extractUrlFromCss(value) {
  if (!value) return null;
  const match = String(value).match(/url\(["']?(.*?)["']?\)/i);
  return match ? match[1] : null;
}

/**
 * Ensure photos directory exists
 */
async function ensurePhotosDir() {
  const photosDir = path.join(process.cwd(), 'photos');
  await fs.mkdir(photosDir, { recursive: true });
  return photosDir;
}

/**
 * Login to Sportlink (reuses pattern from download-data-from-sportlink.js)
 */
async function loginToSportlink(page, logger) {
  const username = readEnv('SPORTLINK_USERNAME');
  const password = readEnv('SPORTLINK_PASSWORD');
  const otpSecret = readEnv('SPORTLINK_OTP_SECRET');

  if (!username || !password) {
    throw new Error('Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD');
  }

  logger.verbose('Navigating to Sportlink login page...');
  await page.goto('https://club.sportlink.com/', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#kc-login');

  logger.verbose('Waiting for OTP field...');
  await page.waitForSelector('#otp', { timeout: 20000 });

  if (!otpSecret) {
    throw new Error('Missing SPORTLINK_OTP_SECRET');
  }

  const otpCode = await otplib.generate({ secret: otpSecret });
  if (!otpCode) {
    throw new Error('OTP generation failed');
  }

  await page.fill('#otp', otpCode);
  await page.click('#kc-login');

  logger.verbose('Waiting for login to complete...');
  await page.waitForLoadState('networkidle');

  try {
    await page.waitForSelector('#panelHeaderTasks', { timeout: 30000 });
    logger.verbose('Login successful');
  } catch (error) {
    throw new Error('Login failed: Could not find dashboard element');
  }
}

/**
 * Download photo for a single member
 */
async function downloadMemberPhoto(page, context, knvbId, photosDir, logger) {
  const memberUrl = `https://club.sportlink.com/member/member-details/${knvbId}/general`;

  logger.verbose(`  Navigating to ${memberUrl}...`);
  await page.goto(memberUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  // Try to find photo element - check for common patterns
  // First, look for photo container or img element
  let imgUrl = null;

  try {
    // Strategy 0: Click header to open modal, then use avatar container
    const headerSelector = '#photoUploadDetailPageHeader';
    const avatarSelector = 'div.Avatarsc__StyledAvatar-sc-fbjb43-1';
    const avatarImgSelector = `${avatarSelector} img`;
    const header = await page.waitForSelector(headerSelector, { timeout: 5000 }).catch(() => null);
    if (!header) {
      logger.verbose('  Photo header not found.');
      const debugDir = path.join(process.cwd(), 'debug');
      await fs.mkdir(debugDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(debugDir, `photo-missing-${knvbId}-${timestamp}.png`);
      const htmlPath = path.join(debugDir, `photo-missing-${knvbId}-${timestamp}.html`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      await fs.writeFile(htmlPath, html, 'utf8');
      logger.verbose(`  Saved debug screenshot: ${screenshotPath}`);
      logger.verbose(`  Saved debug HTML: ${htmlPath}`);
    } else {
      logger.verbose('  Found photo header.');
    }

    const headerAvatarImg = await page.waitForSelector(avatarImgSelector, { timeout: 5000 }).catch(() => null);
    if (headerAvatarImg) {
      imgUrl = await headerAvatarImg.getAttribute('src');
      logger.verbose(`  Found header avatar img: ${imgUrl?.substring(0, 60) || ''}...`);
    } else {
      const headerAvatarContainer = await page.waitForSelector(avatarSelector, { timeout: 2000 }).catch(() => null);
      if (headerAvatarContainer) {
        const backgroundImage = await headerAvatarContainer.evaluate((node) => getComputedStyle(node).backgroundImage);
        imgUrl = extractUrlFromCss(backgroundImage);
        if (imgUrl) {
          logger.verbose(`  Found header avatar background: ${imgUrl.substring(0, 60)}...`);
        }
      }
    }

    if (!imgUrl && header) {
      const iconSelector = `${headerSelector} span.ICON-CAMERA, ${headerSelector} [data-testid="iconCustom03Xsy"]`;
      const icon = await page.$(iconSelector);
      if (icon) {
        logger.verbose('  Clicking photo header icon to open modal...');
        await icon.click();
        await page.waitForTimeout(500);

        const modalAvatar = await page.waitForSelector(avatarImgSelector, { timeout: 5000 }).catch(() => null);
        if (modalAvatar) {
          imgUrl = await modalAvatar.getAttribute('src');
          logger.verbose(`  Found modal avatar img: ${imgUrl?.substring(0, 60) || ''}...`);
        }
      }
    }

    if (!imgUrl) {
      throw new Error('No photo found on page');
    }

    // Normalize URL - make absolute if relative
    if (imgUrl.startsWith('/')) {
      imgUrl = `https://club.sportlink.com${imgUrl}`;
    } else if (imgUrl.startsWith('data:')) {
      throw new Error('Data URLs not supported yet');
    }

    // Fetch the image
    logger.verbose(`  Fetching image from ${imgUrl.substring(0, 60)}...`);
    const response = await context.request.get(imgUrl);

    if (!response.ok()) {
      throw new Error(`Failed to fetch image: HTTP ${response.status()}`);
    }

    // Get image data and determine extension
    const buffer = await response.body();
    const contentType = response.headers()['content-type'];
    const ext = mimeToExtension(contentType);

    // Save to disk
    const filename = `${knvbId}.${ext}`;
    const filepath = path.join(photosDir, filename);
    await fs.writeFile(filepath, buffer);

    logger.verbose(`  Saved ${filename} (${buffer.length} bytes)`);
    return { success: true, path: filepath };

  } catch (error) {
    throw new Error(`Failed to download photo: ${error.message}`);
  }
}

/**
 * Main photo download orchestration
 */
async function runPhotoDownload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  const db = openDb();
  try {
    // Get members needing photo download
    const members = getMembersByPhotoState(db, 'pending_download');
    result.total = members.length;

    if (members.length === 0) {
      logger.log('No photos pending download');
      return result;
    }

    logger.log(`${members.length} photos pending download`);

    const photosDir = await ensurePhotosDir();

    // Launch browser and login
    const debugEnabled = parseBool(readEnv('DEBUG_LOG', 'false'));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    if (debugEnabled) {
      const logDebug = createDebugLogger(true);
      page.on('request', r => logDebug('>>', r.method(), r.url()));
      page.on('response', r => logDebug('<<', r.status(), r.url()));
    }

    try {
      await loginToSportlink(page, logger);

      // Process each member sequentially
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        logger.verbose(`Downloading photo ${i + 1}/${members.length}: ${member.knvb_id}`);

        try {
          const photoResult = await downloadMemberPhoto(page, context, member.knvb_id, photosDir, logger);
          updatePhotoState(db, member.knvb_id, 'downloaded');
          result.downloaded++;
        } catch (error) {
          result.failed++;
          result.errors.push({ knvb_id: member.knvb_id, message: error.message });
          logger.verbose(`  Failed: ${error.message}`);
          // Continue to next member
        }

        // Random delay 1-3 seconds between members
        if (i < members.length - 1) {
          const delay = 1000 + Math.random() * 2000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    } finally {
      await browser.close();
    }

    // Summary
    logger.log(`Downloaded ${result.downloaded}/${result.total} photos`);
    if (result.failed > 0) {
      logger.log(`Failed: ${result.failed}`);
      result.success = false;
    }

    return result;

  } finally {
    db.close();
  }
}

module.exports = { runPhotoDownload };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runPhotoDownload({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
