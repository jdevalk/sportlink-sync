require('varlock/auto-load');

const { openDb } = require('../lib/stadion-db');

const STADION_URL = process.env.STADION_URL;
const STADION_USERNAME = process.env.STADION_USERNAME;
const STADION_APP_PASSWORD = process.env.STADION_APP_PASSWORD;

async function getAllStadionPeopleIds() {
  const validIds = new Set();
  let page = 1;

  while (true) {
    const auth = Buffer.from(`${STADION_USERNAME}:${STADION_APP_PASSWORD}`).toString('base64');
    const response = await fetch(`${STADION_URL}/wp-json/wp/v2/people?per_page=100&page=${page}`, {
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

  console.log(dryRun ? '=== DRY RUN ===' : '=== VALIDATING STADION IDS ===');
  console.log('');

  // Get all valid person IDs from Stadion
  console.log('Fetching valid person IDs from Stadion...');
  const validIds = await getAllStadionPeopleIds();
  console.log(`Valid Stadion IDs: ${validIds.size}`);
  console.log('');

  // Check tracking DB for invalid stadion_ids
  const db = openDb();

  const members = db.prepare('SELECT knvb_id, stadion_id FROM stadion_members WHERE stadion_id IS NOT NULL').all();
  const invalidMembers = members.filter(m => !validIds.has(m.stadion_id));

  console.log(`Members in tracking DB: ${members.length}`);
  console.log(`Members with invalid stadion_id: ${invalidMembers.length}`);

  if (invalidMembers.length > 0) {
    console.log('');
    console.log('Invalid stadion_ids (first 20):');
    invalidMembers.slice(0, 20).forEach(m => {
      console.log(`  ${m.knvb_id}: stadion_id ${m.stadion_id} not found`);
    });
    if (invalidMembers.length > 20) {
      console.log(`  ... and ${invalidMembers.length - 20} more`);
    }
  }

  if (!dryRun && invalidMembers.length > 0) {
    console.log('');
    console.log('Nullifying invalid stadion_ids...');
    for (const m of invalidMembers) {
      db.prepare('UPDATE stadion_members SET stadion_id = NULL, last_synced_hash = NULL WHERE knvb_id = ?').run(m.knvb_id);
    }
    console.log(`Invalidated ${invalidMembers.length} stale stadion_ids`);
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
