require('varlock/auto-load');

const { requireProductionServer } = require('./lib/server-check');
const { createSyncLogger } = require('./lib/logger');
const { runDownload } = require('./download-data-from-sportlink');
const { runPrepare } = require('./prepare-laposta-members');
const { runSubmit } = require('./submit-laposta-list');
const { runSync: runStadionSync } = require('./submit-stadion-sync');
const { runSync: runBirthdaySync } = require('./sync-important-dates');
const { runPhotoDownload } = require('./download-photos-from-api');
const { runPhotoSync } = require('./upload-photos-to-stadion');
const { runReverseSync } = require('./lib/reverse-sync-sportlink');

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
 * Print summary report for people sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('PEOPLE SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('SPORTLINK DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Members downloaded: ${stats.downloaded}`);
  logger.log('');

  logger.log('LAPOSTA SYNC');
  logger.log(minorDivider);
  logger.log(`Members prepared: ${stats.prepared} (${stats.excluded} excluded as duplicates)`);
  logger.log(`Members synced: ${stats.synced} (${stats.added} added, ${stats.updated} updated)`);
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  logger.log(`Persons synced: ${stats.stadion.synced}/${stats.stadion.total} (${stats.stadion.created} created, ${stats.stadion.updated} updated)`);
  if (stats.stadion.skipped > 0) {
    logger.log(`Skipped: ${stats.stadion.skipped} (unchanged)`);
  }
  logger.log('');

  logger.log('BIRTHDAY SYNC');
  logger.log(minorDivider);
  const birthdaySyncText = stats.birthdays.total > 0
    ? `${stats.birthdays.synced}/${stats.birthdays.total}`
    : '0 changes';
  logger.log(`Birthdays synced: ${birthdaySyncText}`);
  logger.log('');

  logger.log('PHOTO SYNC');
  logger.log(minorDivider);
  if (stats.photos.downloaded > 0 || stats.photos.uploaded > 0 || stats.photos.deleted > 0) {
    logger.log(`Downloaded: ${stats.photos.downloaded}, Uploaded: ${stats.photos.uploaded}, Deleted: ${stats.photos.deleted}`);
    if (stats.photos.skipped > 0) {
      logger.log(`Skipped: ${stats.photos.skipped} (no local file)`);
    }
  } else {
    logger.log('No photo changes');
  }
  logger.log('');

  // Only show reverse sync section if there were changes or failures
  if (stats.reverseSync.synced > 0 || stats.reverseSync.failed > 0) {
    logger.log('REVERSE SYNC (STADION -> SPORTLINK)');
    logger.log(minorDivider);
    logger.log(`Contact fields synced: ${stats.reverseSync.synced} members`);
    if (stats.reverseSync.failed > 0) {
      logger.log(`Failed: ${stats.reverseSync.failed} members`);
    }

    // Optional: field-level detail if REVERSE_SYNC_DETAIL=detailed
    const detailLevel = process.env.REVERSE_SYNC_DETAIL || 'summary';
    if (detailLevel === 'detailed' && stats.reverseSync.results) {
      for (const result of stats.reverseSync.results) {
        if (result.success && result.fieldCount > 0) {
          logger.log(`  ${result.knvbId}: ${result.fieldCount} field(s) synced`);
        }
      }
    }
    logger.log('');
  }

  const allErrors = [
    ...stats.errors,
    ...stats.stadion.errors,
    ...stats.birthdays.errors,
    ...stats.photos.errors,
    ...stats.reverseSync.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.knvb_id || error.email || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run people sync pipeline (hourly)
 * - Download from Sportlink
 * - Prepare + Submit to Laposta
 * - Sync to Stadion (members + parents)
 * - Sync birthdays
 */
async function runPeopleSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'people' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    downloaded: 0,
    prepared: 0,
    excluded: 0,
    synced: 0,
    added: 0,
    updated: 0,
    errors: [],
    lists: [],
    stadion: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    },
    birthdays: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    },
    photos: {
      downloaded: 0,
      uploaded: 0,
      deleted: 0,
      skipped: 0,
      errors: []
    },
    reverseSync: {
      synced: 0,
      failed: 0,
      errors: [],
      results: []
    }
  };

  try {
    // Step 1: Download from Sportlink
    logger.verbose('Starting download from Sportlink...');
    const downloadResult = await runDownload({ logger, verbose });

    if (!downloadResult.success) {
      const errorMsg = downloadResult.error || 'Download failed';
      logger.error(`Download failed: ${errorMsg}`);
      stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    stats.downloaded = downloadResult.memberCount;
    logger.verbose(`Downloaded ${downloadResult.memberCount} members`);

    // Step 2: Prepare Laposta members
    logger.verbose('Preparing Laposta members...');
    const prepareResult = await runPrepare({ logger, verbose });

    if (!prepareResult.success) {
      const errorMsg = prepareResult.error || 'Prepare failed';
      logger.error(`Prepare failed: ${errorMsg}`);
      stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    stats.prepared = prepareResult.lists.reduce((sum, list) => sum + list.total, 0);
    stats.excluded = prepareResult.excluded;
    logger.verbose(`Prepared ${stats.prepared} members (${stats.excluded} excluded)`);

    // Step 3: Submit to Laposta
    logger.verbose('Submitting to Laposta...');
    const submitResult = await runSubmit({ logger, verbose, force });

    stats.lists = submitResult.lists.map(list => ({
      index: list.index,
      listId: list.listId,
      total: list.total,
      synced: list.synced,
      added: list.added,
      updated: list.updated,
      errors: list.errors
    }));

    stats.synced = stats.lists.reduce((sum, list) => sum + list.synced, 0);
    stats.added = stats.lists.reduce((sum, list) => sum + list.added, 0);
    stats.updated = stats.lists.reduce((sum, list) => sum + list.updated, 0);

    stats.lists.forEach(list => {
      if (list.errors && list.errors.length > 0) {
        stats.errors.push(...list.errors);
      }
    });

    // Step 4: Sync to Stadion
    logger.verbose('Syncing to Stadion...');
    try {
      const stadionResult = await runStadionSync({ logger, verbose, force });

      stats.stadion.total = stadionResult.total;
      stats.stadion.synced = stadionResult.synced;
      stats.stadion.created = stadionResult.created;
      stats.stadion.updated = stadionResult.updated;
      stats.stadion.skipped = stadionResult.skipped;

      if (stadionResult.parents) {
        stats.stadion.total += stadionResult.parents.total;
        stats.stadion.synced += stadionResult.parents.synced;
        stats.stadion.created += stadionResult.parents.created;
        stats.stadion.updated += stadionResult.parents.updated;
        stats.stadion.skipped += stadionResult.parents.skipped;

        if (stadionResult.parents.errors?.length > 0) {
          stats.stadion.errors.push(...stadionResult.parents.errors.map(e => ({
            email: e.email,
            message: e.message,
            system: 'stadion'
          })));
        }
      }

      if (stadionResult.errors?.length > 0) {
        stats.stadion.errors.push(...stadionResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          email: e.email,
          message: e.message,
          system: 'stadion'
        })));
      }
    } catch (err) {
      logger.error(`Stadion sync failed: ${err.message}`);
      stats.stadion.errors.push({
        message: `Stadion sync failed: ${err.message}`,
        system: 'stadion'
      });
    }

    // Step 5: Birthday Sync
    logger.verbose('Syncing birthdays to Stadion...');
    try {
      const birthdayResult = await runBirthdaySync({ logger, verbose, force });

      stats.birthdays = {
        total: birthdayResult.total,
        synced: birthdayResult.synced,
        created: birthdayResult.created,
        updated: birthdayResult.updated,
        skipped: birthdayResult.skipped,
        errors: (birthdayResult.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'birthday-sync'
        }))
      };
    } catch (err) {
      logger.error(`Birthday sync failed: ${err.message}`);
      stats.birthdays.errors.push({
        message: `Birthday sync failed: ${err.message}`,
        system: 'birthday-sync'
      });
    }

    // Step 6: Photo Download (API-based)
    logger.verbose('Downloading photos from Sportlink API...');
    try {
      const photoDownloadResult = await runPhotoDownload({ logger, verbose, force });

      stats.photos.downloaded = photoDownloadResult.downloaded;
      if (photoDownloadResult.errors?.length > 0) {
        stats.photos.errors.push(...photoDownloadResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-download'
        })));
      }
    } catch (err) {
      logger.error(`Photo download failed: ${err.message}`);
      stats.photos.errors.push({
        message: `Photo download failed: ${err.message}`,
        system: 'photo-download'
      });
    }

    // Step 7: Photo Upload/Delete
    logger.verbose('Syncing photos to Stadion...');
    try {
      const photoSyncResult = await runPhotoSync({ logger, verbose });

      stats.photos.uploaded = photoSyncResult.upload.synced;
      stats.photos.deleted = photoSyncResult.delete.deleted;
      stats.photos.skipped = photoSyncResult.upload.skipped;

      if (photoSyncResult.upload.errors?.length > 0) {
        stats.photos.errors.push(...photoSyncResult.upload.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-upload'
        })));
      }
      if (photoSyncResult.delete.errors?.length > 0) {
        stats.photos.errors.push(...photoSyncResult.delete.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-delete'
        })));
      }
    } catch (err) {
      logger.error(`Photo sync failed: ${err.message}`);
      stats.photos.errors.push({
        message: `Photo sync failed: ${err.message}`,
        system: 'photo-sync'
      });
    }

    // Step 8: Reverse Sync (Stadion -> Sportlink)
    logger.verbose('Running reverse sync (Stadion -> Sportlink)...');
    try {
      const reverseSyncResult = await runReverseSync({ logger, verbose });

      stats.reverseSync.synced = reverseSyncResult.synced;
      stats.reverseSync.failed = reverseSyncResult.failed;
      stats.reverseSync.results = reverseSyncResult.results || [];

      if (reverseSyncResult.results) {
        // Add field-level detail to errors for failed syncs
        for (const result of reverseSyncResult.results) {
          if (!result.success) {
            stats.reverseSync.errors.push({
              knvb_id: result.knvbId,
              message: result.error || 'Sync failed',
              system: 'reverse-sync'
            });
          }
        }
      }
    } catch (err) {
      logger.error(`Reverse sync failed: ${err.message}`);
      stats.reverseSync.errors.push({
        message: `Reverse sync failed: ${err.message}`,
        system: 'reverse-sync'
      });
    }

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.errors.length === 0 &&
               stats.stadion.errors.length === 0 &&
               stats.birthdays.errors.length === 0 &&
               stats.photos.errors.length === 0 &&
               stats.reverseSync.errors.length === 0,
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

module.exports = { runPeopleSync };

// CLI entry point
if (require.main === module) {
  // Prevent accidental local runs that cause duplicate entries
  requireProductionServer({
    allowLocal: true,
    scriptName: 'sync-people.js'
  });

  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runPeopleSync({ verbose, force })
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
