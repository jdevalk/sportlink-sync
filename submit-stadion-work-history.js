require('varlock/auto-load');

const { stadionRequest } = require('./lib/stadion-client');
const { openDb: openLapostaDb, getLatestSportlinkResults } = require('./laposta-db');
const {
  openDb,
  getAllTeams,
  upsertWorkHistory,
  getWorkHistoryNeedingSync,
  getMemberWorkHistory,
  updateWorkHistorySyncState,
  deleteWorkHistory
} = require('./lib/stadion-db');

/**
 * Extract teams for a member from Sportlink data.
 * Priority: UnionTeams first, ClubTeams fallback.
 * Returns array of team names (member can be in multiple teams).
 * @param {Object} sportlinkMember - Sportlink member record
 * @returns {Array<string>} - Team names
 */
function extractMemberTeams(sportlinkMember) {
  const teams = [];

  // UnionTeams (priority)
  const unionTeam = (sportlinkMember.UnionTeams || '').trim();
  if (unionTeam) {
    teams.push(unionTeam);
  }

  // ClubTeams (fallback)
  const clubTeam = (sportlinkMember.ClubTeams || '').trim();
  if (clubTeam && clubTeam !== unionTeam) {
    teams.push(clubTeam);
  }

  return teams;
}

/**
 * Convert JS Date to ACF date format (YYYYMMDD).
 * @param {Date} date - Date object
 * @returns {string} - ACF date string
 */
