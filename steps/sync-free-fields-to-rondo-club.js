require('dotenv/config');

const { openDb } = require('../lib/rondo-club-db');
const { rondoClubRequest } = require('../lib/rondo-club-client');
const { createSyncLogger } = require('../lib/logger');

/**
 * Sync free fields (VOG datum, FreeScout ID, financial block) from Sportlink to Rondo Club.
 *
 * This step syncs free field data that was downloaded by download-functions-from-sportlink.js
 * to individual person records in Rondo Club WordPress. It tracks sync state to avoid
 * redundant updates.
 *
 * Free fields synced:
 * - datum-vog (VOG certificate date from Sportlink Remarks8)
 * - freescout-id (FreeScout customer ID from Remarks3)
 * - financiele-blokkade (Financial block status from MemberHeader)
 */
async function runSyncFreeFieldsToRondoClub(options = {}) {
  const { logger, verbose = false, force = false } = options;
  const log = logger?.log.bind(logger) || console.log;
  const logVerbose = logger?.verbose.bind(logger) || (verbose ? console.log : () => {});
  const logError = logger?.error.bind(logger) || console.error;

  const result = {
    total: 0,
    synced: 0,
    skipped: 0,
    errors: []
  };

  const db = openDb();
  try {
    // Get all members with free field data from sportlink_member_free_fields table
    const freeFieldsStmt = db.prepare(`
      SELECT
        smff.knvb_id,
        smff.freescout_id,
        smff.vog_datum,
        smff.has_financial_block,
        rcm.rondo_club_id,
        rcm.data_json,
        rcm.freescout_id_sportlink_modified,
        rcm.datum_vog_sportlink_modified,
        rcm.financiele_blokkade_sportlink_modified
      FROM sportlink_member_free_fields smff
      INNER JOIN rondo_club_members rcm ON smff.knvb_id = rcm.knvb_id
      WHERE rcm.rondo_club_id IS NOT NULL
    `);

    const members = freeFieldsStmt.all();
    result.total = members.length;

    if (members.length === 0) {
      log('No free fields to sync');
      return result;
    }

    log(`Processing ${members.length} members with free field data`);

    for (const member of members) {
      const { knvb_id, freescout_id, vog_datum, has_financial_block, rondo_club_id } = member;

      // Parse stored data to get current field values and required fields
      let data;
      try {
        data = JSON.parse(member.data_json || '{}');
      } catch (e) {
        logVerbose(`Skipping ${knvb_id}: invalid data_json`);
        result.skipped++;
        continue;
      }

      const acf = data.acf || {};
      const firstName = acf.first_name;
      const lastName = acf.last_name;

      if (!firstName || !lastName) {
        logVerbose(`Skipping ${knvb_id}: missing first_name or last_name`);
        result.skipped++;
        continue;
      }

      // Build update payload with current values from WordPress
      const currentVogDatum = acf['datum-vog'] || null;
      const currentFreescoutId = acf['freescout-id'] || null;
      const currentFinancialBlock = acf['financiele-blokkade'] || false;

      // New values from Sportlink
      const newVogDatum = vog_datum || null;
      const newFreescoutId = freescout_id || null;
      const newFinancialBlock = has_financial_block === 1;

      // Check if any field needs update (unless force mode)
      const vogChanged = newVogDatum !== currentVogDatum;
      const freescoutChanged = newFreescoutId !== currentFreescoutId;
      const financialBlockChanged = newFinancialBlock !== currentFinancialBlock;

      if (!force && !vogChanged && !freescoutChanged && !financialBlockChanged) {
        logVerbose(`Skipping ${knvb_id}: no changes`);
        result.skipped++;
        continue;
      }

      // Build update payload
      const updatePayload = {
        acf: {
          first_name: firstName,
          last_name: lastName
        }
      };

      // Only include changed fields in payload
      if (vogChanged || force) {
        updatePayload.acf['datum-vog'] = newVogDatum;
      }
      if (freescoutChanged || force) {
        updatePayload.acf['freescout-id'] = newFreescoutId;
      }
      if (financialBlockChanged || force) {
        updatePayload.acf['financiele-blokkade'] = newFinancialBlock;
      }

      logVerbose(`Syncing free fields for ${knvb_id} → person ${rondo_club_id}`);
      if (vogChanged) logVerbose(`  VOG: ${currentVogDatum} → ${newVogDatum}`);
      if (freescoutChanged) logVerbose(`  FreeScout ID: ${currentFreescoutId} → ${newFreescoutId}`);
      if (financialBlockChanged) logVerbose(`  Financial block: ${currentFinancialBlock} → ${newFinancialBlock}`);

      try {
        await rondoClubRequest(
          `wp/v2/people/${rondo_club_id}`,
          'PUT',
          updatePayload,
          { logger, verbose }
        );

        // Update tracking timestamps for modified fields
        const now = new Date().toISOString();
        if (vogChanged || force) {
          db.prepare('UPDATE rondo_club_members SET datum_vog_sportlink_modified = ? WHERE knvb_id = ?')
            .run(now, knvb_id);
        }
        if (freescoutChanged || force) {
          db.prepare('UPDATE rondo_club_members SET freescout_id_sportlink_modified = ? WHERE knvb_id = ?')
            .run(now, knvb_id);
        }
        if (financialBlockChanged || force) {
          db.prepare('UPDATE rondo_club_members SET financiele_blokkade_sportlink_modified = ? WHERE knvb_id = ?')
            .run(now, knvb_id);
        }

        result.synced++;
      } catch (err) {
        logError(`Error syncing ${knvb_id} (person ${rondo_club_id}): ${err.message}`);
        result.errors.push({
          knvb_id,
          rondo_club_id,
          message: err.message
        });
      }
    }

    log(`Synced ${result.synced} free field updates to Rondo Club (${result.skipped} skipped, ${result.errors.length} errors)`);
    return result;
  } finally {
    db.close();
  }
}

module.exports = { runSyncFreeFieldsToRondoClub };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const force = process.argv.includes('--force');
  const logger = createSyncLogger({ verbose, prefix: 'free-fields' });

  runSyncFreeFieldsToRondoClub({ logger, verbose, force })
    .then(result => {
      logger.log(`Done: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`);
      if (result.errors.length > 0) {
        result.errors.forEach(e => logger.error(`  ${e.knvb_id}: ${e.message}`));
        process.exitCode = 1;
      }
      logger.close();
    })
    .catch(err => {
      logger.error(`Fatal: ${err.message}`);
      logger.close();
      process.exitCode = 1;
    });
}
