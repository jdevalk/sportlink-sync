require('varlock/auto-load');

const { requireProductionServer } = require('../lib/server-check');
const { createSyncLogger } = require('../lib/logger');
const { runReverseSyncMultiPage } = require('../lib/reverse-sync-sportlink');
const { detectChanges } = require('../lib/detect-stadion-changes');

/**
 * Run full reverse sync for all fields (Stadion -> Sportlink)
 * Syncs contact fields (/general), free fields (/other), and financial toggle (/financial)
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {Object} [options.logger] - External logger
 * @returns {Promise<{success: boolean, synced: number, failed: number, results: Array}>}
 */
async function runAllFieldsReverseSync(options = {}) {
  const { verbose = false, logger: providedLogger } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'reverse' });

  logger.log('Starting reverse sync (Stadion -> Sportlink) for all fields...');
  logger.log('Fields: email, email2, mobile, phone, datum-vog, freescout-id, financiele-blokkade');

  try {
    // Detect Stadion changes to populate stadion_change_detections table
    logger.log('Detecting Stadion changes...');
    const detectedChanges = await detectChanges({ verbose, logger });
    logger.log(`Detected ${detectedChanges.length} field change(s)`);

    const result = await runReverseSyncMultiPage({ verbose, logger });

    if (result.synced === 0 && result.failed === 0) {
      logger.log('No changes to sync');
    } else {
      logger.log(`Reverse sync complete: ${result.synced} members synced, ${result.failed} failed`);
    }

    return result;
  } catch (err) {
    logger.error(`Reverse sync failed: ${err.message}`);
    return { success: false, synced: 0, failed: 0, error: err.message };
  }
}

module.exports = { runAllFieldsReverseSync };

// CLI entry point
if (require.main === module) {
  // Prevent accidental local runs - database state safety
  requireProductionServer({
    allowLocal: true,  // Allow with warning for testing
    scriptName: 'reverse-sync.js'
  });

  const verbose = process.argv.includes('--verbose');

  runAllFieldsReverseSync({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
