require('varlock/auto-load');

const { stadionRequest } = require('../lib/stadion-client');
const { openDb: openLapostaDb, getLatestSportlinkResults } = require('../lib/laposta-db');
const {
  openDb,
  getAllTeams,
  upsertWorkHistory,
  getWorkHistoryNeedingSync,
  getMemberWorkHistory,
  updateWorkHistorySyncState,
  deleteWorkHistory,
  getTeamMemberRole
} = require('../lib/stadion-db');

/**
 * Check if a team name is valid
 * @param {string} teamName - Team name to validate
 * @returns {boolean} - True if valid team name
 */
function isValidTeamName(teamName) {
  if (!teamName) return false;
  return true;
}

/**
 * Look up team stadion_id by team code.
 * SearchMembers returns team codes (e.g. "JO17-1") which match the TeamCode
 * field from the teams download.
 * @param {string} teamCode - Team code to look up
 * @param {Map} teamMap - Map<team_code, stadion_id>
 * @returns {number|undefined} - Stadion ID or undefined if not found
 */
function lookupTeamStadionId(teamCode, teamMap) {
  return teamMap.get(teamCode);
}

/**
 * Extract teams for a member from Sportlink data.
 * Priority: UnionTeams first, ClubTeams fallback.
 * Splits comma-separated values and filters invalid names.
 * Returns array of team names (member can be in multiple teams).
 * @param {Object} sportlinkMember - Sportlink member record
 * @returns {Array<string>} - Team names
 */
