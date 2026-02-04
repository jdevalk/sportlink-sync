require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { formatDuration, formatTimestamp } = require('./lib/utils');
const { runDownload } = require('./download-discipline-cases');
const { runSync: runDisciplineSync } = require('./submit-stadion-discipline');

/**
 * Print summary report for discipline sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('DISCIPLINE SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('DISCIPLINE DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Cases downloaded: ${stats.download.caseCount}`);
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  if (stats.sync.total > 0) {
    logger.log(`Cases synced: ${stats.sync.synced}/${stats.sync.total}`);
    if (stats.sync.created > 0) {
      logger.log(`  Created: ${stats.sync.created}`);
    }
    if (stats.sync.updated > 0) {
      logger.log(`  Updated: ${stats.sync.updated}`);
    }
    if (stats.sync.skipped > 0) {
      logger.log(`  Skipped: ${stats.sync.skipped} (unchanged)`);
    }
    if (stats.sync.linked > 0) {
      logger.log(`  Linked to persons: ${stats.sync.linked}`);
    }
    if (stats.sync.skipped_no_person > 0) {
      logger.log(`  Skipped (no person): ${stats.sync.skipped_no_person}`);
    }
  } else {
    logger.log('Cases synced: 0 changes');
  }
  logger.log('');

  const allErrors = [
    ...stats.download.errors,
    ...stats.sync.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.dossier_id || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run discipline sync pipeline (weekly)
 * - Download discipline cases from Sportlink
 * - Sync cases to Stadion
 *
 * Uses member data from last people sync to link cases to persons
 */
async function runDisciplineSyncPipeline(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'discipline' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      caseCount: 0,
      errors: []
    },
    sync: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      linked: 0,
      skipped_no_person: 0,
      errors: []
    }
  };

  try {
    // Step 1: Download discipline cases from Sportlink
    logger.verbose('Downloading discipline cases from Sportlink...');
    try {
      const downloadResult = await runDownload({ logger, verbose });
      stats.download.caseCount = downloadResult.caseCount || 0;
      if (!downloadResult.success) {
        stats.download.errors.push({
          message: downloadResult.error || 'Unknown error',
          system: 'discipline-download'
        });
      }
    } catch (err) {
      logger.error(`Discipline download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Discipline download failed: ${err.message}`,
        system: 'discipline-download'
      });
    }

    // Step 2: Sync cases to Stadion
    logger.verbose('Syncing discipline cases to Stadion...');
    try {
      const syncResult = await runDisciplineSync({ logger, verbose, force });
      stats.sync.total = syncResult.total;
      stats.sync.synced = syncResult.synced;
      stats.sync.created = syncResult.created;
      stats.sync.updated = syncResult.updated;
      stats.sync.skipped = syncResult.skipped;
      stats.sync.skipped_no_person = syncResult.skipped_no_person;
      // Calculate linked (all cases that were associated with a person)
      stats.sync.linked = syncResult.created + syncResult.updated + syncResult.skipped;
      if (syncResult.errors?.length > 0) {
        stats.sync.errors = syncResult.errors.map(e => ({
          dossier_id: e.dossier_id,
          message: e.message,
          system: 'discipline-sync'
        }));
      }
    } catch (err) {
      logger.error(`Discipline sync failed: ${err.message}`);
      stats.sync.errors.push({
        message: `Discipline sync failed: ${err.message}`,
        system: 'discipline-sync'
      });
    }

    // Complete
    stats.completedAt = formatTimestamp();
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.download.errors.length === 0 &&
               stats.sync.errors.length === 0,
      stats
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    stats.completedAt = formatTimestamp();
    stats.duration = formatDuration(Date.now() - startTime);
    printSummary(logger, stats);

    logger.close();

    return { success: false, stats, error: errorMsg };
  }
}

module.exports = { runDisciplineSync: runDisciplineSyncPipeline };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runDisciplineSyncPipeline({ verbose, force })
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
