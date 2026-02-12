require('dotenv/config');

const { requireProductionServer } = require('../lib/server-check');
const { createSyncLogger } = require('../lib/logger');
const { runReverseSync } = require('../lib/reverse-sync-sportlink');

/**
 * Run contact fields reverse sync (Rondo Club -> Sportlink)
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, synced: number, failed: number, results: Array}>}
 */
async function runContactFieldsReverseSync(options = {}) {
  const { verbose = false, logger: providedLogger } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'reverse' });

  logger.log('Starting contact fields reverse sync (Rondo Club -> Sportlink)...');

  try {
    const result = await runReverseSync({ verbose, logger });

    if (result.synced === 0 && result.failed === 0) {
      logger.log('No contact field changes to sync');
    } else {
      logger.log(`Reverse sync complete: ${result.synced} synced, ${result.failed} failed`);
    }

    return result;
  } catch (err) {
    logger.error(`Reverse sync failed: ${err.message}`);
    return { success: false, synced: 0, failed: 0, error: err.message };
  }
}

module.exports = { runContactFieldsReverseSync };

// CLI entry point
if (require.main === module) {
  // Prevent accidental local runs
  requireProductionServer({
    allowLocal: true,
    scriptName: 'reverse-sync-contact-fields.js'
  });

  const verbose = process.argv.includes('--verbose');

  runContactFieldsReverseSync({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
