require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { formatDuration, formatTimestamp } = require('./lib/utils');
const { runFunctionsDownload } = require('./download-functions-from-sportlink');
const { runSync: runCommissiesSync } = require('./submit-stadion-commissies');
const { runSync: runCommissieWorkHistorySync } = require('./submit-stadion-commissie-work-history');

/**
 * Print summary report for functions sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('FUNCTIONS SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('FUNCTIONS DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Members processed: ${stats.download.total}`);
  logger.log(`Functions found: ${stats.download.functionsCount}`);
  logger.log(`Committee memberships found: ${stats.download.committeesCount}`);
  logger.log('');

  logger.log('COMMISSIES SYNC TO STADION');
  logger.log(minorDivider);
  if (stats.commissies.total > 0) {
    logger.log(`Commissies synced: ${stats.commissies.synced}/${stats.commissies.total}`);
    if (stats.commissies.created > 0) {
      logger.log(`  Created: ${stats.commissies.created}`);
    }
    if (stats.commissies.updated > 0) {
      logger.log(`  Updated: ${stats.commissies.updated}`);
    }
    if (stats.commissies.skipped > 0) {
      logger.log(`  Skipped: ${stats.commissies.skipped} (unchanged)`);
    }
    if (stats.commissies.deleted > 0) {
      logger.log(`  Deleted: ${stats.commissies.deleted} (orphan commissies)`);
    }
  } else {
    logger.log('Commissies synced: 0 changes');
  }
  logger.log('');

  logger.log('COMMISSIE WORK HISTORY SYNC');
  logger.log(minorDivider);
  if (stats.workHistory.total > 0) {
    logger.log(`Members synced: ${stats.workHistory.synced}/${stats.workHistory.total}`);
    if (stats.workHistory.created > 0) {
      logger.log(`  Work history entries added: ${stats.workHistory.created}`);
    }
    if (stats.workHistory.ended > 0) {
      logger.log(`  Work history entries ended: ${stats.workHistory.ended}`);
    }
    if (stats.workHistory.skipped > 0) {
      logger.log(`  Skipped: ${stats.workHistory.skipped} (not yet in Stadion)`);
    }
  } else {
    logger.log('Work history synced: 0 changes');
  }
  logger.log('');

  const allErrors = [
    ...stats.download.errors,
    ...stats.commissies.errors,
    ...stats.workHistory.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.knvb_id || error.commissie_name || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run functions sync pipeline (weekly)
 * - Download functions and committees from Sportlink
 * - Sync commissies to Stadion
 * - Sync commissie work history
 *
 * Uses cached member data from last people sync (hourly download)
 */
async function runFunctionsSync(options = {}) {
  const { verbose = false, force = false, withInvoice = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'functions' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      total: 0,
      functionsCount: 0,
      committeesCount: 0,
      errors: []
    },
    commissies: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: []
    },
    workHistory: {
      total: 0,
      synced: 0,
      created: 0,
      ended: 0,
      skipped: 0,
      errors: []
    }
  };

  try {
    // Step 1: Download functions from Sportlink
    logger.verbose('Downloading functions from Sportlink...');
    try {
      const downloadResult = await runFunctionsDownload({ logger, verbose, withInvoice });
      stats.download.total = downloadResult.total || 0;
      stats.download.functionsCount = downloadResult.functionsCount || 0;
      stats.download.committeesCount = downloadResult.committeesCount || 0;
      if (!downloadResult.success) {
        stats.download.errors.push({
          message: downloadResult.error || 'Unknown error',
          system: 'functions-download'
        });
      }
      if (downloadResult.errors?.length > 0) {
        stats.download.errors.push(...downloadResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'functions-download'
        })));
      }
    } catch (err) {
      logger.error(`Functions download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Functions download failed: ${err.message}`,
        system: 'functions-download'
      });
    }

    // Step 2: Sync commissies to Stadion
    logger.verbose('Syncing commissies to Stadion...');
    try {
      // Get current commissie names for orphan detection
      const { openDb, getAllCommissies } = require('./lib/stadion-db');
      const db = openDb();
      const allCommissies = getAllCommissies(db);
      const currentCommissieNames = allCommissies.map(c => c.commissie_name);
      db.close();

      const commissieResult = await runCommissiesSync({ logger, verbose, force, currentCommissieNames });
      stats.commissies.total = commissieResult.total;
      stats.commissies.synced = commissieResult.synced;
      stats.commissies.created = commissieResult.created;
      stats.commissies.updated = commissieResult.updated;
      stats.commissies.skipped = commissieResult.skipped;
      stats.commissies.deleted = commissieResult.deleted || 0;
      if (commissieResult.errors?.length > 0) {
        stats.commissies.errors = commissieResult.errors.map(e => ({
          commissie_name: e.commissie_name,
          message: e.message,
          system: 'commissie-sync'
        }));
      }
    } catch (err) {
      logger.error(`Commissie sync failed: ${err.message}`);
      stats.commissies.errors.push({
        message: `Commissie sync failed: ${err.message}`,
        system: 'commissie-sync'
      });
    }

    // Step 3: Sync commissie work history
    logger.verbose('Syncing commissie work history to Stadion...');
    try {
      const workHistoryResult = await runCommissieWorkHistorySync({ logger, verbose, force });
      stats.workHistory.total = workHistoryResult.total;
      stats.workHistory.synced = workHistoryResult.synced;
      stats.workHistory.created = workHistoryResult.created;
      stats.workHistory.ended = workHistoryResult.ended;
      stats.workHistory.skipped = workHistoryResult.skipped;
      if (workHistoryResult.errors?.length > 0) {
        stats.workHistory.errors = workHistoryResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'commissie-work-history-sync'
        }));
      }
    } catch (err) {
      logger.error(`Commissie work history sync failed: ${err.message}`);
      stats.workHistory.errors.push({
        message: `Commissie work history sync failed: ${err.message}`,
        system: 'commissie-work-history-sync'
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
               stats.commissies.errors.length === 0 &&
               stats.workHistory.errors.length === 0,
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

module.exports = { runFunctionsSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');
  const withInvoice = process.argv.includes('--with-invoice');

  runFunctionsSync({ verbose, force, withInvoice })
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
