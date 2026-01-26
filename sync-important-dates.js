require('varlock/auto-load');

const { stadionRequest } = require('./lib/stadion-client');
const {
  openDb,
  upsertImportantDate,
  getImportantDatesNeedingSync,
  updateImportantDateSyncState,
  getOrphanImportantDates,
  deleteImportantDate,
  getAllTrackedMembers
} = require('./lib/stadion-db');
const fs = require('fs');
const path = require('path');

/**
 * Helper for rate limiting between API requests
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load birthdays from Sportlink CSV and upsert to database
 * @param {Object} db - Database connection
 * @param {Object} options - Logger options
 * @returns {number} Count of members with birthdays
 */
function loadBirthdaysFromCsv(db, options = {}) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  const csvPath = path.join(process.cwd(), 'sportlink-members.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error('sportlink-members.csv not found. Run download first.');
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return 0;
  }

  // Parse header
  const header = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
  const dateOfBirthIndex = header.indexOf('DateOfBirth');
  const publicPersonIdIndex = header.indexOf('PublicPersonId');

  if (dateOfBirthIndex === -1 || publicPersonIdIndex === -1) {
    throw new Error('Required columns not found in CSV');
  }

  let birthdayCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim().replace(/^"|"$/g, ''));
    const knvbId = values[publicPersonIdIndex];
    const dateOfBirth = values[dateOfBirthIndex];

    if (knvbId && dateOfBirth && dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/)) {
      upsertImportantDate(db, knvbId, 'birth_date', dateOfBirth);
      birthdayCount++;
    }
  }

  logVerbose(`Loaded ${birthdayCount} birthdays from CSV`);
  return birthdayCount;
}

/**
 * Create a new important date in Stadion
 * @param {number} stadionPersonId - Stadion person post ID
 * @param {string} dateValue - Date in YYYY-MM-DD format
 * @param {Object} options - Logger options
 * @returns {Promise<number>} Created important date post ID
 */
async function createImportantDate(stadionPersonId, dateValue, options = {}) {
  const response = await stadionRequest(
    'wp/v2/important-dates',
    'POST',
    {
      status: 'publish',
      acf: {
        date_value: dateValue,
        related_people: [stadionPersonId],
        year_unknown: false,
        is_recurring: true,
        custom_label: ''
      }
    },
    options
  );

  return response.body.id;
}

/**
 * Update an existing important date in Stadion
 * @param {number} stadionDateId - Stadion important date post ID
 * @param {number} stadionPersonId - Stadion person post ID
 * @param {string} dateValue - Date in YYYY-MM-DD format
 * @param {Object} options - Logger options
 */
async function updateImportantDate(stadionDateId, stadionPersonId, dateValue, options = {}) {
  await stadionRequest(
    `wp/v2/important-dates/${stadionDateId}`,
    'PUT',
    {
      acf: {
        date_value: dateValue,
        related_people: [stadionPersonId]
      }
    },
    options
  );
}

/**
 * Delete an important date from Stadion
 * @param {number} stadionDateId - Stadion important date post ID
 * @param {Object} options - Logger options
 */
async function deleteStadionImportantDate(stadionDateId, options = {}) {
  await stadionRequest(
    `wp/v2/important-dates/${stadionDateId}`,
    'DELETE',
    null,
    options
  );
}

/**
 * Sync important dates to Stadion
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all dates
 * @returns {Promise<Object>} Sync result
 */
async function runSync(options = {}) {
  const { logger, verbose = false, force = false } = options;
  const logVerbose = logger?.verbose.bind(logger) || (verbose ? console.log : () => {});
  const logError = logger?.error.bind(logger) || console.error;

  const result = {
    success: true,
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: []
  };

  const db = openDb();
  try {
    // Step 1: Load birthdays from CSV and upsert to tracking table
    result.total = loadBirthdaysFromCsv(db, options);

    // Step 2: Get dates needing sync (members must have stadion_id)
    const needsSync = getImportantDatesNeedingSync(db, force);
    result.skipped = result.total - needsSync.length;

    logVerbose(`${needsSync.length} important dates need sync (${result.skipped} unchanged or no person)`);

    // Step 3: Sync each date
    for (let i = 0; i < needsSync.length; i++) {
      const date = needsSync[i];
      logVerbose(`Syncing ${i + 1}/${needsSync.length}: ${date.knvb_id} (${date.date_value})`);

      try {
        if (date.stadion_date_id) {
          // Update existing
          await updateImportantDate(date.stadion_date_id, date.stadion_id, date.date_value, options);
          updateImportantDateSyncState(db, date.knvb_id, date.date_type, date.source_hash, date.stadion_date_id);
          result.updated++;
        } else {
          // Create new
          const newId = await createImportantDate(date.stadion_id, date.date_value, options);
          updateImportantDateSyncState(db, date.knvb_id, date.date_type, date.source_hash, newId);
          result.created++;
        }
        result.synced++;
      } catch (error) {
        result.errors.push({
          knvb_id: date.knvb_id,
          date_value: date.date_value,
          message: error.message
        });
      }

      // Rate limit
      if (i < needsSync.length - 1) {
        await sleep(1000);
      }
    }

    // Step 4: Delete orphan dates (members removed from Sportlink)
    const allMembers = getAllTrackedMembers(db);
    const currentKnvbIds = allMembers.map(m => m.knvb_id);
    const orphanDates = getOrphanImportantDates(db, currentKnvbIds);

    for (const orphan of orphanDates) {
      logVerbose(`Deleting orphan date: ${orphan.knvb_id}`);
      try {
        await deleteStadionImportantDate(orphan.stadion_date_id, options);
        deleteImportantDate(db, orphan.knvb_id, orphan.date_type);
        result.deleted++;
      } catch (error) {
        result.errors.push({
          knvb_id: orphan.knvb_id,
          message: `Delete failed: ${error.message}`
        });
      }
      await sleep(1000);
    }

    result.success = result.errors.length === 0;

  } finally {
    db.close();
  }

  return result;
}

module.exports = { runSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runSync({ verbose, force })
    .then(result => {
      console.log(`Important dates sync: ${result.synced}/${result.total} synced`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Skipped: ${result.skipped}`);
      console.log(`  Deleted: ${result.deleted}`);

      if (result.errors.length > 0) {
        console.error(`  Errors: ${result.errors.length}`);
        result.errors.forEach(e => console.error(`    - ${e.knvb_id}: ${e.message}`));
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
