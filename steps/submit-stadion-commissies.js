require('varlock/auto-load');

const { stadionRequest } = require('../lib/stadion-client');
const {
  openDb,
  getCommissiesNeedingSync,
  updateCommissieSyncState,
  getOrphanCommissies,
  deleteCommissie,
  getAllCommissies,
  upsertCommissies
} = require('../lib/stadion-db');

/**
 * Fetch all commissies from WordPress API (paginated)
 * @param {Object} options - Logger options
 * @returns {Promise<Array<{id: number, title: string}>>}
 */
async function fetchAllWordPressCommissies(options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});
  const commissies = [];
  let page = 1;

  while (true) {
    try {
      const response = await stadionRequest(`wp/v2/commissies?per_page=100&page=${page}`, 'GET', null, options);
      const pageCommissies = response.body;
      if (pageCommissies.length === 0) break;
      commissies.push(...pageCommissies.map(c => ({ id: c.id, title: c.title?.rendered || c.title })));
      logVerbose(`  Fetched page ${page}: ${pageCommissies.length} commissies`);
      page++;
    } catch (error) {
      // End of pages (400 error) or other error
      if (error.details?.code === 'rest_post_invalid_page_number') {
        break;
      }
      throw error;
    }
  }

  return commissies;
}

/**
 * Sync a single commissie to Stadion (create or update)
 * @param {Object} commissie - Commissie record from database
 * @param {Object} db - SQLite database connection
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<{action: string, id: number}>}
 */
async function syncCommissie(commissie, db, options) {
  const { commissie_name, source_hash, last_synced_hash } = commissie;
  let { stadion_id } = commissie;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  if (stadion_id) {
    // Commissie exists - check if changed (unless force)
    if (!options.force && source_hash === last_synced_hash) {
      logVerbose(`Commissie unchanged, skipping: ${commissie_name}`);
      return { action: 'skipped', id: stadion_id };
    }
    // UPDATE existing commissie
    const payload = {
      title: commissie_name,
      status: 'publish'
    };
    const endpoint = `wp/v2/commissies/${stadion_id}`;
    logVerbose(`Updating existing commissie: ${stadion_id} - ${commissie_name}`);
    logVerbose(`  PUT ${endpoint}`);
    try {
      const response = await stadionRequest(endpoint, 'PUT', payload, options);
      updateCommissieSyncState(db, commissie_name, source_hash, stadion_id);
      return { action: 'updated', id: stadion_id };
    } catch (error) {
      // Check if commissie was deleted in WordPress (404)
      if (error.details?.code === 'rest_post_invalid_id' || error.details?.data?.status === 404) {
        logVerbose(`Commissie ${commissie_name} (ID: ${stadion_id}) no longer exists in WordPress, recreating...`);
        stadion_id = null;
        updateCommissieSyncState(db, commissie_name, null, null);
      } else {
        console.error(`API Error updating commissie "${commissie_name}" (ID: ${stadion_id}):`);
        console.error(`  Status: ${error.message}`);
        if (error.details) {
          console.error(`  Code: ${error.details.code || 'unknown'}`);
          console.error(`  Message: ${error.details.message || JSON.stringify(error.details)}`);
        }
        throw error;
      }
    }
  }

  // CREATE new commissie (or recreate if deleted from WordPress)
  if (!stadion_id) {
    const payload = {
      title: commissie_name,
      status: 'publish',
      content: ''
    };
    const endpoint = 'wp/v2/commissies';
    logVerbose(`Creating new commissie: ${commissie_name}`);
    logVerbose(`  POST ${endpoint}`);
    try {
      const response = await stadionRequest(endpoint, 'POST', payload, options);
      const newId = response.body.id;
      updateCommissieSyncState(db, commissie_name, source_hash, newId);
      return { action: 'created', id: newId };
    } catch (error) {
      console.error(`API Error creating commissie "${commissie_name}":`);
      console.error(`  Status: ${error.message}`);
      if (error.details) {
        console.error(`  Code: ${error.details.code || 'unknown'}`);
        console.error(`  Message: ${error.details.message || JSON.stringify(error.details)}`);
      }
      throw error;
    }
  }
}

/**
 * Main sync orchestration for commissies
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all commissies
 * @param {Array<string>} [options.currentCommissieNames] - Current commissie names for orphan detection
 * @returns {Promise<Object>} - Sync result
 */
