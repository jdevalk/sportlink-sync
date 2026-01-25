require('dotenv').config();

const { createSyncLogger } = require('./lib/logger');
const { runDownload } = require('./download-data-from-sportlink');
const { runPrepare } = require('./prepare-laposta-members');
const { runSubmit } = require('./submit-laposta-list');

/**
 * Parse CLI arguments
 * @param {string[]} argv - Process arguments
 * @returns {{ verbose: boolean, force: boolean }}
 */
function parseArgs(argv) {
  return {
    verbose: argv.includes('--verbose'),
    force: argv.includes('--force')
  };
}

/**
 * Format duration in human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2m 34s" or "45s")
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Print summary report
 * @param {Object} logger - Logger instance
 * @param {Object} stats - Collected statistics
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('SPORTLINK SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('TOTALS');
  logger.log(minorDivider);
  logger.log(`Members downloaded: ${stats.downloaded}`);
  logger.log(`Members prepared: ${stats.prepared} (${stats.excluded} excluded as duplicates)`);
  logger.log(`Members synced: ${stats.synced} (${stats.added} added, ${stats.updated} updated)`);
  logger.log(`Errors: ${stats.errors.length}`);
  logger.log('');

  logger.log('PER-LIST BREAKDOWN');
  logger.log(minorDivider);
  stats.lists.forEach(list => {
    if (list.listId) {
      logger.log(`List ${list.index}: ${list.total} members, ${list.synced} synced (${list.added} added, ${list.updated} updated)`);
    } else {
      logger.log(`List ${list.index}: not configured`);
    }
  });
  logger.log('');

  if (stats.errors.length > 0) {
    logger.log(`ERRORS (${stats.errors.length})`);
    logger.log(minorDivider);
    stats.errors.forEach(error => {
      logger.log(`- ${error.email}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run the full sync pipeline
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all members
 * @returns {Promise<{success: boolean, stats: Object, error?: string}>}
 */
async function runSyncAll(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose });
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
    lists: []
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

    // Sum up total prepared members and updates
    stats.prepared = prepareResult.lists.reduce((sum, list) => sum + list.total, 0);
    stats.excluded = prepareResult.excluded;
    logger.verbose(`Prepared ${stats.prepared} members (${stats.excluded} excluded)`);

    // Step 3: Submit to Laposta
    logger.verbose('Submitting to Laposta...');
    const submitResult = await runSubmit({ logger, verbose, force });

    // Collect submit stats (even if there were errors)
    stats.lists = submitResult.lists.map(list => ({
      index: list.index,
      listId: list.listId,
      total: list.total,
      synced: list.synced,
      added: list.added,
      updated: list.updated,
      errors: list.errors
    }));

    // Calculate totals
    stats.synced = stats.lists.reduce((sum, list) => sum + list.synced, 0);
    stats.added = stats.lists.reduce((sum, list) => sum + list.added, 0);
    stats.updated = stats.lists.reduce((sum, list) => sum + list.updated, 0);

    // Collect all errors
    stats.lists.forEach(list => {
      if (list.errors && list.errors.length > 0) {
        stats.errors.push(...list.errors);
      }
    });

    // Complete timing
    const endTime = Date.now();
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(endTime - startTime);

    // Print summary
    printSummary(logger, stats);

    // Log file location
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

module.exports = { runSyncAll };

// CLI entry point
if (require.main === module) {
  const { verbose, force } = parseArgs(process.argv);

  runSyncAll({ verbose, force })
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
