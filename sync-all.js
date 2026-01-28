require('varlock/auto-load');

const { requireProductionServer } = require('./lib/server-check');
const { createSyncLogger } = require('./lib/logger');
const { runDownload } = require('./download-data-from-sportlink');
const { runTeamDownload } = require('./download-teams-from-sportlink');
const { runPrepare } = require('./prepare-laposta-members');
const { runSubmit } = require('./submit-laposta-list');
const { runSync: runStadionSync } = require('./submit-stadion-sync');
const { runSync: runTeamSync } = require('./submit-stadion-teams');
const { runSync: runWorkHistorySync } = require('./submit-stadion-work-history');
const { runPhotoDownload } = require('./download-photos-from-sportlink');
const { runPhotoSync } = require('./upload-photos-to-stadion');
const { runSync: runBirthdaySync } = require('./sync-important-dates');
const { runFunctionsDownload } = require('./download-functions-from-sportlink');
const { runSync: runCommissieSync } = require('./submit-stadion-commissies');
const { runSync: runCommissieWorkHistorySync } = require('./submit-stadion-commissie-work-history');
const { runSubmit: runFreescoutSubmit } = require('./submit-freescout-sync');
const { checkCredentials: checkFreescoutCredentials } = require('./lib/freescout-client');
const { openDb } = require('./lib/stadion-db');

/**
 * Parse CLI arguments
 * @param {string[]} argv - Process arguments
 * @returns {{ verbose: boolean, force: boolean, dryRun: boolean }}
 */
function parseArgs(argv) {
  return {
    verbose: argv.includes('--verbose'),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run')
  };
}

/**
 * Format duration in human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2m 34s" or "45s")
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Print summary report
 * @param {Object} logger - Logger instance
 * @param {Object} stats - Collected statistics
 */
