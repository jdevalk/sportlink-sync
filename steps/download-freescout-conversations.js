require('dotenv/config');

const { openDb: openConversationsDb, upsertConversations, updateLastSyncTimestamp, getLastSyncTimestamp, computeConversationHash } = require('../lib/freescout-conversations-db');
const { openDb: openFreescoutDb, getAllTrackedCustomers } = require('../lib/freescout-db');
const { freescoutRequestWithRetry } = require('../lib/freescout-client');
const { createSyncLogger } = require('../lib/logger');
const { parseCliArgs } = require('../lib/utils');

/**
 * Download conversations from FreeScout API for all tracked customers.
 * Supports pagination and incremental sync via createdSince parameter.
 *
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {boolean} [options.force=false] - Force full sync (ignore last sync timestamp)
 * @returns {Promise<{success: boolean, totalCustomers: number, totalConversations: number, newConversations: number}>}
 */
async function runDownloadConversations(options = {}) {
  const { logger: providedLogger, verbose = false, force = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose, prefix: 'freescout-conversations' });

  const result = {
    success: true,
    totalCustomers: 0,
    totalConversations: 0,
    newConversations: 0
  };

  const conversationsDb = openConversationsDb();
  const freescoutDb = openFreescoutDb();

  try {
    logger.log('Starting FreeScout conversations download');

    // Get all tracked customers with FreeScout IDs
    const allCustomers = getAllTrackedCustomers(freescoutDb);
    const customersWithFreescout = allCustomers.filter(c => c.freescout_id);

    logger.verbose(`Found ${customersWithFreescout.length} customers with FreeScout IDs`);

    if (customersWithFreescout.length === 0) {
      logger.log('No customers with FreeScout IDs to fetch conversations for');
      return result;
    }

    result.totalCustomers = customersWithFreescout.length;

    // Get last sync timestamp for incremental sync
    const lastSyncTimestamp = force ? null : getLastSyncTimestamp(conversationsDb);
    if (lastSyncTimestamp && !force) {
      logger.verbose(`Incremental sync from: ${lastSyncTimestamp}`);
    } else {
      logger.verbose('Full sync (no previous timestamp or force mode)');
    }

    const allConversations = [];
    let errorCount = 0;

    // Fetch conversations for each customer
    for (let i = 0; i < customersWithFreescout.length; i++) {
      const customer = customersWithFreescout[i];

      try {
        // Build query parameters
        let endpoint = `/api/conversations?customerId=${customer.freescout_id}`;
        if (lastSyncTimestamp && !force) {
          endpoint += `&createdSince=${encodeURIComponent(lastSyncTimestamp)}`;
        }

        // Fetch first page
        logger.verbose(`Fetching conversations for customer ${customer.freescout_id} (${customer.knvb_id})...`);
        const firstResponse = await freescoutRequestWithRetry(endpoint, 'GET', null, { logger, verbose });

        const conversations = firstResponse.body._embedded?.conversations || [];
        const totalPages = firstResponse.body.page?.totalPages || 1;

        logger.verbose(`  Page 1/${totalPages}: ${conversations.length} conversations`);

        // Fetch remaining pages if needed
        for (let page = 2; page <= totalPages; page++) {
          const pageEndpoint = `${endpoint}&page=${page}`;
          const pageResponse = await freescoutRequestWithRetry(pageEndpoint, 'GET', null, { logger, verbose });
          const pageConversations = pageResponse.body._embedded?.conversations || [];
          conversations.push(...pageConversations);
          logger.verbose(`  Page ${page}/${totalPages}: ${pageConversations.length} conversations`);
        }

        // Transform conversations to our format
        for (const conv of conversations) {
          const hash = computeConversationHash(conv);
          allConversations.push({
            conversation_id: conv.id,
            knvb_id: customer.knvb_id,
            freescout_customer_id: customer.freescout_id,
            subject: conv.subject || '',
            status: conv.status || '',
            created_at: conv.createdAt,
            source_hash: hash
          });
        }

        // Rate limiting precaution: 100ms delay between customers
        if (i < customersWithFreescout.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }

        // Log progress every 50 customers
        if ((i + 1) % 50 === 0) {
          logger.verbose(`Processed ${i + 1}/${customersWithFreescout.length} customers...`);
        }

      } catch (error) {
        errorCount++;
        logger.error(`Failed to fetch conversations for customer ${customer.freescout_id} (${customer.knvb_id}): ${error.message}`);
        // Continue to next customer instead of failing entire step
      }
    }

    // Upsert all conversations
    if (allConversations.length > 0) {
      upsertConversations(conversationsDb, allConversations);
      result.totalConversations = allConversations.length;
      result.newConversations = allConversations.length; // All upserted are "new" for this run
      logger.verbose(`Upserted ${allConversations.length} conversations to database`);
    }

    // Update last sync timestamp
    const now = new Date().toISOString();
    updateLastSyncTimestamp(conversationsDb, now);
    logger.verbose(`Updated last sync timestamp to: ${now}`);

    logger.log(`Downloaded ${result.totalConversations} conversations from ${result.totalCustomers} customers`);

    if (errorCount > 0) {
      logger.log(`Completed with ${errorCount} errors (see above)`);
      result.success = errorCount < customersWithFreescout.length; // Success if at least some worked
    }

    return result;

  } catch (error) {
    result.success = false;
    logger.error(`Download failed: ${error.message}`);
    return result;
  } finally {
    conversationsDb.close();
    freescoutDb.close();
  }
}

module.exports = { runDownloadConversations };

if (require.main === module) {
  const { verbose, force } = parseCliArgs();
  runDownloadConversations({ verbose, force })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