async function runSync(options = {}) {
  const { logger, verbose = false, force = false, currentCommissieNames = null } = options;
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

  try {
    const db = openDb();
    try {
      // Ensure "Verenigingsbreed" commissie exists (for club-level functions)
      const existingCommissies = getAllCommissies(db);
      const hasVerenigingsbreed = existingCommissies.some(c => c.commissie_name === 'Verenigingsbreed');

      if (!hasVerenigingsbreed) {
        logVerbose('Creating "Verenigingsbreed" commissie for club-level functions');
        upsertCommissies(db, [{ commissie_name: 'Verenigingsbreed', sportlink_id: null }]);
      }

      // Get all commissies needing sync
      const needsSync = getCommissiesNeedingSync(db, force);
      result.total = needsSync.length;

      if (needsSync.length === 0) {
        logVerbose('No commissies need syncing');
      } else {
        logVerbose(`${needsSync.length} commissies need sync`);

        // Sync each commissie
        for (let i = 0; i < needsSync.length; i++) {
          const commissie = needsSync[i];
          logVerbose(`Syncing ${i + 1}/${needsSync.length}: ${commissie.commissie_name}`);

          try {
            const syncResult = await syncCommissie(commissie, db, options);
            if (syncResult.action !== 'skipped') {
              result.synced++;
            }
            if (syncResult.action === 'created') result.created++;
            if (syncResult.action === 'updated') result.updated++;
            if (syncResult.action === 'skipped') result.skipped++;
          } catch (error) {
            result.errors.push({
              commissie_name: commissie.commissie_name,
              message: error.message
            });
            logError(`Error syncing commissie ${commissie.commissie_name}: ${error.message}`);
          }
        }
      }

      // Handle orphan commissies (if we have current names list)
      if (currentCommissieNames) {
        const orphanCommissies = getOrphanCommissies(db, currentCommissieNames);
        if (orphanCommissies.length > 0) {
          logVerbose(`Found ${orphanCommissies.length} orphan commissies to delete`);

          for (const orphan of orphanCommissies) {
            logVerbose(`Deleting orphan commissie: ${orphan.commissie_name} (ID: ${orphan.stadion_id})`);

            // Delete from WordPress if it has a stadion_id
            if (orphan.stadion_id) {
              try {
                await stadionRequest(`wp/v2/commissies/${orphan.stadion_id}`, 'DELETE', { force: true }, options);
                logVerbose(`  Deleted from WordPress: ${orphan.stadion_id}`);
              } catch (error) {
                // Ignore 404 errors (already deleted)
                if (error.details?.data?.status !== 404) {
                  logError(`  Error deleting from WordPress: ${error.message}`);
                  result.errors.push({
                    commissie_name: orphan.commissie_name,
                    message: `Delete failed: ${error.message}`
                  });
                  continue;
                }
                logVerbose(`  Already deleted from WordPress (404)`);
              }
            }

            // Delete from tracking database
            deleteCommissie(db, orphan.commissie_name);
            result.deleted++;
          }
        }
      }

      // Delete untracked WordPress commissies
      logVerbose('Checking for untracked commissies in WordPress...');
      const wordPressCommissies = await fetchAllWordPressCommissies(options);
      const allCommissies = getAllCommissies(db);
      const trackedStadionIds = new Set(allCommissies.filter(c => c.stadion_id).map(c => c.stadion_id));

      const untrackedCommissies = wordPressCommissies.filter(c => !trackedStadionIds.has(c.id));
      if (untrackedCommissies.length > 0) {
        logVerbose(`Found ${untrackedCommissies.length} untracked commissies in WordPress to delete`);

        for (const commissie of untrackedCommissies) {
          logVerbose(`Deleting untracked commissie: ${commissie.title} (ID: ${commissie.id})`);
          try {
            await stadionRequest(`wp/v2/commissies/${commissie.id}`, 'DELETE', { force: true }, options);
            logVerbose(`  Deleted from WordPress: ${commissie.id}`);
            result.deleted++;
          } catch (error) {
            if (error.details?.data?.status !== 404) {
              logError(`  Error deleting untracked commissie: ${error.message}`);
              result.errors.push({
                commissie_name: commissie.title,
                message: `Delete untracked failed: ${error.message}`
              });
            } else {
              logVerbose(`  Already deleted from WordPress (404)`);
            }
          }
        }
      } else {
        logVerbose('No untracked commissies found in WordPress');
      }

    } finally {
      db.close();
    }

    result.success = result.errors.length === 0;
    return result;

  } catch (error) {
    result.success = false;
    result.error = error.message;
    logError(`Sync error: ${error.message}`);
    return result;
  }
}

module.exports = { runSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  const options = {
    verbose,
    force
  };

  runSync(options)
    .then(result => {
      console.log(`Stadion commissies sync: ${result.synced}/${result.total} synced`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Skipped: ${result.skipped}`);
      if (result.deleted > 0) {
        console.log(`  Deleted: ${result.deleted} (orphan commissies)`);
      }
      if (result.errors.length > 0) {
        console.error(`  Errors: ${result.errors.length}`);
        result.errors.forEach(e => console.error(`    - ${e.commissie_name}: ${e.message}`));
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
