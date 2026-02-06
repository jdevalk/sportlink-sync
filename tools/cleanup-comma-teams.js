require('varlock/auto-load');

const { rondoClubRequest } = require('../lib/stadion-client');

/**
 * Delete teams that have commas in their names (bad sync data)
 */
async function cleanupCommaTeams() {
  const verbose = process.argv.includes('--verbose');
  const dryRun = process.argv.includes('--dry-run');

  console.log('Fetching teams from Rondo Club...');

  // Fetch all teams (paginate if needed)
  let allTeams = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await rondoClubRequest(
      `wp/v2/teams?per_page=100&page=${page}`,
      'GET',
      null,
      { verbose }
    );

    const teams = response.body;
    if (teams.length === 0) {
      hasMore = false;
    } else {
      allTeams = allTeams.concat(teams);
      page++;
      if (teams.length < 100) hasMore = false;
    }
  }

  console.log(`Found ${allTeams.length} total teams`);

  // Find teams with commas in their name
  const commaTeams = allTeams.filter(team => {
    const title = team.title?.rendered || team.title || '';
    return title.includes(',');
  });

  if (commaTeams.length === 0) {
    console.log('No teams with commas found. Nothing to delete.');
    return;
  }

  console.log(`\nFound ${commaTeams.length} teams with commas:`);
  commaTeams.forEach(team => {
    const title = team.title?.rendered || team.title || '';
    console.log(`  - [${team.id}] "${title}"`);
  });

  if (dryRun) {
    console.log('\n--dry-run mode: No changes made.');
    return;
  }

  console.log('\nDeleting teams with commas...');

  let deleted = 0;
  let errors = 0;

  for (const team of commaTeams) {
    const title = team.title?.rendered || team.title || '';
    try {
      await rondoClubRequest(
        `wp/v2/teams/${team.id}?force=true`,
        'DELETE',
        null,
        { verbose }
      );
      console.log(`  Deleted: [${team.id}] "${title}"`);
      deleted++;
    } catch (error) {
      console.error(`  Error deleting [${team.id}] "${title}": ${error.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Errors: ${errors}`);
}

cleanupCommaTeams()
  .catch(err => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  });