function printSummary(logger, stats) {
  const divider = '========================================';
  const minorDivider = '----------------------------------------';

  logger.log('');
  logger.log(divider);
  logger.log('SPORTLINK SYNC SUMMARY');
  logger.log(divider);
  logger.log('');
  logger.log(`Completed: ${stats.completedAt}`);
  logger.log(`Duration: ${stats.duration}`);
  logger.log('');

  logger.log('TOTALS');
  logger.log(minorDivider);
  logger.log(`Members downloaded: ${stats.downloaded}`);
  logger.log(`Members prepared: ${stats.prepared} (${stats.excluded} excluded as duplicates)`);
  logger.log(`Members synced: ${stats.synced} (${stats.added} added, ${stats.updated} updated)`);
  logger.log(`Errors: ${stats.errors.length}`);
  logger.log('');

  logger.log('PER-LIST BREAKDOWN');
  logger.log(minorDivider);
  stats.lists.forEach(list => {
    if (list.listId) {
      logger.log(`List ${list.index}: ${list.total} members, ${list.synced} synced (${list.added} added, ${list.updated} updated)`);
    } else {
      logger.log(`List ${list.index}: not configured`);
    }
  });
  logger.log('');

  logger.log('STADION SYNC');
  logger.log(minorDivider);
  logger.log(`Persons synced: ${stats.stadion.synced}/${stats.stadion.total} (${stats.stadion.created} created, ${stats.stadion.updated} updated)`);
  logger.log(`Skipped: ${stats.stadion.skipped} (unchanged)`);
  if (stats.stadion.deleted > 0) {
    logger.log(`Deleted: ${stats.stadion.deleted}`);
  }
  logger.log('');

  logger.log('TEAM SYNC');
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

  logger.log('FUNCTIONS & COMMISSIES SYNC');
  logger.log(minorDivider);
  if (stats.functions.total > 0) {
    logger.log(`Functions downloaded: ${stats.functions.downloaded}/${stats.functions.total} members`);
    if (stats.functions.functionsCount > 0) {
      logger.log(`  Club functions found: ${stats.functions.functionsCount}`);
    }
    if (stats.functions.committeesCount > 0) {
      logger.log(`  Committee memberships found: ${stats.functions.committeesCount}`);
    }
  } else {
    logger.log('Functions downloaded: 0 changes');
  }
  if (stats.commissies.total > 0) {
    logger.log(`Commissies synced: ${stats.commissies.synced}/${stats.commissies.total}`);
    if (stats.commissies.created > 0) {
      logger.log(`  Created: ${stats.commissies.created}`);
    }
    if (stats.commissies.updated > 0) {
      logger.log(`  Updated: ${stats.commissies.updated}`);
    }
    if (stats.commissies.deleted > 0) {
      logger.log(`  Deleted: ${stats.commissies.deleted}`);
    }
  } else {
    logger.log('Commissies synced: 0 changes');
  }
  if (stats.commissieWorkHistory.total > 0) {
    logger.log(`Commissie work history: ${stats.commissieWorkHistory.synced}/${stats.commissieWorkHistory.total}`);
    if (stats.commissieWorkHistory.created > 0) {
      logger.log(`  Commissie assignments added: ${stats.commissieWorkHistory.created}`);
    }
    if (stats.commissieWorkHistory.ended > 0) {
      logger.log(`  Commissie assignments ended: ${stats.commissieWorkHistory.ended}`);
    }
    if (stats.commissieWorkHistory.skipped > 0) {
      logger.log(`  Skipped: ${stats.commissieWorkHistory.skipped} (not yet in Stadion)`);
    }
  } else {
    logger.log('Commissie work history: 0 changes');
  }
  logger.log('');

  logger.log('PHOTO SYNC');
  logger.log(minorDivider);
  const photoDownloadText = stats.photos.download.total > 0
    ? `${stats.photos.download.downloaded}/${stats.photos.download.total}`
    : '0 changes';
  logger.log(`Photos downloaded: ${photoDownloadText}`);
  if (stats.photos.download.failed > 0) {
    logger.log(`  Failed: ${stats.photos.download.failed}`);
  }

  const photoUploadText = stats.photos.upload.total > 0
    ? `${stats.photos.upload.synced}/${stats.photos.upload.total}`
    : '0 changes';
  logger.log(`Photos uploaded: ${photoUploadText}`);
  if (stats.photos.upload.skipped > 0) {
    logger.log(`  Skipped: ${stats.photos.upload.skipped}`);
  }

  const photoDeleteText = stats.photos.delete.total > 0
    ? `${stats.photos.delete.deleted}/${stats.photos.delete.total}`
    : '0 changes';
  logger.log(`Photos deleted: ${photoDeleteText}`);

  logger.log(`Coverage: ${stats.photos.coverage.members_with_photos} of ${stats.photos.coverage.total_members} members have photos`);
  logger.log('');

  logger.log('BIRTHDAY SYNC');
  logger.log(minorDivider);
  const birthdaySyncText = stats.birthdays.total > 0
    ? `${stats.birthdays.synced}/${stats.birthdays.total}`
    : '0 changes';
  logger.log(`Birthdays synced: ${birthdaySyncText}`);
  if (stats.birthdays.created > 0) {
    logger.log(`  Created: ${stats.birthdays.created}`);
  }
  if (stats.birthdays.updated > 0) {
    logger.log(`  Updated: ${stats.birthdays.updated}`);
  }
  if (stats.birthdays.deleted > 0) {
    logger.log(`  Deleted: ${stats.birthdays.deleted}`);
  }
  logger.log('');

  logger.log('FREESCOUT SYNC');
  logger.log(minorDivider);
  if (stats.freescout.total > 0) {
    const freescoutSyncText = `${stats.freescout.synced}/${stats.freescout.total}`;
    logger.log(`Customers synced: ${freescoutSyncText}`);
    if (stats.freescout.created > 0) {
      logger.log(`  Created: ${stats.freescout.created}`);
    }
    if (stats.freescout.updated > 0) {
      logger.log(`  Updated: ${stats.freescout.updated}`);
    }
    if (stats.freescout.skipped > 0) {
      logger.log(`  Skipped: ${stats.freescout.skipped} (unchanged)`);
    }
    if (stats.freescout.deleted > 0) {
      logger.log(`  Deleted: ${stats.freescout.deleted}`);
    }
  } else {
    logger.log('Customers synced: skipped (not configured)');
  }
  logger.log('');

  const allErrors = [
    ...stats.errors,
    ...stats.stadion.errors,
    ...stats.teams.errors,
    ...stats.workHistory.errors,
    ...stats.functions.errors,
    ...stats.commissies.errors,
    ...stats.commissieWorkHistory.errors,
    ...stats.photos.download.errors,
    ...stats.photos.upload.errors,
    ...stats.photos.delete.errors,
    ...stats.birthdays.errors,
    ...stats.freescout.errors
  ];
  if (allErrors.length > 0) {
    logger.log(`ERRORS (${allErrors.length})`);
    logger.log(minorDivider);
    allErrors.forEach(error => {
      const identifier = error.knvb_id || error.email || 'system';
      const system = error.system ? ` [${error.system}]` : '';
      logger.log(`- ${identifier}${system}: ${error.message}`);
    });
    logger.log('');
  }

  logger.log(divider);
}

