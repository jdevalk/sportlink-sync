require('varlock/auto-load');

const { stadionRequest } = require('./lib/stadion-client');
const { runPrepare } = require('./prepare-stadion-teams');
const {
  openDb,
  upsertTeams,
  getTeamsNeedingSync,
  updateTeamSyncState
} = require('./lib/stadion-db');

/**
 * Sync a single team to Stadion (create or update)
 * Uses local stadion_id tracking - no API search needed
 * @param {Object} team - Team record from database
 * @param {Object} db - SQLite database connection
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<{action: string, id: number}>}
 */
async function syncTeam(team, db, options) {
  const { team_name, source_hash, stadion_id, last_synced_hash } = team;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  if (stadion_id) {
    // Team exists - check if changed
    if (source_hash === last_synced_hash) {
      logVerbose(`Team unchanged, skipping: ${team_name}`);
      return { action: 'skipped', id: stadion_id };
    }
    // UPDATE existing team (unlikely - team names don't change often)
    logVerbose(`Updating existing team: ${stadion_id} - ${team_name}`);
    const response = await stadionRequest(
      `wp/v2/teams/${stadion_id}`,
      'PUT',
      { title: team_name, status: 'publish' },
      options
    );
    updateTeamSyncState(db, team_name, source_hash, stadion_id);
    return { action: 'updated', id: stadion_id };
  } else {
    // CREATE new team
    logVerbose(`Creating new team: ${team_name}`);
    const response = await stadionRequest(
      'wp/v2/teams',
      'POST',
      { title: team_name, status: 'publish' },
      options
    );
    const newId = response.body.id;
    updateTeamSyncState(db, team_name, source_hash, newId);
    return { action: 'created', id: newId };
  }
}

/**
 * Main sync orchestration for teams
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all teams
 * @returns {Promise<Object>} - Sync result
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
    errors: []
  };

  try {
    const db = openDb();
    try {
      // Step 1: Prepare teams from Sportlink
      const prepared = await runPrepare({ logger, verbose });
      if (!prepared.success) {
        result.success = false;
        result.error = prepared.error;
        return result;
      }

      const teams = prepared.teams;
      result.total = teams.length;

      logVerbose(`Preparing to sync ${teams.length} teams to Stadion`);

      // Step 2: Upsert to tracking database
      upsertTeams(db, teams);

      // Step 3: Get teams needing sync (hash changed or force)
      const needsSync = getTeamsNeedingSync(db, force);
      result.skipped = result.total - needsSync.length;

      logVerbose(`${needsSync.length} teams need sync (${result.skipped} unchanged)`);

      // Step 4: Sync each team
      for (let i = 0; i < needsSync.length; i++) {
        const team = needsSync[i];
        logVerbose(`Syncing ${i + 1}/${needsSync.length}: ${team.team_name}`);

        try {
          const syncResult = await syncTeam(team, db, options);
          if (syncResult.action !== 'skipped') {
            result.synced++;
          }
          if (syncResult.action === 'created') result.created++;
          if (syncResult.action === 'updated') result.updated++;
          if (syncResult.action === 'skipped') result.skipped++;
        } catch (error) {
          result.errors.push({
            team_name: team.team_name,
            message: error.message
          });
          logError(`Error syncing team ${team.team_name}: ${error.message}`);
        }
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
      console.log(`Stadion teams sync: ${result.synced}/${result.total} synced`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Skipped: ${result.skipped}`);
      if (result.errors.length > 0) {
        console.error(`  Errors: ${result.errors.length}`);
        result.errors.forEach(e => console.error(`    - ${e.team_name}: ${e.message}`));
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
