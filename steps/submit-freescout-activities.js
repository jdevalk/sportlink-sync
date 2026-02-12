require('dotenv/config');

const { openDb: openConversationsDb, markConversationSynced } = require('../lib/freescout-conversations-db');
const { rondoClubRequestWithRetry } = require('../lib/rondo-club-client');
const { createSyncLogger } = require('../lib/logger');
const { parseCliArgs } = require('../lib/utils');

/**
 * Submit FreeScout conversation activities to Rondo Club Activities API.
 * Creates activity entries in person timelines and marks conversations as synced in SQLite.
 *
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {Array} [options.activities] - Pre-prepared activity payloads (optional)
 * @returns {Promise<{success: boolean, total: number, created: number, skipped: number, failed: number, errors: Array}>}
 */
async function runSubmitActivities(options = {}) {
  const { logger: providedLogger, verbose = false, activities: providedActivities } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'freescout-activities-submit' });

  const result = {
    success: true,
    total: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  let conversationsDb = null;
  let activities = providedActivities;

  try {
    logger.log('Starting FreeScout activities submission');

    // If activities not provided, run prepare step to get them
    if (!activities) {
      logger.verbose('No activities provided, running prepare step');
      const { runPrepareActivities } = require('./prepare-freescout-activities');
      const prepareResult = await runPrepareActivities({ logger, verbose });

      if (!prepareResult.success) {
        logger.error('Preparation step failed');
        result.success = false;
        return result;
      }

      activities = prepareResult.activities;
    }

    result.total = activities.length;

    if (activities.length === 0) {
      logger.log('No activities to submit');
      return result;
    }

    logger.verbose(`Submitting ${activities.length} activities to Rondo Club`);

    // Open conversations database for marking synced
    conversationsDb = openConversationsDb();

    // Check which conversations are already synced (defensive check)
    const alreadySyncedStmt = conversationsDb.prepare(`
      SELECT conversation_id, rondo_club_activity_id
      FROM freescout_conversations
      WHERE conversation_id = ? AND rondo_club_activity_id IS NOT NULL
    `);

    // Submit each activity
    for (const activity of activities) {
      try {
        // Defensive check: skip if already synced
        const existing = alreadySyncedStmt.get(activity.conversationId);
        if (existing) {
          logger.verbose(`Skipping conversation ${activity.conversationId} - already synced (activity ${existing.rondo_club_activity_id})`);
          result.skipped++;
          continue;
        }

        // Submit to Rondo Club Activities API
        const endpoint = `rondo/v1/people/${activity.personId}/activities`;
        const response = await rondoClubRequestWithRetry(
          endpoint,
          'POST',
          activity.body,
          { logger, verbose }
        );

        // Extract activity ID from response
        const rondoClubActivityId = response.body?.id;

        if (!rondoClubActivityId) {
          throw new Error('No activity ID in response');
        }

        logger.verbose(`Created activity ${rondoClubActivityId} for conversation ${activity.conversationId}`);

        // Mark conversation as synced
        markConversationSynced(conversationsDb, activity.conversationId, rondoClubActivityId);

        result.created++;

        // Rate limiting: 100ms delay between API calls
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Failed to submit activity for conversation ${activity.conversationId}: ${error.message}`);
        result.failed++;
        result.errors.push({
          conversationId: activity.conversationId,
          personId: activity.personId,
          message: error.message
        });
        // Continue to next activity (non-critical errors)
      }
    }

    logger.log(`Activities submitted: ${result.created} created, ${result.skipped} skipped, ${result.failed} failed`);

    result.success = result.failed === 0;
    return result;

  } catch (error) {
    result.success = false;
    logger.error(`Submission failed: ${error.message}`);
    return result;
  } finally {
    if (conversationsDb) {
      conversationsDb.close();
    }
  }
}

module.exports = { runSubmitActivities };

if (require.main === module) {
  const { verbose } = parseCliArgs();
  runSubmitActivities({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
