require('varlock/auto-load');

const { stadionRequest } = require('./lib/stadion-client');
const { runPrepare } = require('./prepare-stadion-members');
const { runPrepare: runPrepareParents } = require('./prepare-stadion-parents');
const {
  openDb,
  upsertMembers,
  getMembersNeedingSync,
  updateSyncState,
  deleteMember,
  getMembersNotInList,
  getAllTrackedMembers,
  upsertParents,
  getParentsNeedingSync,
  updateParentSyncState,
  deleteParent,
  getParentsNotInList
} = require('./lib/stadion-db');

/**
 * Sync a single member to Stadion (create or update)
 * Uses local stadion_id tracking - no API search needed
 * @param {Object} member - Member record from database
 * @param {Object} db - SQLite database connection
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<{action: string, id: number}>}
 */
async function syncPerson(member, db, options) {
  const { knvb_id, data, source_hash, stadion_id } = member;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  if (stadion_id) {
    // UPDATE existing person (we know the ID from our database)
    logVerbose(`Updating existing person: ${stadion_id}`);
    const response = await stadionRequest(
      `wp/v2/people/${stadion_id}`,
      'PUT',
      data,
      options
    );
    updateSyncState(db, knvb_id, source_hash, stadion_id);
    return { action: 'updated', id: stadion_id };
  } else {
    // CREATE new person
    logVerbose(`Creating new person for KNVB ID: ${knvb_id}`);
    const response = await stadionRequest(
      'wp/v2/people',
      'POST',
      data,
      options
    );
    const newId = response.body.id;
    updateSyncState(db, knvb_id, source_hash, newId);
    return { action: 'created', id: newId };
  }
}

/**
 * Update children's parents relationship field (bidirectional linking)
 * Preserves existing parent links, adds new one
 */
async function updateChildrenParentLinks(parentId, childStadionIds, options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  for (const childId of childStadionIds) {
    try {
      // Get existing child record
      const childResponse = await stadionRequest(
        `wp/v2/people/${childId}`,
        'GET',
        null,
        options
      );

      const existingRelationships = childResponse.body.acf?.relationships || [];
      const hasParentLink = existingRelationships.some(r => r.related_person === parentId);

      if (!hasParentLink) {
        const newRelationship = {
          related_person: parentId,
          relationship_type: [8], // Parent relationship type term ID
          relationship_label: ''
        };
        const mergedRelationships = [...existingRelationships, newRelationship];
        await stadionRequest(
          `wp/v2/people/${childId}`,
          'PUT',
          { acf: { relationships: mergedRelationships } },
          options
        );
        logVerbose(`Linked parent ${parentId} to child ${childId}`);
      }
    } catch (error) {
      logVerbose(`Failed to link parent to child ${childId}: ${error.message}`);
      // Continue with other children
    }
  }
}

/**
 * Sync a single parent to Stadion (create or update)
 * Uses local stadion_id tracking - no API search needed
 * @param {Object} parent - Parent record from preparation
 * @param {Object} db - SQLite database connection
 * @param {Map} knvbIdToStadionId - Map of KNVB ID to Stadion post ID for children
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<{action: string, id: number}>}
 */
async function syncParent(parent, db, knvbIdToStadionId, options) {
  const { email, childKnvbIds, data, source_hash, stadion_id } = parent;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});

  // Resolve child KNVB IDs to Stadion post IDs
  const childStadionIds = childKnvbIds
    .map(knvbId => knvbIdToStadionId.get(knvbId))
    .filter(Boolean);

  // Build relationships array for children
  const childRelationships = childStadionIds.map(childId => ({
    related_person: childId,
    relationship_type: [9], // Child relationship type term ID
    relationship_label: ''
  }));

  if (stadion_id) {
    // UPDATE existing parent
    logVerbose(`Updating existing parent: ${stadion_id}`);

    // Get existing relationships to merge
    let existingRelationships = [];
    try {
      const existing = await stadionRequest(`wp/v2/people/${stadion_id}`, 'GET', null, options);
      existingRelationships = existing.body.acf?.relationships || [];
    } catch (e) {
      logVerbose(`Could not fetch existing parent: ${e.message}`);
    }

    // Merge: keep non-child relationships, add new child relationships
    const otherRelationships = existingRelationships.filter(r =>
      !childStadionIds.includes(r.related_person)
    );
    const mergedRelationships = [...otherRelationships, ...childRelationships];

    const updateData = {
      ...data,
      acf: {
        ...data.acf,
        relationships: mergedRelationships
      }
    };

    await stadionRequest(
      `wp/v2/people/${stadion_id}`,
      'PUT',
      updateData,
      options
    );
    updateParentSyncState(db, email, source_hash, stadion_id);

    // Update children's parent relationship (bidirectional)
    await updateChildrenParentLinks(stadion_id, childStadionIds, options);

    return { action: 'updated', id: stadion_id };
  } else {
    // CREATE new parent
    logVerbose(`Creating new parent: ${email}`);
    const createData = {
      ...data,
      acf: {
        ...data.acf,
        relationships: childRelationships
      }
    };

    const response = await stadionRequest(
      'wp/v2/people',
      'POST',
      createData,
      options
    );
    const newId = response.body.id;
    updateParentSyncState(db, email, source_hash, newId);

    // Update children's parent relationship (bidirectional)
    await updateChildrenParentLinks(newId, childStadionIds, options);

    return { action: 'created', id: newId };
  }
}

