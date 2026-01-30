#!/usr/bin/env node
require('varlock/auto-load');

const { openDb: openLapostaDb, getLatestSportlinkResults } = require('./laposta-db');
const { openDb: openStadionDb, getMemberFreeFieldsByKnvbId, upsertMembers, getMembersNeedingSync, updateSyncState } = require('./lib/stadion-db');
const { preparePerson } = require('./prepare-stadion-members');
const { stadionRequest } = require('./lib/stadion-client');
const { resolveFieldConflicts } = require('./lib/conflict-resolver');
const { TRACKED_FIELDS } = require('./lib/sync-origin');
const { extractFieldValue } = require('./lib/detect-stadion-changes');

/**
 * Extract tracked field values from member data
 */
function extractTrackedFieldValues(data) {
  const values = {};
  for (const field of TRACKED_FIELDS) {
    values[field] = extractFieldValue(data, field);
  }
  return values;
}

/**
 * Apply conflict resolutions to update payload
 */
function applyResolutions(originalData, resolutions) {
  const resolvedData = JSON.parse(JSON.stringify(originalData));
  if (!resolvedData.acf) resolvedData.acf = {};

  for (const [field, resolution] of resolutions.entries()) {
    const value = resolution.value;
    if (['email', 'email2', 'mobile', 'phone'].includes(field)) {
      if (!resolvedData.acf.contact_info) resolvedData.acf.contact_info = [];
      const contactInfo = resolvedData.acf.contact_info;
      const existing = contactInfo.findIndex(c => c.contact_type === field);
      if (existing >= 0) {
        contactInfo[existing].contact_value = value;
      } else if (value !== null) {
        contactInfo.push({ contact_type: field, contact_value: value });
      }
    } else {
      const acfFieldName = field.replace(/_/g, '-');
      resolvedData.acf[acfFieldName] = value;
    }
  }
  return resolvedData;
}

/**
 * Sync a single person by KNVB ID
 */
async function syncIndividual(knvbId, options = {}) {
  const { verbose = false, force = false, dryRun = false } = options;
  const log = verbose ? console.log : () => {};

  // Open databases
  const lapostaDb = openLapostaDb();
  const stadionDb = openStadionDb();

  try {
    // Get latest Sportlink data
    const resultsJson = getLatestSportlinkResults(lapostaDb);
    if (!resultsJson) {
      console.error('No Sportlink data found. Run download-data-from-sportlink.js first.');
      return { success: false, error: 'No Sportlink data' };
    }

    const members = JSON.parse(resultsJson);
    log(`Found ${members.length} members in Sportlink data`);

    // Find the specific member
    const member = members.find(m => m.MemberId === knvbId);
    if (!member) {
      console.error(`Member with KNVB ID "${knvbId}" not found in Sportlink data`);
      return { success: false, error: 'Member not found' };
    }

    log(`Found member: ${member.FirstName} ${member.Infix || ''} ${member.LastName}`);

    // Get free fields for this member
    const freeFields = getMemberFreeFieldsByKnvbId(stadionDb, knvbId);
    log(`Free fields: ${JSON.stringify(freeFields)}`);

    // Prepare the person data
    const prepared = preparePerson(member, freeFields);
    log(`Prepared data for ${prepared.knvb_id}`);

    // Upsert to tracking database to get current state
    upsertMembers(stadionDb, [prepared]);

    // Get member with stadion_id from database
    const [trackedMember] = getMembersNeedingSync(stadionDb, force);
    const memberToSync = trackedMember?.knvb_id === knvbId ? trackedMember : null;

    if (!memberToSync && !force) {
      console.log(`Member ${knvbId} is already up to date (no changes detected)`);
      console.log('Use --force to sync anyway');
      return { success: true, action: 'skipped', reason: 'no changes' };
    }

    // Get stadion_id from database directly if not forcing
    const stmt = stadionDb.prepare('SELECT stadion_id FROM stadion_members WHERE knvb_id = ?');
    const row = stmt.get(knvbId);
    const stadionId = row?.stadion_id;

    log(`Stadion ID: ${stadionId || 'none (will create)'}`);

    if (dryRun) {
      console.log('\n=== DRY RUN - No changes will be made ===');
      console.log(`KNVB ID: ${knvbId}`);
      console.log(`Stadion ID: ${stadionId || '(will create new)'}`);
      console.log(`Name: ${prepared.data.acf.first_name} ${prepared.data.acf.last_name}`);
      console.log(`Email: ${prepared.email || 'none'}`);
      console.log('\nData to sync:');
      console.log(JSON.stringify(prepared.data, null, 2));
      return { success: true, action: 'dry-run' };
    }

    // Perform the sync
    if (stadionId) {
      // UPDATE existing person
      log(`Updating existing person: ${stadionId}`);

      // Get existing person for conflict resolution
      let existingData = null;
      try {
        const existing = await stadionRequest(`wp/v2/people/${stadionId}`, 'GET', null, { verbose });
        existingData = existing.body;
      } catch (e) {
        if (e.message?.includes('404')) {
          console.log(`Person ${stadionId} no longer exists in Stadion - will create new`);
          // Fall through to create
        } else {
          throw e;
        }
      }

      if (existingData) {
        // Resolve conflicts
        let updateData = prepared.data;
        const sportlinkData = extractTrackedFieldValues(prepared.data);
        const stadionData = extractTrackedFieldValues(existingData);

        const resolution = resolveFieldConflicts(
          { knvb_id: knvbId, source_hash: prepared.source_hash },
          sportlinkData,
          stadionData,
          stadionDb
        );

        if (resolution.conflicts.length > 0) {
          console.log(`Resolved ${resolution.conflicts.length} conflict(s):`);
          resolution.conflicts.forEach(c => {
            console.log(`  - ${c.field}: ${c.winner} wins (${c.reason})`);
          });
          updateData = applyResolutions(prepared.data, resolution.resolutions);
        }

        await stadionRequest(`wp/v2/people/${stadionId}`, 'PUT', updateData, { verbose });
        updateSyncState(stadionDb, knvbId, prepared.source_hash, stadionId);

        console.log(`Updated person ${stadionId} (${prepared.data.acf.first_name} ${prepared.data.acf.last_name})`);
        return { success: true, action: 'updated', stadionId };
      }
    }

    // CREATE new person
    log('Creating new person');
    const response = await stadionRequest('wp/v2/people', 'POST', prepared.data, { verbose });
    const newId = response.body.id;
    updateSyncState(stadionDb, knvbId, prepared.source_hash, newId);

    console.log(`Created person ${newId} (${prepared.data.acf.first_name} ${prepared.data.acf.last_name})`);
    return { success: true, action: 'created', stadionId: newId };

  } finally {
    lapostaDb.close();
    stadionDb.close();
  }
}

