require('varlock/auto-load');

const fs = require('fs');
const path = require('path');
const { runDownloadInactive } = require('../steps/download-inactive-members');
const { preparePerson, isValidMember } = require('../steps/prepare-rondo-club-members');
const { rondoClubRequest } = require('../lib/rondo-club-client');
const { openDb, getAllTrackedMembers, upsertMembers, updateSyncState, computeSourceHash } = require('../lib/rondo-club-db');

const FORMER_MEMBERS_CACHE = path.join(process.cwd(), 'data', 'former-members.json');

/**
 * Import former members from Sportlink to Rondo Club
 * @param {Object} options
 * @param {boolean} [options.dryRun=true] - Dry run mode (default)
 * @param {boolean} [options.verbose=false] - Verbose output
 * @param {boolean} [options.skipDownload=false] - Skip download, use cached data
 * @returns {Promise<{downloaded: number, toSync: number, synced: number, skippedActive: number, skippedFormer: number, failed: number, errors: Array}>}
 */
async function runImport(options = {}) {
  const { dryRun = true, verbose = false, skipDownload = false } = options;

  console.log(dryRun ? '=== DRY RUN ===' : '=== IMPORTING FORMER MEMBERS ===');
  console.log('');

  const stats = {
    downloaded: 0,
    toSync: 0,
    synced: 0,
    skippedActive: 0,
    skippedFormer: 0,
    failed: 0,
    errors: []
  };

  // Step 1: Download inactive members
  let inactiveMembers = [];

  if (skipDownload) {
    if (verbose) console.log('Skipping download, loading from cache...');
    try {
      const cachedData = JSON.parse(fs.readFileSync(FORMER_MEMBERS_CACHE, 'utf8'));
      inactiveMembers = cachedData.members || [];
      stats.downloaded = inactiveMembers.length;
      console.log(`Loaded ${stats.downloaded} inactive members from cache`);
    } catch (err) {
      console.error(`Error reading cache file: ${err.message}`);
      console.error('Run without --skip-download to fetch fresh data.');
      return stats;
    }
  } else {
    if (verbose) console.log('Downloading inactive members from Sportlink...');
    const downloadResult = await runDownloadInactive({ verbose });

    if (!downloadResult.success) {
      console.error(`Download failed: ${downloadResult.error}`);
      return stats;
    }

    inactiveMembers = downloadResult.members || [];
    stats.downloaded = inactiveMembers.length;
    console.log(`Downloaded ${stats.downloaded} inactive members from Sportlink`);

    // Cache the results
    try {
      fs.writeFileSync(FORMER_MEMBERS_CACHE, JSON.stringify({ members: inactiveMembers }, null, 2));
      if (verbose) console.log(`Cached results to ${FORMER_MEMBERS_CACHE}`);
    } catch (err) {
      console.error(`Warning: Could not cache results: ${err.message}`);
    }
  }

  console.log('');

  // Step 2: Prepare and filter members
  if (verbose) console.log('Preparing and filtering members...');

  const db = openDb();
  let trackedMembers;
  try {
    trackedMembers = getAllTrackedMembers(db);
  } finally {
    db.close();
  }

  // Create a map of tracked members by KNVB ID
  const trackedByKnvbId = new Map();
  trackedMembers.forEach(m => {
    trackedByKnvbId.set(m.knvb_id, m);
  });

  const toSync = [];
  let invalidCount = 0;

  for (const member of inactiveMembers) {
    // Validate member has required fields
    if (!isValidMember(member)) {
      invalidCount++;
      if (verbose) {
        const reason = !member.PublicPersonId ? 'missing KNVB ID' : 'missing first name';
        console.log(`  Skipping invalid member: ${reason}`);
      }
      continue;
    }

    const knvbId = member.PublicPersonId;
    const tracked = trackedByKnvbId.get(knvbId);

    // Skip if member already exists in database with a stadion_id and has been synced
    if (tracked && tracked.stadion_id && tracked.last_synced_hash) {
      stats.skippedFormer++;
      if (verbose) console.log(`  Skipping ${knvbId}: already synced as former or active member`);
      continue;
    }

    // Prepare person data using shared preparePerson function
    const prepared = preparePerson(member);

    // Override former_member flag to true (preparePerson sets it to false for active members)
    prepared.data.acf.former_member = true;

    toSync.push({
      knvb_id: knvbId,
      prepared: prepared
    });
  }

  stats.toSync = toSync.length;

  console.log(`${stats.toSync} former members to sync`);
  console.log(`${stats.skippedFormer} already exist (active or former)`);
  console.log(`${invalidCount} invalid (missing KNVB ID or first name)`);
  console.log('');

  // Step 3: Sync to Rondo Club
  if (dryRun) {
    console.log('=== DRY RUN COMPLETE ===');
    console.log('Run with --import to actually sync these members.');
    return stats;
  }

  console.log('Syncing former members to Rondo Club...');
  console.log('');

  const dbForSync = openDb();
  try {
    for (let i = 0; i < toSync.length; i++) {
      const { knvb_id, prepared } = toSync[i];

      try {
        // POST to create new person
        const response = await rondoClubRequest('wp/v2/people', 'POST', prepared.data, { verbose });

        if (response.status >= 200 && response.status < 300) {
          const stadionId = response.body.id;
          const sourceHash = computeSourceHash(knvb_id, prepared.data);

          // Track in stadion_members table
          upsertMembers(dbForSync, [{
            knvb_id: knvb_id,
            email: prepared.email,
            data_json: JSON.stringify(prepared.data),
            source_hash: sourceHash,
            person_image_date: prepared.person_image_date,
            last_seen_at: new Date().toISOString()
          }]);

          // Update sync state with stadion_id
          updateSyncState(dbForSync, knvb_id, sourceHash, stadionId);

          stats.synced++;
          if (verbose) console.log(`  ✓ Synced ${knvb_id} → Rondo Club post ${stadionId}`);
        } else {
          stats.failed++;
          const errorMsg = `${response.status} ${JSON.stringify(response.body)}`;
          stats.errors.push({ knvb_id, error: errorMsg });
          console.error(`  ✗ Failed ${knvb_id}: ${errorMsg}`);
        }

        // Progress logging every 10 members
        if ((i + 1) % 10 === 0) {
          console.log(`Progress: ${i + 1}/${toSync.length} (${stats.synced} synced, ${stats.failed} failed)`);
        }

        // Rate limit: 2 second delay between requests
        if (i < toSync.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        stats.failed++;
        const errorMsg = err.message || String(err);
        stats.errors.push({ knvb_id, error: errorMsg });
        console.error(`  ✗ Failed ${knvb_id}: ${errorMsg}`);
      }
    }
  } finally {
    dbForSync.close();
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Downloaded: ${stats.downloaded}`);
  console.log(`To sync: ${stats.toSync}`);
  console.log(`Skipped (already exists): ${stats.skippedFormer}`);
  console.log(`Synced: ${stats.synced}`);
  console.log(`Failed: ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    stats.errors.forEach(({ knvb_id, error }) => {
      console.log(`  - ${knvb_id}: ${error}`);
    });
  }

  return stats;
}

module.exports = { runImport };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--import');
  const verbose = args.includes('--verbose');
  const skipDownload = args.includes('--skip-download');

  runImport({ dryRun, verbose, skipDownload })
    .then(result => {
      if (result.failed > 0) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