function formatDateForACF(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Determine job title based on KernelGameActivities.
 * @param {string} kernelGameActivities - Value from Sportlink
 * @returns {string} - 'Speler' or 'Staflid'
 */
function determineJobTitle(kernelGameActivities) {
  return kernelGameActivities === 'Veld -  Algemeen' ? 'Speler' : 'Staflid';
}

/**
 * Build ACF work_history entry for a team.
 * @param {number} teamStadionId - Team WordPress post ID
 * @param {boolean} isBackfill - Is this a backfilled entry
 * @param {string} jobTitle - Job title ('Speler' or 'Staflid')
 * @returns {Object} - ACF work_history entry
 */
function buildWorkHistoryEntry(teamStadionId, isBackfill, jobTitle = 'Speler') {
  return {
    job_title: jobTitle,
    is_current: true,
    start_date: isBackfill ? '' : formatDateForACF(new Date()),
    end_date: '',
    company: [teamStadionId]
  };
}

/**
 * Detect team changes for a member.
 * Compares current teams from Sportlink vs tracked teams in SQLite.
 * @param {Object} db - SQLite database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {Array<string>} currentTeams - Current team names from Sportlink
 * @returns {Object} - { added: [], removed: [], unchanged: [] }
 */
function detectTeamChanges(db, knvbId, currentTeams) {
  const trackedHistory = getMemberWorkHistory(db, knvbId);
  const trackedTeams = trackedHistory.map(h => ({
    team_name: h.team_name,
    stadion_work_history_id: h.stadion_work_history_id
  }));

  const trackedTeamNames = new Set(trackedTeams.map(t => t.team_name));
  const currentTeamSet = new Set(currentTeams);

  const added = currentTeams.filter(t => !trackedTeamNames.has(t));
  const removed = trackedTeams.filter(t => !currentTeamSet.has(t.team_name));
  const unchanged = currentTeams.filter(t => trackedTeamNames.has(t));

  return { added, removed, unchanged };
}

/**
 * Sync work history for a single member.
 * Detects team changes and updates WordPress work_history ACF field.
 * @param {Object} member - Member with KNVB ID and current teams
 * @param {Array<string>} currentTeams - Current team names
 * @param {Object} db - Stadion SQLite database
 * @param {Map} teamMap - Map<team_name, stadion_id>
 * @param {Object} options - Logger and verbose options
 * @param {string} jobTitle - Job title ('Speler' or 'Staflid')
 * @param {boolean} force - Force update even unchanged entries
 * @returns {Promise<{action: string, added: number, ended: number, updated: number}>}
 */
async function syncWorkHistoryForMember(member, currentTeams, db, teamMap, options, jobTitle = 'Speler', force = false) {
  const { knvb_id, stadion_id } = member;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  // Skip if member not yet synced to Stadion
  if (!stadion_id) {
    logVerbose(`Skipping ${knvb_id}: not yet synced to Stadion`);
    return { action: 'skipped', added: 0, ended: 0 };
  }

  // Detect changes
  const changes = detectTeamChanges(db, knvb_id, currentTeams);
  logVerbose(`Member ${knvb_id}: ${changes.added.length} added, ${changes.removed.length} removed, ${changes.unchanged.length} unchanged`);

  // Fetch existing data from WordPress
  let existingWorkHistory = [];
  let existingFirstName = '';
  let existingLastName = '';
  try {
    const response = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
    existingWorkHistory = response.body.acf?.work_history || [];
    existingFirstName = response.body.acf?.first_name || '';
    existingLastName = response.body.acf?.last_name || '';
  } catch (error) {
    logVerbose(`Could not fetch existing data for ${knvb_id}: ${error.message}`);
  }

  let addedCount = 0;
  let endedCount = 0;
  let updatedCount = 0;
  let modified = false;

  // Build new work_history array
  const newWorkHistory = [...existingWorkHistory];

  // Handle removed teams (only sync-created entries)
  for (const removed of changes.removed) {
    if (removed.stadion_work_history_id !== null && removed.stadion_work_history_id !== undefined) {
      // This is a sync-created entry, we can modify it
      const index = removed.stadion_work_history_id;
      if (index < newWorkHistory.length) {
        newWorkHistory[index] = {
          ...newWorkHistory[index],
          is_current: false,
          end_date: formatDateForACF(new Date())
        };
        endedCount++;
        modified = true;
      }
      // Delete from tracking
      deleteWorkHistory(db, knvb_id, removed.team_name);
      logVerbose(`Ended work_history for team ${removed.team_name} (index ${index})`);
    } else {
      // Manual entry, don't modify but remove from tracking
      deleteWorkHistory(db, knvb_id, removed.team_name);
      logVerbose(`Removed tracking for manual entry: ${removed.team_name}`);
    }
  }

  // Handle added teams
  for (const teamName of changes.added) {
    const teamStadionId = teamMap.get(teamName);
    if (!teamStadionId) {
      logVerbose(`Warning: Team "${teamName}" not found in Stadion, skipping`);
      continue;
    }

    // Check if this is initial sync (backfill) or new team
    const isBackfill = !getMemberWorkHistory(db, knvb_id).some(h => h.last_synced_at);
    const entry = buildWorkHistoryEntry(teamStadionId, isBackfill, jobTitle);
    const newIndex = newWorkHistory.length;
    newWorkHistory.push(entry);

    // Update tracking with stadion_work_history_id
    const sourceHash = require('./lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
    updateWorkHistorySyncState(db, knvb_id, teamName, sourceHash, newIndex);

    addedCount++;
    modified = true;
    logVerbose(`Added work_history for team ${teamName} (index ${newIndex})`);
  }

  // Handle unchanged teams when force is true (update or create)
  if (force) {
    const trackedHistory = getMemberWorkHistory(db, knvb_id);
    for (const teamName of changes.unchanged) {
      const teamStadionId = teamMap.get(teamName);
      if (!teamStadionId) {
        logVerbose(`Warning: Team "${teamName}" not found in Stadion, skipping`);
        continue;
      }

      const tracked = trackedHistory.find(h => h.team_name === teamName);

      if (tracked && tracked.stadion_work_history_id !== null && tracked.stadion_work_history_id !== undefined) {
        // We have a tracked index - update that entry
        const index = tracked.stadion_work_history_id;
        if (index < newWorkHistory.length) {
          newWorkHistory[index] = {
            ...newWorkHistory[index],
            job_title: jobTitle,
            company: [teamStadionId]
          };
          updatedCount++;
          modified = true;
          logVerbose(`Updated work_history for team ${teamName} (index ${index}) with job_title: ${jobTitle}`);
        }
      } else {
        // No tracked index - find existing entry by team or create new
        const existingIndex = newWorkHistory.findIndex(e =>
          e.company && (e.company === teamStadionId || (Array.isArray(e.company) && e.company.includes(teamStadionId)))
        );
        if (existingIndex >= 0) {
          // Update existing WordPress entry
          newWorkHistory[existingIndex] = {
            ...newWorkHistory[existingIndex],
            job_title: jobTitle
          };
          // Update tracking with the found index
          const sourceHash = require('./lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
          updateWorkHistorySyncState(db, knvb_id, teamName, sourceHash, existingIndex);
          updatedCount++;
          modified = true;
          logVerbose(`Updated existing work_history for team ${teamName} (index ${existingIndex}) with job_title: ${jobTitle}`);
        } else {
          // Create new entry
          const isBackfill = !trackedHistory.some(h => h.last_synced_at);
          const entry = buildWorkHistoryEntry(teamStadionId, isBackfill, jobTitle);
          const newIndex = newWorkHistory.length;
          newWorkHistory.push(entry);
          // Update tracking
          const sourceHash = require('./lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
          updateWorkHistorySyncState(db, knvb_id, teamName, sourceHash, newIndex);
          addedCount++;
          modified = true;
          logVerbose(`Created work_history for team ${teamName} (index ${newIndex}) with job_title: ${jobTitle}`);
        }
      }
    }
  }

  // Update WordPress if modified
  if (modified) {
    try {
      await stadionRequest(
        `wp/v2/people/${stadion_id}`,
        'PUT',
        { acf: { first_name: existingFirstName, last_name: existingLastName, work_history: newWorkHistory } },
        options
      );
    } catch (error) {
      logVerbose(`Error updating work_history for ${knvb_id}:`, error.message);
      if (error.details) {
        logVerbose('Error details:', JSON.stringify(error.details, null, 2));
      }
      logVerbose('Payload was:', JSON.stringify(newWorkHistory, null, 2));
      throw error;
    }
    return { action: 'updated', added: addedCount, ended: endedCount, updated: updatedCount };
  }

  return { action: 'unchanged', added: 0, ended: 0, updated: 0 };
}

/**
 * Main sync orchestration for work history.
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all
 * @param {boolean} [options.backfillOnly=false] - Only process members not yet synced
 * @returns {Promise<Object>} - Sync result
 */
async function runSync(options = {}) {
  const { logger, verbose = false, force = false, backfillOnly = false } = options;
  const logVerbose = logger?.verbose.bind(logger) || (verbose ? console.log : () => {});
  const logError = logger?.error.bind(logger) || console.error;

  const result = {
    success: true,
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    ended: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Open databases
    const lapostaDb = openLapostaDb();
    const stadionDb = openDb();

    try {
      // Load Sportlink data
      const resultsJson = getLatestSportlinkResults(lapostaDb);
      if (!resultsJson) {
        const errorMsg = 'No Sportlink results found. Run download first.';
        logError(errorMsg);
        result.success = false;
        result.error = errorMsg;
        return result;
      }

      const sportlinkData = JSON.parse(resultsJson);
      const members = Array.isArray(sportlinkData.Members) ? sportlinkData.Members : [];
      logVerbose(`Found ${members.length} Sportlink members`);

      // Load team mapping
      const teams = getAllTeams(stadionDb);
      const teamMap = new Map(teams.map(t => [t.team_name, t.stadion_id]));
      logVerbose(`Loaded ${teams.length} teams from Stadion`);

      // Build work history records for all members
      const workHistoryRecords = [];
      const memberTeams = new Map(); // Map<knvb_id, { teams: [], jobTitle: string }>

      for (const member of members) {
        const knvbId = member.PublicPersonId;
        if (!knvbId) continue;

        const teams = extractMemberTeams(member);
        if (teams.length === 0) continue;

        const jobTitle = determineJobTitle(member.KernelGameActivities || '');
        memberTeams.set(knvbId, { teams, jobTitle });

        for (const teamName of teams) {
          workHistoryRecords.push({
            knvb_id: knvbId,
            team_name: teamName,
            is_backfill: backfillOnly
          });
        }
      }

      logVerbose(`Extracted ${workHistoryRecords.length} work history records`);

      // Upsert to tracking database
      if (workHistoryRecords.length > 0) {
        upsertWorkHistory(stadionDb, workHistoryRecords);
      }

      // Get members needing sync
      const needsSync = backfillOnly
        ? getWorkHistoryNeedingSync(stadionDb, true)
        : getWorkHistoryNeedingSync(stadionDb, force);

      // Group by knvb_id
      const memberMap = new Map();
      for (const record of needsSync) {
        if (!memberMap.has(record.knvb_id)) {
          memberMap.set(record.knvb_id, {
            knvb_id: record.knvb_id,
            stadion_id: record.stadion_id,
            teams: []
          });
        }
        memberMap.get(record.knvb_id).teams.push(record.team_name);
      }

      const membersToSync = Array.from(memberMap.values());
      result.total = membersToSync.length;
      logVerbose(`${result.total} members need work history sync`);

      // Sync each member
      for (let i = 0; i < membersToSync.length; i++) {
        const member = membersToSync[i];
        const memberData = memberTeams.get(member.knvb_id) || { teams: [], jobTitle: 'Speler' };
        const currentTeams = memberData.teams;
        const jobTitle = memberData.jobTitle;
        logVerbose(`Syncing ${i + 1}/${result.total}: ${member.knvb_id} (${jobTitle})`);

        try {
          const syncResult = await syncWorkHistoryForMember(
            member,
            currentTeams,
            stadionDb,
            teamMap,
            options,
            jobTitle,
            force
          );
          if (syncResult.action === 'updated') {
            result.synced++;
            result.created += syncResult.added;
            result.updated += syncResult.updated;
            result.ended += syncResult.ended;
          } else if (syncResult.action === 'skipped') {
            result.skipped++;
          }
        } catch (error) {
          result.errors.push({
            knvb_id: member.knvb_id,
            message: error.message
          });
        }
      }

      result.success = result.errors.length === 0;
    } finally {
      lapostaDb.close();
      stadionDb.close();
    }

    return result;
  } catch (error) {
    result.success = false;
    result.error = error.message;
    logError(`Work history sync error: ${error.message}`);
    return result;
  }
}

module.exports = { runSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');
  const backfillOnly = process.argv.includes('--backfill-only');

  const options = { verbose, force, backfillOnly };

  runSync(options)
    .then(result => {
      console.log(`Work history sync: ${result.synced}/${result.total} synced`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Ended: ${result.ended}`);
      console.log(`  Skipped: ${result.skipped}`);
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