/**
 * Look up a member by name (partial match)
 */
function findMemberByName(searchTerm) {
  const lapostaDb = openLapostaDb();
  try {
    const resultsJson = getLatestSportlinkResults(lapostaDb);
    if (!resultsJson) return [];

    const members = JSON.parse(resultsJson);
    const search = searchTerm.toLowerCase();

    return members.filter(m => {
      const fullName = `${m.FirstName} ${m.Infix || ''} ${m.LastName}`.toLowerCase();
      return fullName.includes(search);
    }).map(m => ({
      knvbId: m.MemberId,
      name: `${m.FirstName} ${m.Infix ? m.Infix + ' ' : ''}${m.LastName}`,
      email: m.Email
    }));
  } finally {
    lapostaDb.close();
  }
}

module.exports = { syncIndividual, findMemberByName };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const searchMode = args.includes('--search');

  // Filter out flags to get the identifier
  const identifier = args.find(a => !a.startsWith('--'));

  if (!identifier) {
    console.log('Usage: node sync-individual.js <knvb-id> [options]');
    console.log('       node sync-individual.js --search <name> [options]');
    console.log('\nOptions:');
    console.log('  --verbose    Show detailed output');
    console.log('  --force      Sync even if no changes detected');
    console.log('  --dry-run    Show what would be synced without making changes');
    console.log('  --search     Search for members by name');
    console.log('\nExamples:');
    console.log('  node sync-individual.js 12345678       # Sync by KNVB ID');
    console.log('  node sync-individual.js --search Jan   # Find members named Jan');
    process.exit(1);
  }

  if (searchMode) {
    const results = findMemberByName(identifier);
    if (results.length === 0) {
      console.log(`No members found matching "${identifier}"`);
    } else {
      console.log(`Found ${results.length} member(s):\n`);
      results.forEach(m => {
        console.log(`  ${m.knvbId}  ${m.name}  ${m.email || '(no email)'}`);
      });
    }
    process.exit(0);
  }

  syncIndividual(identifier, { verbose, force, dryRun })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      if (verbose) console.error(err.stack);
      process.exitCode = 1;
    });
}
