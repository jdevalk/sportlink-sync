require('varlock/auto-load');

const { openDb, getLatestSportlinkResults } = require('./laposta-db');

/**
 * Extract team name from member record
 * Priority: UnionTeams first, ClubTeams fallback
 * @param {Object} member - Sportlink member record
 * @returns {string|null} - Team name or null
 */
function extractTeamName(member) {
  // Priority: UnionTeams first, ClubTeams fallback
  const unionTeam = (member.UnionTeams || '').trim();
  if (unionTeam) return unionTeam;

  const clubTeam = (member.ClubTeams || '').trim();
  return clubTeam || null;
}

/**
 * Prepare Stadion teams from Sportlink data
 * Extracts unique team names from UnionTeams/ClubTeams fields
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, teams: Array<string>, skipped: number, error?: string}>}
 */
async function runPrepare(options = {}) {
  const { logger, verbose = false } = options;

  // Use provided logger or create simple fallback
  const log = logger ? logger.log.bind(logger) : console.log;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});
  const logError = logger ? logger.error.bind(logger) : console.error;

  try {
    // Load Sportlink data from SQLite
    const db = openDb();
    let sportlinkData;
    try {
      const resultsJson = getLatestSportlinkResults(db);
      if (!resultsJson) {
        const errorMsg = 'No Sportlink results found in SQLite. Run the download first.';
        logError(errorMsg);
        return { success: false, teams: [], skipped: 0, error: errorMsg };
      }
      sportlinkData = JSON.parse(resultsJson);
    } finally {
      db.close();
    }

    const members = Array.isArray(sportlinkData.Members) ? sportlinkData.Members : [];
    logVerbose(`Found ${members.length} Sportlink members in database`);

    // Extract unique team names
    const teamSet = new Set();
    let skippedCount = 0;

    members.forEach((member, index) => {
      const teamName = extractTeamName(member);
      if (teamName) {
        teamSet.add(teamName);
      } else {
        skippedCount++;
      }
    });

    // Convert to sorted array for consistent processing
    const teams = Array.from(teamSet).sort();

    logVerbose(`Extracted ${teams.length} unique teams from Sportlink data (${skippedCount} members without teams)`);

    if (verbose && teams.length > 0) {
      logVerbose('Sample teams:');
      teams.slice(0, 5).forEach(team => logVerbose(`  - ${team}`));
      if (teams.length > 5) {
        logVerbose(`  ... and ${teams.length - 5} more`);
      }
    }

    return {
      success: true,
      teams: teams,
      skipped: skippedCount
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error preparing Stadion teams:', errorMsg);
    return { success: false, teams: [], skipped: 0, error: errorMsg };
  }
}

module.exports = { runPrepare };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');

  runPrepare({ verbose })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      } else if (!verbose) {
        // In default mode, print summary
        console.log(`Extracted ${result.teams.length} unique teams from Sportlink data (${result.skipped} members without teams)`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
