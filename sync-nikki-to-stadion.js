require('varlock/auto-load');

const crypto = require('crypto');
const { stadionRequest } = require('./lib/stadion-client');
const { openDb: openNikkiDb, getContributionsGroupedByMember } = require('./lib/nikki-db');
const { openDb: openStadionDb, getAllTrackedMembers } = require('./lib/stadion-db');
const { createSyncLogger } = require('./lib/logger');

/**
 * Format currency as Euro (European format)
 * @param {number} amount - Amount in Euros
 * @returns {string} - Formatted string like "€123,45"
 */
function formatEuro(amount) {
  if (amount === null || amount === undefined) return '€0,00';
  return '€' + amount.toFixed(2).replace('.', ',');
}

/**
 * Generate HTML content for a member's Nikki contributions.
 * Format: Unordered list with links to Nikki.
 *
 * @param {Array<{year: number, nikki_id: string, saldo: number, status: string}>} contributions
 * @returns {string} - HTML content
 */
function generateContributionHtml(contributions) {
  if (!contributions || contributions.length === 0) {
    return '';
  }

  const items = contributions.map((c) => {
    const url = `https://mijn.nikki-online.nl/leden/${c.nikki_id}`;
    const saldoStr = formatEuro(c.saldo);
    const statusStr = c.status || 'Onbekend';
    return `<li><a href="${url}">${c.year} - ${statusStr} - ${saldoStr}</a></li>`;
  });

  return `<ul>\n${items.join('\n')}\n</ul>`;
}

/**
 * Build per-year ACF fields from contributions.
 * Creates fields like _nikki_2025_total, _nikki_2025_saldo, _nikki_2025_status
 *
 * @param {Array<{year: number, nikki_id: string, saldo: number, hoofdsom: number, status: string}>} contributions
 * @returns {Object} - Object with per-year field keys and values
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
 * Compute hash for HTML content (for change detection)
 */
function computeContentHash(html) {
  return crypto.createHash('sha256').update(html || '').digest('hex');
}

/**
 * Make a Stadion API request with retry logic for transient errors (5xx).
 * Uses exponential backoff: 1s, 2s, 4s between retries.
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object|null} body - Request body
 * @param {Object} options - Options for stadionRequest
 * @param {number} maxRetries - Maximum retry attempts (default 3)
 * @returns {Promise<Object>} - API response
 */
async function stadionRequestWithRetry(endpoint, method, body, options, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await stadionRequest(endpoint, method, body, options);
    } catch (error) {
      lastError = error;

      // Only retry on 5xx errors (server errors)
      const status = error.message?.match(/\((\d+)\)/)?.[1];
      if (!status || parseInt(status, 10) < 500) {
        throw error; // Don't retry client errors (4xx)
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Sync Nikki contribution data to Stadion WYSIWYG field
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

    // Track current content hashes for change detection (in-memory for this run)
    // In a full implementation, you'd store these in the database
    const currentHashes = new Map();

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

      // Generate HTML content
      const html = generateContributionHtml(contributions);
      const contentHash = computeContentHash(html);

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
          const currentValue = response.body?.acf?.['nikki-contributie-status'] || '';
          const currentHash = computeContentHash(currentValue);

          if (currentHash === contentHash) {
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
        logger.log(`[DRY-RUN] Would update ${knvbId} (Stadion ID: ${stadionId})`);
        logger.verbose(`  HTML: ${html.substring(0, 100)}...`);
        result.updated++;
        continue;
      }

      // Update Stadion
      try {
        logger.verbose(`[${processed}/${contributionsByMember.size}] ${knvbId}: Updating Stadion ID ${stadionId}`);

        // Build per-year ACF fields for all contribution years
        const perYearFields = buildPerYearAcfFields(contributions);

        await stadionRequestWithRetry(
          `wp/v2/people/${stadionId}`,
          'PUT',
          {
            acf: {
              first_name: existingFirstName,
              last_name: existingLastName,
              'nikki-contributie-status': html,
              ...perYearFields
            }
          },
          { verbose: false }
        );

        result.updated++;
        logger.verbose(`  Updated successfully`);

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

module.exports = { runNikkiStadionSync, generateContributionHtml, formatEuro };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');
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
