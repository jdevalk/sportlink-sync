require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { runSubmit: runFreescoutSubmit } = require('./submit-freescout-sync');
const { checkCredentials: checkFreescoutCredentials } = require('./lib/freescout-client');

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
 * Print summary report for FreeScout sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('FREESCOUT SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('CUSTOMER SYNC');
  logger.log(minorDivider);
  logger.log(`Total customers: ${stats.total}`);
  logger.log(`Synced: ${stats.synced}`);
  if (stats.created > 0) {
    logger.log(`  Created: ${stats.created}`);
  }
  if (stats.updated > 0) {
    logger.log(`  Updated: ${stats.updated}`);
  }
  if (stats.skipped > 0) {
    logger.log(`  Skipped (unchanged): ${stats.skipped}`);
  }
  if (stats.deleted > 0) {
    logger.log(`  Deleted: ${stats.deleted}`);
  }
  if (stats.errors.length > 0) {
    logger.log(`Errors: ${stats.errors.length}`);
  }
  logger.log('');

  logger.log(divider);
}

/**
 * Run FreeScout sync pipeline (daily)
 * - Sync Stadion members to FreeScout customers
 */
async function runFreescoutSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'freescout' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: []
  };

  try {
    // Check credentials
    const creds = checkFreescoutCredentials();
    if (!creds.configured) {
      logger.error('FreeScout credentials not configured');
      logger.error('Required: FREESCOUT_API_KEY and FREESCOUT_URL in .env');
      stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: 'Credentials not configured' };
    }

    // Run FreeScout sync
    logger.log('Starting FreeScout customer sync');
    try {
      const result = await runFreescoutSubmit({ logger, verbose, force });
      stats.total = result.total || 0;
      stats.synced = result.synced || 0;
      stats.created = result.created || 0;
      stats.updated = result.updated || 0;
      stats.skipped = result.skipped || 0;
      stats.deleted = result.deleted || 0;
      stats.errors = (result.errors || []).map(e => ({
        knvb_id: e.knvb_id,
        message: e.error,
        system: 'freescout'
      }));
    } catch (err) {
      logger.error(`FreeScout sync failed: ${err.message}`);
      stats.errors.push({
        message: `FreeScout sync failed: ${err.message}`,
        system: 'freescout'
      });
    }

    // Complete
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.errors.length === 0,
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

module.exports = { runFreescoutSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runFreescoutSync({ verbose, force })
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
