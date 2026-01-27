require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { runPhotoDownload } = require('./download-photos-from-sportlink');
const { runPhotoSync } = require('./upload-photos-to-stadion');
const { openDb } = require('./lib/stadion-db');

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Print summary report for photo sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('PHOTO SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('PHOTO DOWNLOAD');
  logger.log(minorDivider);
  const downloadText = stats.download.total > 0
    ? `${stats.download.downloaded}/${stats.download.total}`
    : '0 pending';
  logger.log(`Photos downloaded: ${downloadText}`);
  if (stats.download.failed > 0) {
    logger.log(`Failed: ${stats.download.failed}`);
  }
  logger.log('');

  logger.log('PHOTO UPLOAD');
  logger.log(minorDivider);
  const uploadText = stats.upload.total > 0
    ? `${stats.upload.synced}/${stats.upload.total}`
    : '0 pending';
  logger.log(`Photos uploaded: ${uploadText}`);
  if (stats.upload.skipped > 0) {
    logger.log(`Skipped: ${stats.upload.skipped}`);
  }
  logger.log('');

  logger.log('PHOTO DELETE');
  logger.log(minorDivider);
  const deleteText = stats.delete.total > 0
    ? `${stats.delete.deleted}/${stats.delete.total}`
    : '0 pending';
  logger.log(`Photos deleted: ${deleteText}`);
  logger.log('');

  logger.log('COVERAGE');
  logger.log(minorDivider);
  logger.log(`${stats.coverage.members_with_photos} of ${stats.coverage.total_members} members have photos`);
  logger.log('');

  const allErrors = [
    ...stats.download.errors,
    ...stats.upload.errors,
    ...stats.delete.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.knvb_id || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run photo sync pipeline (daily)
 * - Download photos from Sportlink
 * - Upload photos to Stadion
 * - Delete removed photos
 *
 * Uses cached member data from last people sync (hourly download)
 */
async function runPhotosSync(options = {}) {
  const { verbose = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'photos' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      errors: []
    },
    upload: {
      total: 0,
      synced: 0,
      skipped: 0,
      errors: []
    },
    delete: {
      total: 0,
      deleted: 0,
      errors: []
    },
    coverage: {
      members_with_photos: 0,
      total_members: 0
    }
  };

  try {
    // Step 1: Photo Download
    logger.verbose('Downloading photos from Sportlink...');
    try {
      const photoDownloadResult = await runPhotoDownload({ logger, verbose });

      stats.download = {
        total: photoDownloadResult.total,
        downloaded: photoDownloadResult.downloaded,
        skipped: photoDownloadResult.skipped || 0,
        failed: photoDownloadResult.failed,
        errors: (photoDownloadResult.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-download'
        }))
      };
    } catch (err) {
      logger.error(`Photo download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Photo download failed: ${err.message}`,
        system: 'photo-download'
      });
    }

    // Step 2: Photo Upload/Delete
    logger.verbose('Syncing photos to Stadion...');
    try {
      const photoSyncResult = await runPhotoSync({ logger, verbose });

      stats.upload = {
        total: photoSyncResult.upload.total,
        synced: photoSyncResult.upload.synced,
        skipped: photoSyncResult.upload.skipped,
        errors: (photoSyncResult.upload.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-upload'
        }))
      };

      stats.delete = {
        total: photoSyncResult.delete.total,
        deleted: photoSyncResult.delete.deleted,
        errors: (photoSyncResult.delete.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-delete'
        }))
      };
    } catch (err) {
      logger.error(`Photo sync failed: ${err.message}`);
      stats.upload.errors.push({
        message: `Photo sync failed: ${err.message}`,
        system: 'photo-upload'
      });
    }

    // Calculate photo coverage
    try {
      const db = openDb();
      const totalMembers = db.prepare('SELECT COUNT(*) as count FROM stadion_members').get().count;
      const membersWithPhotos = db.prepare(
        "SELECT COUNT(*) as count FROM stadion_members WHERE photo_state = 'synced'"
      ).get().count;
      db.close();

      stats.coverage = {
        members_with_photos: membersWithPhotos,
        total_members: totalMembers
      };
    } catch (err) {
      logger.verbose(`Could not calculate photo coverage: ${err.message}`);
    }

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.download.errors.length === 0 &&
               stats.upload.errors.length === 0 &&
               stats.delete.errors.length === 0,
      stats
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);
    printSummary(logger, stats);

    logger.close();

    return { success: false, stats, error: errorMsg };
  }
}

module.exports = { runPhotosSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');

  runPhotosSync({ verbose })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
