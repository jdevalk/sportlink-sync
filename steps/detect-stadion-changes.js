#!/usr/bin/env node
/**
 * Rondo Club Change Detection CLI
 * Detects changes in Rondo Club that need reverse sync to Sportlink.
 */

const { detectChanges } = require('../lib/detect-stadion-changes');
const { createSyncLogger } = require('../lib/logger');

async function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const logger = createSyncLogger({ verbose });

  try {
    logger.log('Starting Rondo Club change detection...');
    const changes = await detectChanges({ verbose, logger });

    if (changes.length === 0) {
      logger.log('No changes detected');
    } else {
      logger.log(`Detected ${changes.length} field change(s):`);
      for (const change of changes) {
        logger.log(`  - ${change.knvb_id}: ${change.field_name} changed`);
      }
    }

    process.exit(0);
  } catch (error) {
    logger.error(`Change detection failed: ${error.message}`);
    if (verbose) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

// Module/CLI hybrid pattern
module.exports = { main };

if (require.main === module) {
  main();
}
