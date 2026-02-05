require('varlock/auto-load');

const { stadionRequestWithRetry } = require('../lib/stadion-client');
const { openDb: openNikkiDb, getContributionsGroupedByMember } = require('../lib/nikki-db');
const { openDb: openStadionDb, getAllTrackedMembers } = require('../lib/stadion-db');
const { createSyncLogger } = require('../lib/logger');
const { parseCliArgs, stableStringify, computeHash } = require('../lib/utils');

/**
 * Build per-year ACF fields from contributions.
 * Creates fields like _nikki_2025_total, _nikki_2025_saldo, _nikki_2025_status
 */
function buildPerYearAcfFields(contributions) {
  const fields = {};
  for (const c of contributions) {
    fields[`_nikki_${c.year}_total`] = c.hoofdsom ?? null;
    fields[`_nikki_${c.year}_saldo`] = c.saldo ?? null;
    fields[`_nikki_${c.year}_status`] = c.status || null;
  }
  return fields;
}

/**
 * Compute hash for change detection using stable JSON serialization.
 */
function computeFieldsHash(fields) {
  return computeHash(stableStringify(fields));
}

/**
 * Sync Nikki contribution data to Stadion per-year ACF fields
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force update all members
 * @param {boolean} [options.dryRun=false] - Don't actually update Stadion
 * @returns {Promise<{success: boolean, updated: number, skipped: number, errors: number}>}
 */
async function runNikkiStadionSync(options = {}) {
  const { logger: providedLogger, verbose = false, force = false, dryRun = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'nikki-stadion' });

  const result = {
    success: true,
    updated: 0,
    skipped: 0,
    errors: 0,
    noStadionId: 0
  };

  const nikkiDb = openNikkiDb();
  const stadionDb = openStadionDb();

  try {
    logger.log('Starting Nikki → Stadion sync');

    // Get all Nikki contributions grouped by KNVB ID
    const contributionsByMember = getContributionsGroupedByMember(nikkiDb);
    logger.verbose(`Found contributions for ${contributionsByMember.size} members`);

    // Get all tracked members from Stadion DB (knvb_id → stadion_id mapping)
    const trackedMembers = getAllTrackedMembers(stadionDb);
    const knvbIdToStadionId = new Map();
    for (const member of trackedMembers) {
      if (member.knvb_id && member.stadion_id) {
        knvbIdToStadionId.set(member.knvb_id, member.stadion_id);
      }
    }
    logger.verbose(`Loaded ${knvbIdToStadionId.size} KNVB → Stadion ID mappings`);

    // Process each member with contributions
    let processed = 0;
    for (const [knvbId, contributions] of contributionsByMember) {
      processed++;
      const stadionId = knvbIdToStadionId.get(knvbId);

      if (!stadionId) {
        logger.verbose(`[${processed}/${contributionsByMember.size}] ${knvbId}: No Stadion ID, skipping`);
        result.noStadionId++;
        continue;
      }

      // Build per-year ACF fields for all contribution years
      const perYearFields = buildPerYearAcfFields(contributions);
      const newFieldsHash = computeFieldsHash(perYearFields);

      // Fetch existing data from Stadion (needed for change detection AND name fields)
      let existingFirstName = '';
      let existingLastName = '';
      let skipUpdate = false;

      try {
        const response = await stadionRequestWithRetry(
          `wp/v2/people/${stadionId}?_fields=acf`,
          'GET',
          null,
          { verbose: false }
        );

        existingFirstName = response.body?.acf?.first_name || '';
        existingLastName = response.body?.acf?.last_name || '';

        // Check if we need to update (only if not forcing)
        if (!force) {
          // Extract existing per-year fields from response for comparison
          const existingAcf = response.body?.acf || {};
          const existingPerYearFields = {};
          for (const key of Object.keys(perYearFields)) {
            existingPerYearFields[key] = existingAcf[key] ?? null;
          }
          const existingFieldsHash = computeFieldsHash(existingPerYearFields);

          if (existingFieldsHash === newFieldsHash) {
            logger.verbose(`[${processed}/${contributionsByMember.size}] ${knvbId}: No changes, skipping`);
            result.skipped++;
            skipUpdate = true;
          }
        }
      } catch (error) {
        // If fetch fails, we can't update safely (need first_name for API)
        logger.error(`[${processed}/${contributionsByMember.size}] ${knvbId}: Could not fetch current data: ${error.message}`);
        result.errors++;
        continue;
      }

      if (skipUpdate) {
        continue;
      }

      if (dryRun) {
        const years = contributions.map(c => c.year).join(', ');
        logger.log(`[DRY-RUN] Would update ${knvbId} (Stadion ID: ${stadionId}, years: ${years})`);
        result.updated++;
        continue;
      }

      // Update Stadion
      try {
        logger.verbose(`[${processed}/${contributionsByMember.size}] ${knvbId}: Updating Stadion ID ${stadionId}`);

        await stadionRequestWithRetry(
          `wp/v2/people/${stadionId}`,
          'PUT',
          {
            acf: {
              first_name: existingFirstName,
              last_name: existingLastName,
              ...perYearFields
            }
          },
          { verbose: false }
        );

        result.updated++;
        const years = contributions.map(c => c.year).join(', ');
        logger.verbose(`  Updated successfully (years: ${years})`);

      } catch (error) {
        result.errors++;
        logger.error(`[${processed}/${contributionsByMember.size}] ${knvbId}: Update failed - ${error.message}`);
        if (error.details) {
          logger.verbose(`  Details: ${JSON.stringify(error.details)}`);
        }
      }

      // Delay between requests to avoid overwhelming server
      if (processed < contributionsByMember.size) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Summary
    logger.log(`Nikki → Stadion sync complete`);
    logger.log(`  Updated: ${result.updated}`);
    logger.log(`  Skipped (no changes): ${result.skipped}`);
    logger.log(`  Skipped (no Stadion ID): ${result.noStadionId}`);
    if (result.errors > 0) {
      logger.log(`  Errors: ${result.errors}`);
      result.success = false;
    }

    return result;

  } finally {
    nikkiDb.close();
    stadionDb.close();
  }
}

module.exports = { runNikkiStadionSync, buildPerYearAcfFields };

if (require.main === module) {
  const { verbose, force } = parseCliArgs();
  const dryRun = process.argv.includes('--dry-run');

  runNikkiStadionSync({ verbose, force, dryRun })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
