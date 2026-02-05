require('varlock/auto-load');

const fs = require('fs/promises');
const path = require('path');
const { openDb, getMembersNeedingPhotoDownload, updatePhotoState } = require('../lib/stadion-db');
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
        throw new Error(`HTTP ${response.status}`);
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
