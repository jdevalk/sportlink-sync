require('dotenv/config');

const { openDb: openConversationsDb, getUnsyncedConversations } = require('../lib/freescout-conversations-db');
const { openDb: openRondoDb } = require('../lib/rondo-club-db');
const { createSyncLogger } = require('../lib/logger');
const { parseCliArgs, readEnv } = require('../lib/utils');

/**
 * Escape HTML special characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Transform FreeScout conversations into Rondo Club activity payloads.
 * Maps knvb_id to rondo_club_id and builds activity payload for each conversation.
 *
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, total: number, prepared: number, skipped: number, activities: Array}>}
 */
async function runPrepareActivities(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'freescout-activities' });

  const result = {
    success: true,
    total: 0,
    prepared: 0,
    skipped: 0,
    activities: []
  };

  const conversationsDb = openConversationsDb();
  const rondoDb = openRondoDb();

  try {
    logger.log('Starting FreeScout activities preparation');

    // Get unsynced conversations
    const conversations = getUnsyncedConversations(conversationsDb);
    result.total = conversations.length;

    logger.verbose(`Found ${conversations.length} unsynced conversations`);

    if (conversations.length === 0) {
      logger.log('No unsynced conversations to prepare');
      return result;
    }

    // Get FreeScout base URL for links
    const freescoutUrl = readEnv('FREESCOUT_BASE_URL', '');
    if (!freescoutUrl) {
      logger.error('FREESCOUT_BASE_URL not configured - activities will have missing links');
    }

    // Prepare statement for knvb_id lookup
    const lookupStmt = rondoDb.prepare(`
      SELECT rondo_club_id
      FROM rondo_club_members
      WHERE knvb_id = ?
    `);

    // Transform each conversation to activity payload
    for (const conv of conversations) {
      // Look up rondo_club_id
      const member = lookupStmt.get(conv.knvb_id);

      if (!member || !member.rondo_club_id) {
        logger.verbose(`Skipping conversation ${conv.conversation_id} - no rondo_club_id for knvb_id ${conv.knvb_id}`);
        result.skipped++;
        continue;
      }

      // Extract date and time from created_at (ISO 8601 format)
      const datePart = conv.created_at.split('T')[0]; // YYYY-MM-DD
      const timePart = conv.created_at.split('T')[1]?.substring(0, 5) || ''; // HH:MM

      // Build activity payload
      const conversationUrl = freescoutUrl
        ? `${freescoutUrl}/conversation/${conv.conversation_id}`
        : '';

      const activity = {
        personId: member.rondo_club_id, // For URL path, not in body
        conversationId: conv.conversation_id, // For tracking
        body: {
          content: `<p><strong>${escapeHtml(conv.subject)}</strong></p><p><a href="${conversationUrl}">Bekijk in FreeScout</a></p>`,
          activity_type: 'email',
          activity_date: datePart,
          activity_time: timePart
        }
      };

      result.activities.push(activity);
      result.prepared++;
    }

    logger.log(`Prepared ${result.prepared} activities from ${result.total} conversations (${result.skipped} skipped)`);

    return result;

  } catch (error) {
    result.success = false;
    logger.error(`Preparation failed: ${error.message}`);
    return result;
  } finally {
    conversationsDb.close();
    rondoDb.close();
  }
}

module.exports = { runPrepareActivities };

if (require.main === module) {
  const { verbose } = parseCliArgs();
  runPrepareActivities({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
