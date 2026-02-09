require('varlock/auto-load');

const { openDb, getMembersNeedingPhotoDownload } = require('../lib/rondo-club-db');
const { createSyncLogger } = require('../lib/logger');

/**
 * Photo download reporting step.
 *
 * Photos are now downloaded inline by the functions pipeline (download-functions-from-sportlink.js)
 * immediately after capturing fresh signed URLs from MemberHeader. This eliminates the
 * URL expiry problem (~4h signed URLs going stale between pipelines).
 *
 * This step reports how many members still have pending_download state.
 * Any remaining pending members will be picked up by the next functions pipeline run.
 */
async function runPhotoDownload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    downloaded: 0,
    failed: 0,
    errors: []
  };

  const db = openDb();
  try {
    const members = getMembersNeedingPhotoDownload(db);
    result.total = members.length;

    if (members.length === 0) {
      logger.log('No photos pending download');
    } else {
      logger.log(`${members.length} photos pending download (will be handled by next functions sync)`);
      if (verbose) {
        for (const member of members) {
          logger.verbose(`  Pending: ${member.knvb_id}`);
        }
      }
    }

    return result;
  } finally {
    db.close();
  }
}

module.exports = { runPhotoDownload };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runPhotoDownload({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
