require('dotenv/config');

const { openDb } = require('../lib/rondo-club-db');

const RONDO_URL = process.env.RONDO_URL;
const RONDO_USERNAME = process.env.RONDO_USERNAME;
const RONDO_APP_PASSWORD = process.env.RONDO_APP_PASSWORD;

async function getAllRondoClubPeopleIds() {
  const validIds = new Set();
  let page = 1;

  while (true) {
    const auth = Buffer.from(`${RONDO_USERNAME}:${RONDO_APP_PASSWORD}`).toString('base64');
    const response = await fetch(`${RONDO_URL}/wp-json/wp/v2/people?per_page=100&page=${page}`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch people: ${response.status}`);
    }

    const batch = await response.json();
    if (batch.length === 0) break;

    batch.forEach(p => validIds.add(p.id));
    console.log(`  Page ${page}: ${validIds.size} total IDs`);

    if (batch.length < 100) break;
    page++;
  }

  return validIds;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(dryRun ? '=== DRY RUN ===' : '=== VALIDATING RONDO CLUB IDS ===');
  console.log('');

  // Get all valid person IDs from Rondo Club
  console.log('Fetching valid person IDs from Rondo Club...');
  const validIds = await getAllRondoClubPeopleIds();
  console.log(`Valid Rondo Club IDs: ${validIds.size}`);
  console.log('');

  // Check tracking DB for invalid rondo_club_ids
  const db = openDb();

  const members = db.prepare('SELECT knvb_id, rondo_club_id FROM rondo_club_members WHERE rondo_club_id IS NOT NULL').all();
  const invalidMembers = members.filter(m => !validIds.has(m.rondo_club_id));

  console.log(`Members in tracking DB: ${members.length}`);
  console.log(`Members with invalid rondo_club_id: ${invalidMembers.length}`);

  if (invalidMembers.length > 0) {
    console.log('');
    console.log('Invalid rondo_club_ids (first 20):');
    invalidMembers.slice(0, 20).forEach(m => {
      console.log(`  ${m.knvb_id}: rondo_club_id ${m.rondo_club_id} not found`);
    });
    if (invalidMembers.length > 20) {
      console.log(`  ... and ${invalidMembers.length - 20} more`);
    }
  }

  if (!dryRun && invalidMembers.length > 0) {
    console.log('');
    console.log('Nullifying invalid rondo_club_ids...');
    for (const m of invalidMembers) {
      db.prepare('UPDATE rondo_club_members SET rondo_club_id = NULL, last_synced_hash = NULL WHERE knvb_id = ?').run(m.knvb_id);
    }
    console.log(`Invalidated ${invalidMembers.length} stale rondo_club_ids`);
  }

  db.close();

  if (dryRun && invalidMembers.length > 0) {
    console.log('');
    console.log('Run without --dry-run to fix these issues.');
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