/**
 * Run the full sync pipeline
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all members
 * @returns {Promise<{success: boolean, stats: Object, error?: string}>}
 */
async function runSyncAll(options = {}) {
  const { verbose = false, force = false } = options;

  const logger = createSyncLogger({ verbose });
  const startTime = Date.now();

  const stats = {
    completedAt: '',
    duration: '',
    downloaded: 0,
    prepared: 0,
    excluded: 0,
    synced: 0,
    added: 0,
    updated: 0,
    errors: [],
    lists: [],
    stadion: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: []
    },
    photos: {
      download: {
        total: 0,
        downloaded: 0,
        skipped: 0,
        failed: 0,
        errors: []
      },
      upload: {
        total: 0,
        synced: 0,
        skipped: 0,
        errors: []
      },
      delete: {
        total: 0,
        deleted: 0,
        errors: []
      },
      coverage: {
        members_with_photos: 0,
        total_members: 0
      }
    },
    birthdays: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
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
    },
    functions: {
      total: 0,
      downloaded: 0,
      functionsCount: 0,
      committeesCount: 0,
      errors: []
    },
    commissies: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: []
    },
    commissieWorkHistory: {
      total: 0,
      synced: 0,
      created: 0,
      ended: 0,
      skipped: 0,
      errors: []
    },
    freescout: {
      total: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      errors: []
    }
  };

  try {
    // Step 1: Download from Sportlink
    logger.verbose('Starting download from Sportlink...');
    const downloadResult = await runDownload({ logger, verbose });

    if (!downloadResult.success) {
      const errorMsg = downloadResult.error || 'Download failed';
      logger.error(`Download failed: ${errorMsg}`);
      stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    stats.downloaded = downloadResult.memberCount;
    logger.verbose(`Downloaded ${downloadResult.memberCount} members`);

    // Step 2: Prepare Laposta members
    logger.verbose('Preparing Laposta members...');
    const prepareResult = await runPrepare({ logger, verbose });

    if (!prepareResult.success) {
      const errorMsg = prepareResult.error || 'Prepare failed';
      logger.error(`Prepare failed: ${errorMsg}`);
      stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      stats.duration = formatDuration(Date.now() - startTime);
      printSummary(logger, stats);
      logger.close();
      return { success: false, stats, error: errorMsg };
    }

    // Sum up total prepared members and updates
    stats.prepared = prepareResult.lists.reduce((sum, list) => sum + list.total, 0);
    stats.excluded = prepareResult.excluded;
    logger.verbose(`Prepared ${stats.prepared} members (${stats.excluded} excluded)`);

    // Step 3: Submit to Laposta
    logger.verbose('Submitting to Laposta...');
    const submitResult = await runSubmit({ logger, verbose, force });

    // Collect submit stats (even if there were errors)
    stats.lists = submitResult.lists.map(list => ({
      index: list.index,
      listId: list.listId,
      total: list.total,
      synced: list.synced,
      added: list.added,
      updated: list.updated,
      errors: list.errors
    }));

    // Calculate totals
    stats.synced = stats.lists.reduce((sum, list) => sum + list.synced, 0);
    stats.added = stats.lists.reduce((sum, list) => sum + list.added, 0);
    stats.updated = stats.lists.reduce((sum, list) => sum + list.updated, 0);

    // Collect all errors
    stats.lists.forEach(list => {
      if (list.errors && list.errors.length > 0) {
        stats.errors.push(...list.errors);
      }
    });

    // Step 4: Sync to Stadion
    logger.verbose('Syncing to Stadion...');
    try {
      const stadionResult = await runStadionSync({ logger, verbose, force });

      // Members stats
      stats.stadion.total = stadionResult.total;
      stats.stadion.synced = stadionResult.synced;
      stats.stadion.created = stadionResult.created;
      stats.stadion.updated = stadionResult.updated;
      stats.stadion.skipped = stadionResult.skipped;
      stats.stadion.deleted = stadionResult.deleted;

      // Parents stats (add to totals for combined persons count)
      if (stadionResult.parents) {
        stats.stadion.total += stadionResult.parents.total;
        stats.stadion.synced += stadionResult.parents.synced;
        stats.stadion.created += stadionResult.parents.created;
        stats.stadion.updated += stadionResult.parents.updated;
        stats.stadion.skipped += stadionResult.parents.skipped;
        stats.stadion.deleted += stadionResult.parents.deleted;

        // Collect parent errors
        if (stadionResult.parents.errors?.length > 0) {
          stats.stadion.errors.push(...stadionResult.parents.errors.map(e => ({
            email: e.email,
            message: e.message,
            system: 'stadion'
          })));
        }
      }

      // Collect member errors
      if (stadionResult.errors?.length > 0) {
        stats.stadion.errors.push(...stadionResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          email: e.email,
          message: e.message,
          system: 'stadion'
        })));
      }
    } catch (err) {
      // Stadion failure is non-critical - log error but continue
      logger.error(`Stadion sync failed: ${err.message}`);
      stats.stadion.errors.push({
        message: `Stadion sync failed: ${err.message}`,
        system: 'stadion'
      });
    }

    // Step 4b: Team Download + Sync (NON-CRITICAL)
    logger.verbose('Downloading teams from Sportlink...');
    let teamDownloadSportlinkIds = [];
    try {
      const teamDownloadResult = await runTeamDownload({ logger, verbose });
      if (teamDownloadResult.success) {
        logger.verbose(`Downloaded ${teamDownloadResult.teamCount} teams with ${teamDownloadResult.memberCount} members`);
        // Store the sportlink IDs for orphan detection
        const { getAllTeamsForSync } = require('./lib/stadion-db');
        const db = openDb();
        const allTeams = getAllTeamsForSync(db);
        teamDownloadSportlinkIds = allTeams.filter(t => t.sportlink_id).map(t => t.sportlink_id);
        db.close();
      } else {
        logger.error(`Team download failed: ${teamDownloadResult.error}`);
        stats.teams.errors.push({
          message: `Team download failed: ${teamDownloadResult.error}`,
          system: 'team-download'
        });
      }
    } catch (err) {
      logger.error(`Team download failed: ${err.message}`);
      stats.teams.errors.push({
        message: `Team download failed: ${err.message}`,
        system: 'team-download'
      });
    }

    logger.verbose('Syncing teams to Stadion...');
    try {
      const teamResult = await runTeamSync({ logger, verbose, force, currentSportlinkIds: teamDownloadSportlinkIds });
      stats.teams.total = teamResult.total;
      stats.teams.synced = teamResult.synced;
      stats.teams.created = teamResult.created;
      stats.teams.updated = teamResult.updated;
      stats.teams.skipped = teamResult.skipped;
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

    // Step 4c: Work History Sync (NON-CRITICAL)
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

    // Step 4d: Functions Download from Sportlink (NON-CRITICAL)
    logger.verbose('Downloading functions from Sportlink...');
    try {
      const functionsResult = await runFunctionsDownload({ logger, verbose });
      stats.functions.total = functionsResult.total;
      stats.functions.downloaded = functionsResult.downloaded;
      stats.functions.functionsCount = functionsResult.functionsCount;
      stats.functions.committeesCount = functionsResult.committeesCount;
      if (functionsResult.errors?.length > 0) {
        stats.functions.errors = functionsResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'functions-download'
        }));
      }
    } catch (err) {
      logger.error(`Functions download failed: ${err.message}`);
      stats.functions.errors.push({
        message: `Functions download failed: ${err.message}`,
        system: 'functions-download'
      });
    }

    // Step 4e: Commissie Sync (NON-CRITICAL)
    logger.verbose('Syncing commissies to Stadion...');
    try {
      const commissieResult = await runCommissieSync({ logger, verbose, force });
      stats.commissies.total = commissieResult.total;
      stats.commissies.synced = commissieResult.synced;
      stats.commissies.created = commissieResult.created;
      stats.commissies.updated = commissieResult.updated;
      stats.commissies.skipped = commissieResult.skipped;
      stats.commissies.deleted = commissieResult.deleted;
      if (commissieResult.errors?.length > 0) {
        stats.commissies.errors = commissieResult.errors.map(e => ({
          commissie_name: e.commissie_name,
          message: e.message,
          system: 'commissie-sync'
        }));
      }
    } catch (err) {
      logger.error(`Commissie sync failed: ${err.message}`);
      stats.commissies.errors.push({
        message: `Commissie sync failed: ${err.message}`,
        system: 'commissie-sync'
      });
    }

    // Step 4f: Commissie Work History Sync (NON-CRITICAL)
    logger.verbose('Syncing commissie work history to Stadion...');
    try {
      const commissieWorkHistoryResult = await runCommissieWorkHistorySync({ logger, verbose, force });
      stats.commissieWorkHistory.total = commissieWorkHistoryResult.total;
      stats.commissieWorkHistory.synced = commissieWorkHistoryResult.synced;
      stats.commissieWorkHistory.created = commissieWorkHistoryResult.created;
      stats.commissieWorkHistory.ended = commissieWorkHistoryResult.ended;
      stats.commissieWorkHistory.skipped = commissieWorkHistoryResult.skipped;
      if (commissieWorkHistoryResult.errors?.length > 0) {
        stats.commissieWorkHistory.errors = commissieWorkHistoryResult.errors.map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'commissie-work-history-sync'
        }));
      }
    } catch (err) {
      logger.error(`Commissie work history sync failed: ${err.message}`);
      stats.commissieWorkHistory.errors.push({
        message: `Commissie work history sync failed: ${err.message}`,
        system: 'commissie-work-history-sync'
      });
    }

    // Step 5: Photo Download (NON-CRITICAL)
    logger.verbose('Downloading photos from Sportlink...');
    try {
      const photoDownloadResult = await runPhotoDownload({ logger, verbose });

      stats.photos.download = {
        total: photoDownloadResult.total,
        downloaded: photoDownloadResult.downloaded,
        skipped: photoDownloadResult.skipped || 0,
        failed: photoDownloadResult.failed,
        errors: (photoDownloadResult.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-download'
        }))
      };
    } catch (err) {
      logger.error(`Photo download failed: ${err.message}`);
      stats.photos.download.errors.push({
        message: `Photo download failed: ${err.message}`,
        system: 'photo-download'
      });
    }

    // Step 6: Photo Upload/Delete (NON-CRITICAL)
    logger.verbose('Syncing photos to Stadion...');
    try {
      const photoSyncResult = await runPhotoSync({ logger, verbose });

      stats.photos.upload = {
        total: photoSyncResult.upload.total,
        synced: photoSyncResult.upload.synced,
        skipped: photoSyncResult.upload.skipped,
        errors: (photoSyncResult.upload.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-upload'
        }))
      };

      stats.photos.delete = {
        total: photoSyncResult.delete.total,
        deleted: photoSyncResult.delete.deleted,
        errors: (photoSyncResult.delete.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'photo-delete'
        }))
      };
    } catch (err) {
      logger.error(`Photo sync failed: ${err.message}`);
      stats.photos.upload.errors.push({
        message: `Photo sync failed: ${err.message}`,
        system: 'photo-upload'
      });
    }

    // Calculate photo coverage
    try {
      const db = openDb();
      const totalMembers = db.prepare('SELECT COUNT(*) as count FROM stadion_members').get().count;
      const membersWithPhotos = db.prepare(
        "SELECT COUNT(*) as count FROM stadion_members WHERE photo_state = 'synced'"
      ).get().count;
      db.close();

      stats.photos.coverage = {
        members_with_photos: membersWithPhotos,
        total_members: totalMembers
      };
    } catch (err) {
      logger.verbose(`Could not calculate photo coverage: ${err.message}`);
    }

    // Step 7: Birthday Sync (NON-CRITICAL)
    logger.verbose('Syncing birthdays to Stadion...');
    try {
      const birthdayResult = await runBirthdaySync({ logger, verbose, force });

      stats.birthdays = {
        total: birthdayResult.total,
        synced: birthdayResult.synced,
        created: birthdayResult.created,
        updated: birthdayResult.updated,
        skipped: birthdayResult.skipped,
        deleted: birthdayResult.deleted,
        errors: (birthdayResult.errors || []).map(e => ({
          knvb_id: e.knvb_id,
          message: e.message,
          system: 'birthday-sync'
        }))
      };
    } catch (err) {
      logger.error(`Birthday sync failed: ${err.message}`);
      stats.birthdays.errors.push({
        message: `Birthday sync failed: ${err.message}`,
        system: 'birthday-sync'
      });
    }

    // Step 8: FreeScout Sync (NON-CRITICAL, only if credentials configured)
    const freescoutCreds = checkFreescoutCredentials();
    if (freescoutCreds.configured) {
      logger.verbose('Syncing to FreeScout...');
      try {
        const freescoutResult = await runFreescoutSubmit({ logger, verbose, force });

        stats.freescout = {
          total: freescoutResult.total,
          synced: freescoutResult.synced,
          created: freescoutResult.created,
          updated: freescoutResult.updated,
          skipped: freescoutResult.skipped,
          deleted: freescoutResult.deleted,
          errors: (freescoutResult.errors || []).map(e => ({
            knvb_id: e.knvb_id,
            email: e.email,
            message: e.message,
            system: 'freescout'
          }))
        };
      } catch (err) {
        logger.error(`FreeScout sync failed: ${err.message}`);
        stats.freescout.errors.push({
          message: `FreeScout sync failed: ${err.message}`,
          system: 'freescout'
        });
      }
    } else {
      logger.verbose('FreeScout sync skipped (credentials not configured)');
    }

    // Complete timing
    const endTime = Date.now();
    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(endTime - startTime);

    // Print summary
    printSummary(logger, stats);

    // Log file location
    logger.log(`Log file: ${logger.getLogPath()}`);

    logger.close();

    return {
      success: stats.errors.length === 0 &&
               stats.stadion.errors.length === 0 &&
               stats.teams.errors.length === 0 &&
               stats.workHistory.errors.length === 0 &&
               stats.functions.errors.length === 0 &&
               stats.commissies.errors.length === 0 &&
               stats.commissieWorkHistory.errors.length === 0 &&
               stats.photos.download.errors.length === 0 &&
               stats.photos.upload.errors.length === 0 &&
               stats.photos.delete.errors.length === 0 &&
               stats.birthdays.errors.length === 0 &&
               stats.freescout.errors.length === 0,
      stats
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logger.error(`Fatal error: ${errorMsg}`);

    stats.completedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    stats.duration = formatDuration(Date.now() - startTime);
    printSummary(logger, stats);

    logger.close();

    return { success: false, stats, error: errorMsg };
  }
}

module.exports = { runSyncAll };

// CLI entry point
if (require.main === module) {
  // Prevent accidental local runs that cause duplicate entries
  requireProductionServer({
    allowLocal: true,
    scriptName: 'sync-all.js'
  });

  const { verbose, force, dryRun } = parseArgs(process.argv);

  runSyncAll({ verbose, force, dryRun })
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