/**
 * Delete parents that no longer have children in Sportlink
 */
async function deleteOrphanParents(db, currentParentEmails, options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});
  const deleted = [];
  const errors = [];

  const toDelete = getParentsNotInList(db, currentParentEmails);

  for (const parent of toDelete) {
    if (!parent.stadion_id) {
      deleteParent(db, parent.email);
      continue;
    }

    logVerbose(`Deleting orphan parent: ${parent.email}`);
    try {
      await stadionRequest(
        `wp/v2/people/${parent.stadion_id}`,
        'DELETE',
        null,
        options
      );
      deleteParent(db, parent.email);
      deleted.push({ email: parent.email, stadion_id: parent.stadion_id });
    } catch (error) {
      errors.push({ email: parent.email, message: error.message });
    }
  }

  return { deleted, errors };
}

/**
 * Sync parents to Stadion
 * @param {Object} db - SQLite database connection
 * @param {Map} knvbIdToStadionId - Map of member KNVB ID to Stadion post ID
 * @param {Object} options - Logger, verbose, force options
 * @returns {Promise<Object>} - Parent sync result
 */
async function syncParents(db, knvbIdToStadionId, options = {}) {
  const { logger, verbose = false, force = false } = options;
  const logVerbose = logger?.verbose.bind(logger) || (verbose ? console.log : () => {});

  const result = {
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: []
  };

  // Prepare parents from Sportlink
  const prepared = await runPrepareParents({ logger, verbose });
  if (!prepared.success) {
    result.errors.push({ message: prepared.error });
    return result;
  }

  const parents = prepared.parents;
  result.total = parents.length;

  // Upsert to tracking database
  upsertParents(db, parents);

  // Get parents needing sync (includes stadion_id from database)
  const needsSync = getParentsNeedingSync(db, force);
  result.skipped = result.total - needsSync.length;

  logVerbose(`${needsSync.length} parents need sync (${result.skipped} unchanged)`);

  // Sync each parent
  for (let i = 0; i < needsSync.length; i++) {
    const parent = needsSync[i];
    logVerbose(`Syncing parent ${i + 1}/${needsSync.length}: ${parent.email}`);

    try {
      const syncResult = await syncParent(parent, db, knvbIdToStadionId, options);
      result.synced++;
      if (syncResult.action === 'created') result.created++;
      if (syncResult.action === 'updated') result.updated++;
    } catch (error) {
      console.error(`ERROR for parent ${parent.email}:`, error.message);
      if (error.details) {
        console.error('Error details:', JSON.stringify(error.details, null, 2));
      }
      result.errors.push({ email: parent.email, message: error.message, details: error.details });
    }
  }

  // Delete orphan parents
  const currentEmails = parents.map(p => p.email);
  const deleteResult = await deleteOrphanParents(db, currentEmails, options);
  result.deleted = deleteResult.deleted.length;
  result.errors.push(...deleteResult.errors);

  return result;
}

/**
 * Delete members that were removed from Sportlink
 * @param {Object} db - SQLite database connection
 * @param {Array<string>} currentKnvbIds - Current KNVB IDs from Sportlink
 * @param {Object} options - Logger and verbose options
 * @returns {Promise<{deleted: Array, errors: Array}>}
 */
async function deleteRemovedMembers(db, currentKnvbIds, options) {
  const logVerbose = options.logger?.verbose.bind(options.logger) || (options.verbose ? console.log : () => {});
  const deleted = [];
  const errors = [];

  // Find members in DB but not in current Sportlink data
  const toDelete = getMembersNotInList(db, currentKnvbIds);

  for (const member of toDelete) {
    if (!member.stadion_id) {
      // Never synced to Stadion, just remove from tracking
      deleteMember(db, member.knvb_id);
      continue;
    }

    logVerbose(`Deleting from Stadion: ${member.knvb_id}`);
    try {
      await stadionRequest(
        `wp/v2/people/${member.stadion_id}`,
        'DELETE',
        null,
        options
      );
      deleteMember(db, member.knvb_id);
      deleted.push({ knvb_id: member.knvb_id, stadion_id: member.stadion_id });
    } catch (error) {
      errors.push({ knvb_id: member.knvb_id, message: error.message });
    }
  }

  return { deleted, errors };
}

