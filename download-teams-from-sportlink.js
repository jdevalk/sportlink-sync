require('varlock/auto-load');

const otplib = require('otplib');
const { chromium } = require('playwright');
const {
  openDb,
  upsertTeamsWithMetadata,
  upsertTeamMembers,
  clearTeamMembers
} = require('./lib/stadion-db');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function createDebugLogger(enabled) {
  return (...args) => {
    if (enabled) {
      console.log(...args);
    }
  };
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

/**
 * Download team data from Sportlink including player/staff roles
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, teamCount: number, memberCount: number, error?: string}>}
 */
async function runTeamDownload(options = {}) {
  const { logger, verbose = false } = options;

  const log = logger ? logger.log.bind(logger) : (verbose ? console.log : () => {});
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});
  const logError = logger ? logger.error.bind(logger) : console.error;

  const username = readEnv('SPORTLINK_USERNAME');
  const password = readEnv('SPORTLINK_PASSWORD');
  const otpSecret = readEnv('SPORTLINK_OTP_SECRET');

  if (!username || !password) {
    const errorMsg = 'Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD';
    logError(errorMsg);
    return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
  }

  const debugEnabled = parseBool(readEnv('DEBUG_LOG', 'false'));
  const logDebug = createDebugLogger(debugEnabled);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
      if (debugEnabled) {
        page.on('request', r => logDebug('>>', r.method(), r.url()));
        page.on('response', r => logDebug('<<', r.status(), r.url()));
      }

      // Login flow
      await page.goto('https://club.sportlink.com/', { waitUntil: 'domcontentloaded' });
      await page.fill('#username', username);
      await page.fill('#password', password);
      await page.click('#kc-login');

      await page.waitForSelector('#otp', { timeout: 20000 });
      if (!otpSecret) {
        const errorMsg = 'Missing SPORTLINK_OTP_SECRET';
        logError(errorMsg);
        return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
      }
      const otpCode = await otplib.generate({ secret: otpSecret });
      if (!otpCode) {
        const errorMsg = 'OTP is required to continue';
        logError(errorMsg);
        return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
      }
      await page.fill('#otp', otpCode);
      await page.click('#kc-login');

      await page.waitForLoadState('networkidle');

      logDebug('Waiting for login success selector: #panelHeaderTasks');
      try {
        await page.waitForSelector('#panelHeaderTasks', { timeout: 30000 });
      } catch (error) {
        const errorMsg = 'Login failed: Could not find dashboard element';
        logError(errorMsg);
        return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
      }

      // Step 1: Navigate to union teams page and capture teams list
      logVerbose('Fetching union teams list...');

      const teamsResponsePromise = page.waitForResponse(
        resp => resp.url().includes('/navajo/entity/common/clubweb/team/UnionTeams') &&
                !resp.url().includes('Players') &&
                !resp.url().includes('NonPlayers') &&
                resp.request().method() === 'GET',
        { timeout: 60000 }
      );

      await page.goto('https://club.sportlink.com/teams/union-teams', { waitUntil: 'domcontentloaded' });

      const teamsResponse = await teamsResponsePromise;
      if (!teamsResponse.ok()) {
        const errorMsg = `Teams request failed (${teamsResponse.status()})`;
        logError(errorMsg);
        return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
      }

      const teamsData = await teamsResponse.json();
      const teams = Array.isArray(teamsData.Team) ? teamsData.Team : [];
      logVerbose(`Found ${teams.length} teams`);

      if (teams.length === 0) {
        log('No teams found');
        return { success: true, teamCount: 0, memberCount: 0 };
      }

      // Prepare team records with metadata
      const teamRecords = teams.map(team => ({
        team_name: team.TeamName || team.Name || '',
        sportlink_id: team.PublicTeamId || '',
        game_activity: team.GameActivityDescription || '',
        gender: team.Gender || '',
        player_count: 0,
        staff_count: 0
      })).filter(t => t.team_name && t.sportlink_id);

      // Step 2: Fetch players and staff for each team
      const allMembers = [];
      let totalMemberCount = 0;

      for (let i = 0; i < teamRecords.length; i++) {
        const team = teamRecords[i];
        logVerbose(`Fetching members for team ${i + 1}/${teamRecords.length}: ${team.team_name}`);

        // Navigate to team details/members page
        const teamMembersUrl = `https://club.sportlink.com/teams/team-details/${team.sportlink_id}/members`;

        // Set up listeners for both players and non-players responses
        const playersResponsePromise = page.waitForResponse(
          resp => resp.url().includes('/navajo/entity/common/clubweb/team/UnionTeamPlayers') &&
                  resp.request().method() === 'POST',
          { timeout: 10000 }
        ).catch(() => null);

        const nonPlayersResponsePromise = page.waitForResponse(
          resp => resp.url().includes('/navajo/entity/common/clubweb/team/UnionTeamNonPlayers') &&
                  resp.request().method() === 'POST',
          { timeout: 10000 }
        ).catch(() => null);

        await page.goto(teamMembersUrl, { waitUntil: 'commit' });

        // Process players response
        const playersResponse = await playersResponsePromise;
        if (playersResponse && playersResponse.ok()) {
          try {
            const playersData = await playersResponse.json();
            const players = Array.isArray(playersData.Person) ? playersData.Person : [];
            logDebug(`  Found ${players.length} players`);

            for (const player of players) {
              const personId = player.PublicPersonId;
              if (!personId) continue;

              allMembers.push({
                sportlink_team_id: team.sportlink_id,
                sportlink_person_id: personId,
                member_type: 'player',
                role_description: player.RoleDescription || 'Speler'
              });
            }
            team.player_count = players.length;
            totalMemberCount += players.length;
          } catch (err) {
            logDebug(`  Error parsing players: ${err.message}`);
          }
        }

        // Process non-players (staff) response
        const nonPlayersResponse = await nonPlayersResponsePromise;
        if (nonPlayersResponse && nonPlayersResponse.ok()) {
          try {
            const nonPlayersData = await nonPlayersResponse.json();
            const staff = Array.isArray(nonPlayersData.Person) ? nonPlayersData.Person : [];
            logDebug(`  Found ${staff.length} staff members`);

            for (const person of staff) {
              const personId = person.PublicPersonId;
              if (!personId) continue;

              allMembers.push({
                sportlink_team_id: team.sportlink_id,
                sportlink_person_id: personId,
                member_type: 'staff',
                role_description: person.FunctionDescription || 'Staflid'
              });
            }
            team.staff_count = staff.length;
            totalMemberCount += staff.length;
          } catch (err) {
            logDebug(`  Error parsing staff: ${err.message}`);
          }
        }

      }

      // Step 3: Store to database
      const db = openDb();
      try {
        // Clear existing team members and insert fresh data
        clearTeamMembers(db);

        // Upsert teams with metadata
        if (teamRecords.length > 0) {
          upsertTeamsWithMetadata(db, teamRecords);
        }

        // Upsert team members
        if (allMembers.length > 0) {
          upsertTeamMembers(db, allMembers);
        }
      } finally {
        db.close();
      }

      log(`Downloaded ${teamRecords.length} teams with ${totalMemberCount} team members from Sportlink`);
      return { success: true, teamCount: teamRecords.length, memberCount: totalMemberCount };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error:', errorMsg);
    return { success: false, teamCount: 0, memberCount: 0, error: errorMsg };
  }
}

module.exports = { runTeamDownload };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runTeamDownload({ verbose })
    .then(result => {
      if (result.success) {
        console.log(`Success: ${result.teamCount} teams, ${result.memberCount} team members`);
      } else {
        console.error('Failed:', result.error);
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
