require('varlock/auto-load');

const fs = require('fs/promises');
const path = require('path');
const { openDb, getMembersNeedingPhotoDownload, updatePhotoState, clearExpiredPhotoUrl } = require('../lib/rondo-club-db');
const { createSyncLogger } = require('../lib/logger');

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

/**
 * Check if a signed URL has expired by parsing the expires= query parameter.
 * Sportlink CDN URLs contain expires=<unix_timestamp> which indicates when
 * the signed URL becomes invalid (~4 hours after generation).
 * @param {string} url - The signed URL to check
 * @returns {boolean} True if the URL has expired or has no expires parameter
 */
function isUrlExpired(url) {
  try {
    const match = url.match(/[?&]expires=(\d+)/);
    if (!match) return false; // No expires parameter - assume valid
    const expiresAt = parseInt(match[1], 10);
    const now = Math.floor(Date.now() / 1000);
    return now >= expiresAt;
  } catch {
    return false; // On parse error, assume valid and let download attempt
  }
}

/**
 * Download photo from URL with retry logic
 * @param {string} photoUrl - URL to download from
 * @param {string} knvbId - Member KNVB ID for filename
 * @param {string} photosDir - Directory to save photos
 * @param {Object} logger - Logger instance
 * @param {number} retries - Number of retry attempts (default: 3)
 * @returns {Promise<{success: boolean, path: string, bytes: number}>}
 */
async function downloadPhotoFromUrl(photoUrl, knvbId, photosDir, logger, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(photoUrl, {
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        // Don't retry on 401 (expired signed URL) or 403 (forbidden) - retries won't help
        if (response.status === 401 || response.status === 403) {
          throw error;
        }
        throw error;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Validate we got actual image data
      if (buffer.length < 100) {
        throw new Error('Invalid image data (too small)');
      }

      const contentType = response.headers.get('content-type');
      const ext = mimeToExtension(contentType);

      const filepath = path.join(photosDir, `${knvbId}.${ext}`);
      await fs.writeFile(filepath, buffer);

      return { success: true, path: filepath, bytes: buffer.length };
    } catch (error) {
      // Don't retry on auth errors (expired signed URL) - retries won't help
      if (error.message === 'HTTP 401' || error.message === 'HTTP 403') {
        throw error;
      }
      logger.verbose(`  Attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        throw error;
      }
      // Exponential backoff
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Main photo download orchestration using HTTP fetch
 * Replaces browser-based download with direct URL fetch
 */
async function runPhotoDownload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    downloaded: 0,
    skipped: 0,  // Members with no photo_url
    expired: 0,  // Members with expired signed URLs (will retry after next functions sync)
    failed: 0,
    errors: []
  };

  const db = openDb();
  try {
    const members = getMembersNeedingPhotoDownload(db);
    result.total = members.length;

    if (members.length === 0) {
      logger.log('No photos pending download');
      return result;
    }

    logger.log(`${members.length} photos pending download`);

    const photosDir = path.join(process.cwd(), 'photos');
    await fs.mkdir(photosDir, { recursive: true });

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      logger.verbose(`Downloading photo ${i + 1}/${members.length}: ${member.knvb_id}`);

      // Check if the signed URL has expired before attempting download.
      // Sportlink CDN URLs expire ~4 hours after generation. If expired,
      // clear the URL so the next functions sync can provide a fresh one.
      if (isUrlExpired(member.photo_url)) {
        clearExpiredPhotoUrl(db, member.knvb_id);
        result.expired++;
        logger.verbose(`  Skipped: signed URL expired, cleared for refresh`);
        continue;
      }

      try {
        const downloadResult = await downloadPhotoFromUrl(
          member.photo_url,
          member.knvb_id,
          photosDir,
          logger
        );

        updatePhotoState(db, member.knvb_id, 'downloaded');
        result.downloaded++;
        logger.verbose(`  Saved ${path.basename(downloadResult.path)} (${downloadResult.bytes} bytes)`);
      } catch (error) {
        // On 404, the photo no longer exists on Sportlink's CDN - clear state to stop retrying
        if (error.message === 'HTTP 404') {
          updatePhotoState(db, member.knvb_id, 'no_photo');
          logger.verbose(`  Photo no longer exists (404), cleared photo state`);
        // On 401/403, the signed URL has expired - clear URL for refresh on next functions sync
        } else if (error.message === 'HTTP 401' || error.message === 'HTTP 403') {
          clearExpiredPhotoUrl(db, member.knvb_id);
          result.expired++;
          logger.verbose(`  Signed URL expired (${error.message}), cleared for refresh`);
        } else {
          result.failed++;
          result.errors.push({ knvb_id: member.knvb_id, message: error.message });
          logger.verbose(`  Failed: ${error.message}`);
        }
      }

      // Small delay between downloads (rate limiting)
      if (i < members.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    logger.log(`Downloaded ${result.downloaded}/${result.total} photos`);
    if (result.expired > 0) {
      logger.log(`Expired URLs: ${result.expired} (will refresh on next functions sync)`);
    }
    if (result.failed > 0) {
      logger.log(`Failed: ${result.failed}`);
    }

    result.success = result.failed === 0;
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
