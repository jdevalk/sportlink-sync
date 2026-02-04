require('varlock/auto-load');

const { createSyncLogger } = require('./lib/logger');
const { formatDuration, formatTimestamp } = require('./lib/utils');
const { runTeamDownload } = require('./download-teams-from-sportlink');
const { runSync: runTeamSync } = require('./submit-stadion-teams');
const { runSync: runWorkHistorySync } = require('./submit-stadion-work-history');

/**
 * Print summary report for team sync
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('TEAM SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('TEAM DOWNLOAD');
  logger.log(minorDivider);
  logger.log(`Teams downloaded: ${stats.download.teamCount}`);
  logger.log(`Team members downloaded: ${stats.download.memberCount}`);
  logger.log('');

  logger.log('TEAM SYNC TO STADION');
  logger.log(minorDivider);
  if (stats.teams.total > 0) {
    logger.log(`Teams synced: ${stats.teams.synced}/${stats.teams.total}`);
    if (stats.teams.created > 0) {
      logger.log(`  Created: ${stats.teams.created}`);
    }
    if (stats.teams.updated > 0) {
      logger.log(`  Updated: ${stats.teams.updated}`);
    }
    if (stats.teams.skipped > 0) {
      logger.log(`  Skipped: ${stats.teams.skipped} (unchanged)`);
    }
  } else {
    logger.log('Teams synced: 0 changes');
  }
  logger.log('');

  logger.log('WORK HISTORY SYNC');
  logger.log(minorDivider);
  if (stats.workHistory.total > 0) {
    logger.log(`Members synced: ${stats.workHistory.synced}/${stats.workHistory.total}`);
    if (stats.workHistory.created > 0) {
      logger.log(`  Team assignments added: ${stats.workHistory.created}`);
    }
    if (stats.workHistory.ended > 0) {
      logger.log(`  Team assignments ended: ${stats.workHistory.ended}`);
    }
    if (stats.workHistory.skipped > 0) {
      logger.log(`  Skipped: ${stats.workHistory.skipped} (not yet in Stadion)`);
    }
  } else {
    logger.log('Work history synced: 0 changes');
  }
  logger.log('');

  const allErrors = [
    ...stats.download.errors,
    ...stats.teams.errors,
    ...stats.workHistory.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.knvb_id || error.team_name || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run team sync pipeline (weekly)
 * - Download teams from Sportlink (with player/staff roles)
 * - Sync teams to Stadion
 * - Sync work history
 *
 * Uses cached member data from last people sync (hourly download)
 */
async function runTeamsSync(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose, prefix: 'teams' });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    download: {
      teamCount: 0,
      memberCount: 0,
      errors: []
    },
    teams: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    },
    workHistory: {
      total: 0,
      synced: 0,
      created: 0,
      ended: 0,
      skipped: 0,
      errors: []
    }
  };

  try {
    // Step 1: Download teams from Sportlink
    logger.verbose('Downloading teams from Sportlink...');
    try {
      const teamDownloadResult = await runTeamDownload({ logger, verbose });
      stats.download.teamCount = teamDownloadResult.teamCount || 0;
      stats.download.memberCount = teamDownloadResult.memberCount || 0;
      if (!teamDownloadResult.success) {
        stats.download.errors.push({
          message: teamDownloadResult.error || 'Unknown error',
          system: 'team-download'
        });
      }
    } catch (err) {
      logger.error(`Team download failed: ${err.message}`);
      stats.download.errors.push({
        message: `Team download failed: ${err.message}`,
        system: 'team-download'
      });
    }

    // Step 2: Sync teams to Stadion
    logger.verbose('Syncing teams to Stadion...');
    try {
      // Get sportlink IDs for orphan detection (teams we just downloaded)
      const { openDb, getAllTeamsForSync } = require('./lib/stadion-db');
      const db = openDb();
      const allTeams = getAllTeamsForSync(db);
      const currentSportlinkIds = allTeams.filter(t => t.sportlink_id).map(t => t.sportlink_id);
      db.close();

      const teamResult = await runTeamSync({ logger, verbose, force, currentSportlinkIds });
      stats.teams.total = teamResult.total;
      stats.teams.synced = teamResult.synced;
      stats.teams.created = teamResult.created;
      stats.teams.updated = teamResult.updated;
      stats.teams.skipped = teamResult.skipped;
      stats.teams.deleted = teamResult.deleted || 0;
      if (teamResult.errors?.length > 0) {
        stats.teams.errors = teamResult.errors.map(e => ({
          team_name: e.team_name,
          message: e.message,
          system: 'team-sync'
        }));
      }
    } catch (err) {
      logger.error(`Team sync failed: ${err.message}`);
      stats.teams.errors.push({
        message: `Team sync failed: ${err.message}`,
        system: 'team-sync'
      });
    }

    // Step 3: Sync work history
    logger.verbose('Syncing work history to Stadion...');
    try {
      const workHistoryResult = await runWorkHistorySync({ logger, verbose, force });
      stats.workHistory.total = workHistoryResult.total;
      stats.workHistory.synced = workHistoryResult.synced;
      stats.workHistory.created = workHistoryResult.created;
      stats.workHistory.ended = workHistoryResult.ended;
      stats.workHistory.skipped = workHistoryResult.skipped;
      if (workHistoryResult.errors?.length > 0) {
        stats.workHistory.errors = workHistoryResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'work-history-sync'
        }));
      }
    } catch (err) {
      logger.error(`Work history sync failed: ${err.message}`);
      stats.workHistory.errors.push({
        message: `Work history sync failed: ${err.message}`,
        system: 'work-history-sync'
      });
    }

    // Complete
    stats.completedAt = formatTimestamp();
    stats.duration = formatDuration(Date.now() - startTime);

    printSummary(logger, stats);
    logger.log(`Log file: ${logger.getLogPath()}`);
    logger.close();

    return {
      success: stats.download.errors.length === 0 &&
               stats.teams.errors.length === 0 &&
               stats.workHistory.errors.length === 0,
      stats
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    stats.completedAt = formatTimestamp();
    stats.duration = formatDuration(Date.now() - startTime);
    printSummary(logger, stats);

    logger.close();

    return { success: false, stats, error: errorMsg };
  }
}

module.exports = { runTeamsSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');

  runTeamsSync({ verbose, force })
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