function extractMemberTeams(sportlinkMember) {
  const teamSet = new Set();

  // UnionTeams (priority)
  const unionTeam = (sportlinkMember.UnionTeams || '').trim();
  if (unionTeam) {
    // Split comma-separated and filter invalid
    unionTeam.split(',').map(t => t.trim()).filter(isValidTeamName).forEach(t => teamSet.add(t));
  }

  // ClubTeams (additional, not fallback - member can be in both)
  const clubTeam = (sportlinkMember.ClubTeams || '').trim();
  if (clubTeam) {
    clubTeam.split(',').map(t => t.trim()).filter(isValidTeamName).forEach(t => teamSet.add(t));
  }

  return Array.from(teamSet);
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
 * Determine job title based on KernelGameActivities (fallback only).
 * @param {string} kernelGameActivities - Value from Sportlink
 * @returns {string} - 'Speler' or 'Staflid'
 */
function determineJobTitleFallback(kernelGameActivities) {
  return kernelGameActivities === 'Veld -  Algemeen' ? 'Speler' : 'Staflid';
}

/**
 * Get job title for a team assignment.
 * First looks up role from sportlink_team_members table, falls back to KernelGameActivities.
 * @param {Object} db - Stadion database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string} teamName - Team name to lookup role for
 * @param {string} fallbackKernelGameActivities - Fallback value from Sportlink
 * @returns {string} - Role description or 'Speler'/'Staflid'
 */
function getJobTitleForTeam(db, knvbId, teamName, fallbackKernelGameActivities) {
  // Try to get role from team members table
  const roleFromTeam = getTeamMemberRole(db, knvbId, teamName);
  if (roleFromTeam) {
    return roleFromTeam;
  }
  // Fallback for members not in team data
  return determineJobTitleFallback(fallbackKernelGameActivities);
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
    team: teamStadionId
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

  // Build map of tracked team names with their sync status
  const trackedTeamMap = new Map(trackedTeams.map(t => [t.team_name, t.stadion_work_history_id]));
  const currentTeamSet = new Set(currentTeams);

  // Teams that need to be added:
  // 1. Not in tracked teams at all
  // 2. In tracked teams but stadion_work_history_id is NULL (never synced to WordPress)
  const added = currentTeams.filter(t => {
    if (!trackedTeamMap.has(t)) {
      return true; // Not tracked at all
    }
    const stadionWorkHistoryId = trackedTeamMap.get(t);
    return stadionWorkHistoryId === null || stadionWorkHistoryId === undefined; // Tracked but never synced
  });

  const removed = trackedTeams.filter(t => !currentTeamSet.has(t.team_name));

  // Only teams that are both tracked AND have a stadion_work_history_id are truly unchanged
  const unchanged = currentTeams.filter(t => {
    if (!trackedTeamMap.has(t)) {
      return false; // Not tracked
    }
    const stadionWorkHistoryId = trackedTeamMap.get(t);
    return stadionWorkHistoryId !== null && stadionWorkHistoryId !== undefined; // Tracked and synced
  });

  return { added, removed, unchanged };
}

/**
 * Sync work history for a single member.
 * Detects team changes and updates WordPress work_history ACF field.
 * @param {Object} member - Member with KNVB ID and current teams
 * @param {Array<string>} currentTeams - Current team names
 * @param {Object} db - Stadion SQLite database
 * @param {Map} teamMap - Map<team_code, stadion_id>
 * @param {Object} options - Logger and verbose options
 * @param {string} fallbackKernelGameActivities - Fallback KernelGameActivities for job title
 * @param {boolean} force - Force update even unchanged entries
 * @returns {Promise<{action: string, added: number, ended: number, updated: number}>}
 */
async function syncWorkHistoryForMember(member, currentTeams, db, teamMap, options, fallbackKernelGameActivities = '', force = false) {
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
    const teamStadionId = lookupTeamStadionId(teamName, teamMap);
    if (!teamStadionId) {
      logVerbose(`Warning: Team "${teamName}" not found in Stadion, skipping`);
      continue;
    }

    // Check if this is initial sync (backfill) or new team
    const isBackfill = !getMemberWorkHistory(db, knvb_id).some(h => h.last_synced_at);
    const jobTitle = getJobTitleForTeam(db, knvb_id, teamName, fallbackKernelGameActivities);
    const entry = buildWorkHistoryEntry(teamStadionId, isBackfill, jobTitle);
    logVerbose(`  Using job title: ${jobTitle} for team ${teamName}`);
    const newIndex = newWorkHistory.length;
    newWorkHistory.push(entry);

    // Update tracking with stadion_work_history_id
    const sourceHash = require('../lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
    updateWorkHistorySyncState(db, knvb_id, teamName, sourceHash, newIndex);

    addedCount++;
    modified = true;
    logVerbose(`Added work_history for team ${teamName} (index ${newIndex})`);
  }

  // Handle unchanged teams when force is true (update or create)
  if (force) {
    const trackedHistory = getMemberWorkHistory(db, knvb_id);
    for (const teamName of changes.unchanged) {
      const teamStadionId = lookupTeamStadionId(teamName, teamMap);
      if (!teamStadionId) {
        logVerbose(`Warning: Team "${teamName}" not found in Stadion, skipping`);
        continue;
      }

      const jobTitle = getJobTitleForTeam(db, knvb_id, teamName, fallbackKernelGameActivities);
      const tracked = trackedHistory.find(h => h.team_name === teamName);

      if (tracked && tracked.stadion_work_history_id !== null && tracked.stadion_work_history_id !== undefined) {
        // We have a tracked index - update that entry
        const index = tracked.stadion_work_history_id;
        if (index < newWorkHistory.length) {
          newWorkHistory[index] = {
            ...newWorkHistory[index],
            job_title: jobTitle,
            team: teamStadionId
          };
          updatedCount++;
          modified = true;
          logVerbose(`Updated work_history for team ${teamName} (index ${index}) with job_title: ${jobTitle}`);
        }
      } else {
        // No tracked index - find existing entry by team or create new
        const existingIndex = newWorkHistory.findIndex(e => e.team === teamStadionId);
        if (existingIndex >= 0) {
          // Update existing WordPress entry
          newWorkHistory[existingIndex] = {
            ...newWorkHistory[existingIndex],
            job_title: jobTitle
          };
          // Update tracking with the found index
          const sourceHash = require('../lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
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
          const sourceHash = require('../lib/stadion-db').computeWorkHistoryHash(knvb_id, teamName);
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

      // Load team mapping: team_code -> stadion_id
      // SearchMembers returns team codes (e.g. "JO17-1") which match TeamCode from the teams download
      const teams = getAllTeams(stadionDb);
      const teamMap = new Map(teams.filter(t => t.team_code).map(t => [t.team_code, t.stadion_id]));
      logVerbose(`Loaded ${teams.length} teams from Stadion (${teamMap.size} with team codes)`);

      // Build work history records for all members
      const workHistoryRecords = [];
      const memberTeams = new Map(); // Map<knvb_id, { teams: [], kernelGameActivities: string }>

      for (const member of members) {
        const knvbId = member.PublicPersonId;
        if (!knvbId) continue;

        const teams = extractMemberTeams(member);
        if (teams.length === 0) continue;

        const kernelGameActivities = member.KernelGameActivities || '';
        memberTeams.set(knvbId, { teams, kernelGameActivities });

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
        const memberData = memberTeams.get(member.knvb_id) || { teams: [], kernelGameActivities: '' };
        const currentTeams = memberData.teams;
        const kernelGameActivities = memberData.kernelGameActivities;
        logVerbose(`Syncing ${i + 1}/${result.total}: ${member.knvb_id}`);

        try {
          const syncResult = await syncWorkHistoryForMember(
            member,
            currentTeams,
            stadionDb,
            teamMap,
            options,
            kernelGameActivities,
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
