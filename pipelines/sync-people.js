require('varlock/auto-load');

const { requireProductionServer } = require('../lib/server-check');
const { createSyncLogger } = require('../lib/logger');
const { formatDuration, formatTimestamp } = require('../lib/utils');
const { RunTracker } = require('../lib/run-tracker');
const { runDownload } = require('../steps/download-data-from-sportlink');
const { runPrepare } = require('../steps/prepare-laposta-members');
const { runSubmit } = require('../steps/submit-laposta-list');
const { runSync: runRondoClubSync } = require('../steps/submit-rondo-club-sync');
const { runPhotoDownload } = require('../steps/download-photos-from-api');
const { runPhotoSync } = require('../steps/upload-photos-to-rondo-club');
const { runReverseSync } = require('../lib/reverse-sync-sportlink');

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

  logger.log('RONDO CLUB SYNC');
  logger.log(minorDivider);
  logger.log(`Persons synced: ${stats.rondoClub.synced}/${stats.rondoClub.total} (${stats.rondoClub.created} created, ${stats.rondoClub.updated} updated)`);
  if (stats.rondoClub.skipped > 0) {
    logger.log(`Skipped: ${stats.rondoClub.skipped} (unchanged)`);
  }
  logger.log('');

  logger.log('PHOTO SYNC');
  logger.log(minorDivider);
  if (stats.photos.downloaded > 0 || stats.photos.uploaded > 0 || stats.photos.deleted > 0 || stats.photos.expired > 0) {
    logger.log(`Downloaded: ${stats.photos.downloaded}, Uploaded: ${stats.photos.uploaded}, Deleted: ${stats.photos.deleted}`);
    if (stats.photos.expired > 0) {
      logger.log(`Expired URLs: ${stats.photos.expired} (awaiting refresh from next functions sync)`);
    }
    if (stats.photos.skipped > 0) {
      logger.log(`Skipped: ${stats.photos.skipped} (no local file)`);
    }
  } else {
    logger.log('No photo changes');
  }
  logger.log('');

  // Only show reverse sync section if there were changes or failures
  if (stats.reverseSync.synced > 0 || stats.reverseSync.failed > 0) {
    logger.log('REVERSE SYNC (RONDO CLUB -> SPORTLINK)');
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
    ...stats.rondoClub.errors,
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
 * - Sync to Rondo Club (members + parents)
 * - Sync birthdays
 */
async function runPeopleSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'people' });
  const startTime = Date.now();

  const tracker = new RunTracker('people');
  tracker.startRun();

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
    rondoClub: {
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
      expired: 0,
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
    const downloadStepId = tracker.startStep('sportlink-download');
    const downloadResult = await runDownload({ logger, verbose });

    if (!downloadResult.success) {
      const errorMsg = downloadResult.error || 'Download failed';
      logger.error(`Download failed: ${errorMsg}`);
      tracker.endStep(downloadStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'sportlink-download',
        stepId: downloadStepId,
        errorMessage: errorMsg
      });
      tracker.endRun(false, stats);
      stats.completedAt = formatTimestamp();
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    stats.downloaded = downloadResult.memberCount;
    logger.verbose(`Downloaded ${downloadResult.memberCount} members`);
    tracker.endStep(downloadStepId, { outcome: 'success', created: stats.downloaded });

    // Step 2: Prepare Laposta members
    logger.verbose('Preparing Laposta members...');
    const prepareStepId = tracker.startStep('laposta-prepare');
    const prepareResult = await runPrepare({ logger, verbose });

    if (!prepareResult.success) {
      const errorMsg = prepareResult.error || 'Prepare failed';
      logger.error(`Prepare failed: ${errorMsg}`);
      tracker.endStep(prepareStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'laposta-prepare',
        stepId: prepareStepId,
        errorMessage: errorMsg
      });
      tracker.endRun(false, stats);
      stats.completedAt = formatTimestamp();
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    stats.prepared = prepareResult.lists.reduce((sum, list) => sum + list.total, 0);
    stats.excluded = prepareResult.excluded;
    logger.verbose(`Prepared ${stats.prepared} members (${stats.excluded} excluded)`);
    tracker.endStep(prepareStepId, { outcome: 'success', created: stats.prepared });

    // Step 3: Submit to Laposta
    logger.verbose('Submitting to Laposta...');
    const submitStepId = tracker.startStep('laposta-submit');
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

    tracker.endStep(submitStepId, {
      outcome: 'success',
      created: stats.added,
      updated: stats.updated,
      failed: stats.errors.length
    });
    tracker.recordErrors('laposta-submit', submitStepId, stats.errors);

    // Step 4: Sync to Rondo Club
    logger.verbose('Syncing to Rondo Club...');
    const rondoClubStepId = tracker.startStep('rondo-club-sync');
    try {
      const rondoClubResult = await runRondoClubSync({ logger, verbose, force });

      stats.rondoClub.total = rondoClubResult.total;
      stats.rondoClub.synced = rondoClubResult.synced;
      stats.rondoClub.created = rondoClubResult.created;
      stats.rondoClub.updated = rondoClubResult.updated;
      stats.rondoClub.skipped = rondoClubResult.skipped;

      if (rondoClubResult.parents) {
        stats.rondoClub.total += rondoClubResult.parents.total;
        stats.rondoClub.synced += rondoClubResult.parents.synced;
        stats.rondoClub.created += rondoClubResult.parents.created;
        stats.rondoClub.updated += rondoClubResult.parents.updated;
        stats.rondoClub.skipped += rondoClubResult.parents.skipped;

        if (rondoClubResult.parents.errors?.length > 0) {
          stats.rondoClub.errors.push(...rondoClubResult.parents.errors.map(e => ({
            email: e.email,
            message: e.message,
            system: 'rondoClub'
          })));
        }
      }

      if (rondoClubResult.errors?.length > 0) {
        stats.rondoClub.errors.push(...rondoClubResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          email: e.email,
          message: e.message,
          system: 'rondoClub'
        })));
      }

      tracker.endStep(rondoClubStepId, {
        outcome: 'success',
        created: stats.rondoClub.created,
        updated: stats.rondoClub.updated,
        skipped: stats.rondoClub.skipped,
        failed: stats.rondoClub.errors.length
      });
      tracker.recordErrors('rondo-club-sync', rondoClubStepId, stats.rondoClub.errors);
    } catch (err) {
      logger.error(`Rondo Club sync failed: ${err.message}`);
      stats.rondoClub.errors.push({
        message: `Rondo Club sync failed: ${err.message}`,
        system: 'rondoClub'
      });
      tracker.endStep(rondoClubStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'rondo-club-sync',
        stepId: rondoClubStepId,
        errorMessage: err.message,
        errorStack: err.stack
      });
    }

    // Step 5: Photo Download (API-based)
    logger.verbose('Downloading photos from Sportlink API...');
    const photoDownloadStepId = tracker.startStep('photo-download');
    try {
      const photoDownloadResult = await runPhotoDownload({ logger, verbose, force });

      stats.photos.downloaded = photoDownloadResult.downloaded;
      stats.photos.expired = photoDownloadResult.expired || 0;
      if (photoDownloadResult.errors?.length > 0) {
        stats.photos.errors.push(...photoDownloadResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-download'
        })));
      }

      tracker.endStep(photoDownloadStepId, {
        outcome: 'success',
        created: stats.photos.downloaded,
        failed: stats.photos.errors.length
      });
      tracker.recordErrors('photo-download', photoDownloadStepId, stats.photos.errors);
    } catch (err) {
      logger.error(`Photo download failed: ${err.message}`);
      stats.photos.errors.push({
        message: `Photo download failed: ${err.message}`,
        system: 'photo-download'
      });
      tracker.endStep(photoDownloadStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'photo-download',
        stepId: photoDownloadStepId,
        errorMessage: err.message,
        errorStack: err.stack
      });
    }

    // Step 6: Photo Upload/Delete
    logger.verbose('Syncing photos to Rondo Club...');
    const photoUploadStepId = tracker.startStep('photo-upload');
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

      tracker.endStep(photoUploadStepId, {
        outcome: 'success',
        created: stats.photos.uploaded,
        skipped: stats.photos.skipped,
        failed: stats.photos.errors.length
      });
      tracker.recordErrors('photo-upload', photoUploadStepId, stats.photos.errors);
    } catch (err) {
      logger.error(`Photo sync failed: ${err.message}`);
      stats.photos.errors.push({
        message: `Photo sync failed: ${err.message}`,
        system: 'photo-sync'
      });
      tracker.endStep(photoUploadStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'photo-upload',
        stepId: photoUploadStepId,
        errorMessage: err.message,
        errorStack: err.stack
      });
    }

    // Step 7: Reverse Sync (Rondo Club -> Sportlink)
    logger.verbose('Running reverse sync (Rondo Club -> Sportlink)...');
    const reverseSyncStepId = tracker.startStep('reverse-sync');
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

      tracker.endStep(reverseSyncStepId, {
        outcome: 'success',
        updated: stats.reverseSync.synced,
        failed: stats.reverseSync.errors.length
      });
      tracker.recordErrors('reverse-sync', reverseSyncStepId, stats.reverseSync.errors);
    } catch (err) {
      logger.error(`Reverse sync failed: ${err.message}`);
      stats.reverseSync.errors.push({
        message: `Reverse sync failed: ${err.message}`,
        system: 'reverse-sync'
      });
      tracker.endStep(reverseSyncStepId, { outcome: 'failure' });
      tracker.recordError({
        stepName: 'reverse-sync',
        stepId: reverseSyncStepId,
        errorMessage: err.message,
        errorStack: err.stack
      });
    }

    // Complete
    stats.completedAt = formatTimestamp();
    stats.duration = formatDuration(Date.now() - startTime);

    const success = stats.errors.length === 0 &&
                    stats.rondoClub.errors.length === 0 &&
                    stats.photos.errors.length === 0 &&
                    stats.reverseSync.errors.length === 0;

    tracker.endRun(success, stats);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return { success, stats };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    tracker.endRun(false, stats);

    stats.completedAt = formatTimestamp();
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
