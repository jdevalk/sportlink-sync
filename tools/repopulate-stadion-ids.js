require('varlock/auto-load');

const { stadionRequest } = require('../lib/stadion-client');
const { openDb, updateSyncState, getAllTrackedMembers } = require('../lib/stadion-db');

/**
 * Fetch all people from Stadion with their KNVB IDs.
 * Uses pagination to handle large datasets.
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<Map<string, number>>} - Map<knvb_id, stadion_id>
 */
async function fetchAllPeopleFromStadion(options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});
  const knvbToStadion = new Map();
  let page = 1;
  let hasMore = true;

  logVerbose('Fetching all people from Stadion...');

  while (hasMore) {
    let response;
    try {
      response = await stadionRequest(
        `wp/v2/people?_fields=id,acf.knvb-id&per_page=100&page=${page}`,
        'GET',
        null,
        options
      );
    } catch (error) {
      // End of pagination (400 error is expected when page exceeds total)
      if (error.message.includes('400')) {
        hasMore = false;
        break;
      }
      throw error;
    }

    // Handle end of pagination (empty array)
    if (!Array.isArray(response.body) || response.body.length === 0) {
      hasMore = false;
      break;
    }

    const people = response.body;

    for (const person of people) {
      const knvbId = person.acf?.['knvb-id'];
      if (knvbId) {
        knvbToStadion.set(knvbId, person.id);
      }
    }

    logVerbose(`  Page ${page}: ${people.length} people (${knvbToStadion.size} with KNVB IDs)`);
    page++;

    // Safety: stop if we've fetched too many pages
    if (page > 50) {
      console.error('Warning: Hit page limit, stopping');
      break;
    }
  }

  return knvbToStadion;
}

/**
 * Repopulate stadion_ids in local database from Stadion API.
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.dryRun=false] - Don't update, just report
 */
async function runRepopulate(options = {}) {
  const { verbose = false, dryRun = false } = options;
  const logVerbose = verbose ? console.log : () => {};

  const db = openDb();

  try {
    // Fetch all people from Stadion
    const knvbToStadion = await fetchAllPeopleFromStadion(options);
    console.log(`Found ${knvbToStadion.size} people in Stadion with KNVB IDs`);

    // Get all tracked members from local DB (including those without stadion_id)
    const trackedMembers = db.prepare(`
      SELECT knvb_id, stadion_id, last_synced_hash
      FROM stadion_members
      WHERE knvb_id IS NOT NULL
    `).all();
    console.log(`Found ${trackedMembers.length} members in local database`);

    let updated = 0;
    let alreadySet = 0;
    let notInStadion = 0;

    for (const member of trackedMembers) {
      const stadionId = knvbToStadion.get(member.knvb_id);

      if (stadionId) {
        if (member.stadion_id === stadionId) {
          alreadySet++;
          continue;
        }

        if (dryRun) {
          logVerbose(`Would update ${member.knvb_id}: stadion_id ${member.stadion_id || 'null'} -> ${stadionId}`);
        } else {
          // Update the stadion_id - use existing hash to avoid re-syncing
          updateSyncState(db, member.knvb_id, member.last_synced_hash, stadionId);
          logVerbose(`Updated ${member.knvb_id}: stadion_id -> ${stadionId}`);
        }
        updated++;
      } else {
        logVerbose(`${member.knvb_id} not found in Stadion`);
        notInStadion++;
      }
    }

    console.log(`\nResults:`);
    console.log(`  Updated: ${updated}${dryRun ? ' (dry run)' : ''}`);
    console.log(`  Already set: ${alreadySet}`);
    console.log(`  Not in Stadion: ${notInStadion}`);

    return { updated, alreadySet, notInStadion };
  } finally {
    db.close();
  }
}

module.exports = { runRepopulate };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const dryRun = process.argv.includes('--dry-run');

  runRepopulate({ verbose, dryRun })
    .then(result => {
      process.exitCode = 0;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
