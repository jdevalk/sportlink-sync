require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const { openDb, getMembersByPhotoState, updatePhotoState } = require('../lib/rondo-club-db');
const { createSyncLogger } = require('../lib/logger');

/**
 * Find photo file for member by checking supported extensions
 * @param {string} knvbId - Member KNVB ID
 * @param {string} photosDir - Photos directory path
 * @returns {Promise<{found: boolean, path: string|null, ext: string|null}>}
 */
async function findPhotoFile(knvbId, photosDir) {
  const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  for (const ext of extensions) {
    const filepath = path.join(photosDir, `${knvbId}.${ext}`);
    try {
      await fs.access(filepath);
      return { found: true, path: filepath, ext };
    } catch {
      // File doesn't exist with this extension, continue
    }
  }

  return { found: false, path: null, ext: null };
}

/**
 * Check photo consistency between database state and filesystem
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.fix=false] - Fix inconsistencies by updating database
 * @returns {Promise<Object>} - Check result
 */
async function runPhotoConsistencyCheck(options = {}) {
  const { logger: providedLogger, verbose = false, fix = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    present: 0,
    missing: 0,
    missingList: [],
    fixed: 0
  };

  const db = openDb();
  try {
    const photosDir = path.join(process.cwd(), 'photos');

    logger.section('Photo Consistency Check');

    // Get members who should have photos (downloaded or synced state)
    const downloadedMembers = getMembersByPhotoState(db, 'downloaded');
    const syncedMembers = getMembersByPhotoState(db, 'synced');
    const allMembers = [...downloadedMembers, ...syncedMembers];

    result.total = allMembers.length;

    if (allMembers.length === 0) {
      logger.log('No members with downloaded or synced photos in database');
      return result;
    }

    logger.log(`Checking ${allMembers.length} members with photos in database...`);

    // Check each member's photo file
    for (let i = 0; i < allMembers.length; i++) {
      const member = allMembers[i];
      logger.verbose(`Checking photo ${i + 1}/${allMembers.length}: ${member.knvb_id}`);

      const photoFile = await findPhotoFile(member.knvb_id, photosDir);

      if (photoFile.found) {
        result.present++;
        logger.verbose(`  Found: ${photoFile.ext}`);
      } else {
        result.missing++;
        result.missingList.push({
          knvb_id: member.knvb_id,
          email: member.email,
          image_date: member.person_image_date
        });
        logger.verbose(`  Missing: Photo file not found`);
      }
    }

    // Report findings
    logger.log('');
    logger.log('Summary:');
    logger.log(`  Total members checked: ${result.total}`);
    logger.log(`  Photos present: ${result.present}`);
    logger.log(`  Photos missing: ${result.missing}`);

    if (result.missing > 0) {
      logger.log('');
      logger.log('Missing photos (KNVB IDs):');
      result.missingList.forEach(({ knvb_id, email }) => {
        logger.log(`  - ${knvb_id} (${email || 'no email'})`);
      });

      // Fix mode: update database state
      if (fix) {
        logger.log('');
        logger.log('Updating database state for missing photos...');

        for (const member of result.missingList) {
          updatePhotoState(db, member.knvb_id, 'pending_download');
          result.fixed++;
          logger.verbose(`  Marked ${member.knvb_id} as pending_download`);
        }

        logger.log(`Marked ${result.fixed} members for re-download`);
      } else {
        logger.log('');
        logger.log('Run with --fix flag to mark missing photos for re-download');
      }
    }

    return result;

  } finally {
    db.close();
  }
}

module.exports = { runPhotoConsistencyCheck };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const fix = process.argv.includes('--fix');

  runPhotoConsistencyCheck({ verbose, fix })
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
