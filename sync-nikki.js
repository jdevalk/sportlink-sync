require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { runNikkiDownload } = require('./download-nikki-contributions');
const { runNikkiStadionSync } = require('./sync-nikki-to-stadion');

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
 * Print summary report for Nikki sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('NIKKI SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('NIKKI DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Contributions downloaded: ${stats.download.count}`);
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  logger.log(`Members updated: ${stats.stadion.updated}`);
  logger.log(`Skipped (no changes): ${stats.stadion.skipped}`);
  logger.log(`Skipped (no Stadion ID): ${stats.stadion.noStadionId}`);
  if (stats.stadion.errors > 0) {
    logger.log(`Errors: ${stats.stadion.errors}`);
  }
  logger.log('');

  logger.log(divider);
}

/**
 * Run Nikki sync pipeline (daily)
 * - Download Nikki contribution data from nikki-online.nl
 * - Sync contribution status to Stadion member WYSIWYG field
 */
async function runNikkiSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'nikki' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      count: 0,
      errors: []
    },
    stadion: {
      updated: 0,
      skipped: 0,
      noStadionId: 0,
      errors: 0
    }
  };

  try {
    // Step 1: Download Nikki contributions
    logger.verbose('Downloading Nikki contributions...');
    try {
      const downloadResult = await runNikkiDownload({ logger, verbose });
      stats.download.count = downloadResult.count || 0;
      if (!downloadResult.success) {
        stats.download.errors.push({
          message: downloadResult.error || 'Unknown error',
          system: 'nikki-download'
        });
      }
    } catch (err) {
      logger.error(`Nikki download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Nikki download failed: ${err.message}`,
        system: 'nikki-download'
      });
    }

    // Step 2: Sync to Stadion
    logger.verbose('Syncing Nikki contributions to Stadion...');
    try {
      const stadionResult = await runNikkiStadionSync({ logger, verbose, force });
      stats.stadion.updated = stadionResult.updated;
      stats.stadion.skipped = stadionResult.skipped;
      stats.stadion.noStadionId = stadionResult.noStadionId;
      stats.stadion.errors = stadionResult.errors;
    } catch (err) {
      logger.error(`Stadion sync failed: ${err.message}`);
      stats.stadion.errors++;
    }

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.download.errors.length === 0 && stats.stadion.errors === 0,
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

module.exports = { runNikkiSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runNikkiSync({ verbose, force })
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