/**
 * Main sync orchestration
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force sync all members
 * @param {boolean} [options.includeMembers=true] - Include member sync
 * @param {boolean} [options.includeParents=true] - Include parent sync
 * @returns {Promise<Object>} - Sync result
 */
async function runSync(options = {}) {
  const { logger, verbose = false, force = false, includeMembers = true, includeParents = true } = options;
  const logVerbose = logger?.verbose.bind(logger) || (verbose ? console.log : () => {});
  const logError = logger?.error.bind(logger) || console.error;

  const result = {
    success: true,
    total: 0,
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: []
  };

  try {
    const db = openDb();
    try {
      // Members sync
      if (includeMembers) {
        // Step 1: Prepare members from Sportlink
        const prepared = await runPrepare({ logger, verbose });
        if (!prepared.success) {
          result.success = false;
          result.error = prepared.error;
          return result;
        }

        const members = prepared.members;
        result.total = members.length;

        // Step 2: Upsert to tracking database
        upsertMembers(db, members);

        // Step 3: Get members needing sync (hash changed or force)
        // This now includes stadion_id from database for each member
        const needsSync = getMembersNeedingSync(db, force);
        result.skipped = result.total - needsSync.length;

        logVerbose(`${needsSync.length} members need sync (${result.skipped} unchanged)`);

        // Step 4: Sync each member
        for (let i = 0; i < needsSync.length; i++) {
          const member = needsSync[i];
          logVerbose(`Syncing ${i + 1}/${needsSync.length}: ${member.knvb_id}`);

          try {
            const syncResult = await syncPerson(member, db, options);
            result.synced++;
            if (syncResult.action === 'created') result.created++;
            if (syncResult.action === 'updated') result.updated++;
          } catch (error) {
            result.errors.push({
              knvb_id: member.knvb_id,
              email: member.email,
              message: error.message
            });
          }
        }

        // Step 5: Delete members removed from Sportlink
        const currentKnvbIds = members.map(m => m.knvb_id);
        const deleteResult = await deleteRemovedMembers(db, currentKnvbIds, options);
        result.deleted = deleteResult.deleted.length;
        result.errors.push(...deleteResult.errors);
      }

      // Parents sync
      if (includeParents) {
        // Build KNVB ID to Stadion ID mapping from ALL tracked members
        const knvbIdToStadionId = new Map();
        const allMembers = getAllTrackedMembers(db);
        allMembers.forEach(m => {
          if (m.knvb_id && m.stadion_id) {
            knvbIdToStadionId.set(m.knvb_id, m.stadion_id);
          }
        });

        logVerbose('Starting parent sync...');
        const parentResult = await syncParents(db, knvbIdToStadionId, options);
        result.parents = parentResult;
      }

    } finally {
      db.close();
    }

    result.success = result.errors.length === 0;
    return result;

  } catch (error) {
    result.success = false;
    result.error = error.message;
    logError(`Sync error: ${error.message}`);
    return result;
  }
}

module.exports = { runSync };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');
  const parentsOnly = process.argv.includes('--parents-only');
  const skipParents = process.argv.includes('--skip-parents');

  const options = {
    verbose,
    force,
    includeMembers: !parentsOnly,
    includeParents: !skipParents
  };

  runSync(options)
    .then(result => {
      if (options.includeMembers) {
        console.log(`Stadion sync: ${result.synced}/${result.total} synced`);
        console.log(`  Created: ${result.created}`);
        console.log(`  Updated: ${result.updated}`);
        console.log(`  Skipped: ${result.skipped}`);
        console.log(`  Deleted: ${result.deleted}`);
      }
      if (result.parents) {
        console.log(`Parents: ${result.parents.synced}/${result.parents.total} synced`);
        console.log(`  Created: ${result.parents.created}`);
        console.log(`  Updated: ${result.parents.updated}`);
        console.log(`  Skipped: ${result.parents.skipped}`);
        console.log(`  Deleted: ${result.parents.deleted}`);
      }
      if (result.errors.length > 0) {
        console.error(`  Errors: ${result.errors.length}`);
        result.errors.forEach(e => console.error(`    - ${e.knvb_id || e.email}: ${e.message}`));
        process.exitCode = 1;
      }
      if (result.parents?.errors.length > 0) {
        console.error(`  Parent errors: ${result.parents.errors.length}`);
        result.parents.errors.forEach(e => console.error(`    - ${e.email}: ${e.message}`));
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
