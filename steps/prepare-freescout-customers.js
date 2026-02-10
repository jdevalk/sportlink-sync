require('varlock/auto-load');

const path = require('path');
const fs = require('fs');
const { openDb: openRondoClubDb, getMemberFreeFieldsByKnvbId, getMemberWorkHistory, getAllTrackedMembers } = require('../lib/rondo-club-db');
const { openDb: openFreescoutDb, getCustomerByKnvbId } = require('../lib/freescout-db');
const { createLoggerAdapter } = require('../lib/log-adapters');

// Nikki DB is optional - will be null if not available
let openNikkiDb = null;
let getContributionsByKnvbId = null;

// Try to load nikki-db, but don't fail if it's not available
try {
  const nikkiDb = require('../lib/nikki-db');
  openNikkiDb = nikkiDb.openDb;
  getContributionsByKnvbId = nikkiDb.getContributionsByKnvbId;
} catch (err) {
  // nikki-db module not available - that's fine
}

/**
 * Check if Nikki database file exists
 * @returns {boolean}
 */
function nikkiDbExists() {
  const dbPath = path.join(process.cwd(), 'data', 'nikki-sync.sqlite');
  return fs.existsSync(dbPath);
}

/**
 * Get existing FreeScout ID for a member
 * First checks freescout_customers table (authoritative), then sportlink_member_free_fields (secondary)
 * @param {Object} freescoutDb - FreeScout database connection
 * @param {Object} rondoClubDb - Rondo Club database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {number|null} - FreeScout customer ID or null
 */
function getExistingFreescoutId(freescoutDb, rondoClubDb, knvbId) {
  // First check our authoritative tracking database
  const trackedCustomer = getCustomerByKnvbId(freescoutDb, knvbId);
  if (trackedCustomer && trackedCustomer.freescout_id) {
    return trackedCustomer.freescout_id;
  }

  // Fall back to Sportlink free fields (for initial seeding)
  const freeFields = getMemberFreeFieldsByKnvbId(rondoClubDb, knvbId);
  if (freeFields && freeFields.freescout_id) {
    return freeFields.freescout_id;
  }

  return null;
}

/**
 * Get photo URL for a member (only if photo is synced to Rondo Club)
 * @param {Object} member - Member record from stadion_members
 * @returns {string|null} - Photo URL or null
 */
function getPhotoUrl(member) {
  // Only include photo URL if photo_state is 'synced'
  if (member.photo_state !== 'synced') {
    return null;
  }

  // Construct Rondo Club photo URL
  // The photo is attached to the person post in WordPress
  // Format: RONDO_URL/wp-json/wp/v2/media?parent={stadion_id}
  // But for FreeScout, we just need the featured image URL which requires another API call
  // For now, we'll skip photo URLs - FreeScout can fetch from Rondo Club if needed
  return null;
}

/**
 * Get union teams (comma-separated) from work history
 * @param {Object} rondoClubDb - Rondo Club database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {string} - Comma-separated team names or empty string
 */
function getUnionTeams(rondoClubDb, knvbId) {
  const workHistory = getMemberWorkHistory(rondoClubDb, knvbId);
  if (!workHistory || workHistory.length === 0) {
    return '';
  }

  // Get unique team names from work history (including current and past)
  const teamNames = workHistory.map(wh => wh.team_name);
  // Remove duplicates and sort
  const uniqueTeams = [...new Set(teamNames)].sort();
  return uniqueTeams.join(', ');
}

/**
 * Get most recent Nikki contribution data for a member
 * @param {Object|null} nikkiDb - Nikki database connection (may be null)
 * @param {string} knvbId - Member KNVB ID
 * @returns {{saldo: number|null, status: string|null}}
 */
function getMostRecentNikkiData(nikkiDb, knvbId) {
  if (!nikkiDb || !getContributionsByKnvbId) {
    return { saldo: null, status: null };
  }

  try {
    const contributions = getContributionsByKnvbId(nikkiDb, knvbId);
    if (!contributions || contributions.length === 0) {
      return { saldo: null, status: null };
    }

    // Contributions are ordered by year DESC, so first is most recent
    const mostRecent = contributions[0];
    return {
      saldo: mostRecent.saldo,
      status: mostRecent.status
    };
  } catch (err) {
    // If any error occurs, return null values
    return { saldo: null, status: null };
  }
}

/**
 * Transform a stadion member to FreeScout customer format
 * @param {Object} member - Member record from stadion_members
 * @param {Object} freescoutDb - FreeScout database connection
 * @param {Object} rondoClubDb - Rondo Club database connection
 * @param {Object|null} nikkiDb - Nikki database connection (may be null)
 * @returns {Object|null} - FreeScout customer object or null if no email
 */
function prepareCustomer(member, freescoutDb, rondoClubDb, nikkiDb) {
  const data = member.data || {};
  const acf = data.acf || {};

  // Extract email from contact_info
  let email = null;
  if (acf.contact_info && Array.isArray(acf.contact_info)) {
    const emailContact = acf.contact_info.find(c => c.contact_type === 'email');
    if (emailContact) {
      email = emailContact.contact_value;
    }
  }

  // Get FreeScout ID from tracking databases
  const freescoutId = getExistingFreescoutId(freescoutDb, rondoClubDb, member.knvb_id);

  // For members with empty data_json (former members whose Sportlink data was wiped),
  // fall back to the email from the DB column and existing freescout data for name/phone.
  // Only do this when we already have a freescout record to preserve.
  let existingFreescoutData = null;
  if (!email && member.email && freescoutId) {
    email = member.email;
    const existing = getCustomerByKnvbId(freescoutDb, member.knvb_id);
    if (existing && existing.data) {
      existingFreescoutData = existing.data;
    }
  }

  // Skip members without email
  if (!email) {
    return null;
  }

  // Get mobile phone from contact_info
  let mobilePhone = null;
  if (acf.contact_info && Array.isArray(acf.contact_info)) {
    const mobileContact = acf.contact_info.find(c => c.contact_type === 'mobile');
    if (mobileContact) {
      mobilePhone = mobileContact.contact_value;
    }
  }

  let firstName = acf.first_name || '';
  let lastName = acf.last_name || '';
  let phones = [];
  if (mobilePhone) {
    phones.push({ type: 'mobile', value: mobilePhone });
  }

  // Use existing freescout data as fallback for name/phone
  if (existingFreescoutData) {
    if (!firstName) firstName = existingFreescoutData.firstName || '';
    if (!lastName) lastName = existingFreescoutData.lastName || '';
    if (phones.length === 0 && existingFreescoutData.phones) {
      phones = existingFreescoutData.phones;
    }
  }

  // Get union teams
  const unionTeams = getUnionTeams(rondoClubDb, member.knvb_id);

  // Get Nikki data
  const nikkiData = getMostRecentNikkiData(nikkiDb, member.knvb_id);

  return {
    knvb_id: member.knvb_id,
    email: email.toLowerCase(),
    freescout_id: freescoutId,
    data: {
      firstName,
      lastName,
      phones: phones,
      photoUrl: getPhotoUrl(member)
    },
    customFields: {
      union_teams: unionTeams,
      public_person_id: member.knvb_id,
      member_since: acf['lid-sinds'] || null,
      nikki_saldo: nikkiData.saldo,
      nikki_status: nikkiData.status
    }
  };
}

/**
 * Prepare FreeScout customers from Sportlink/Rondo Club data
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, customers: Array, error?: string}>}
 */
async function runPrepare(options = {}) {
  const { logger, verbose = false } = options;

  const { log, verbose: logVerbose, error: logError } = createLoggerAdapter({ logger, verbose });

  let rondoClubDb = null;
  let freescoutDb = null;
  let nikkiDb = null;
  let nikkiWarningLogged = false;

  try {
    // Open Rondo Club database
    rondoClubDb = openRondoClubDb();

    // Open FreeScout database
    freescoutDb = openFreescoutDb();

    // Try to open Nikki database (optional)
    if (nikkiDbExists() && openNikkiDb) {
      try {
        nikkiDb = openNikkiDb();
        logVerbose('Nikki database loaded successfully');
      } catch (err) {
        logVerbose(`Warning: Could not open Nikki database: ${err.message}`);
        nikkiDb = null;
      }
    } else {
      logVerbose('Nikki database not available - Nikki fields will be null');
      nikkiWarningLogged = true;
    }

    // Get all tracked members from stadion_members
    const stmt = rondoClubDb.prepare(`
      SELECT knvb_id, email, data_json, stadion_id, photo_state
      FROM stadion_members
      ORDER BY knvb_id ASC
    `);
    const memberRows = stmt.all();

    logVerbose(`Found ${memberRows.length} members in Rondo Club database`);

    // Transform each member
    const customers = [];
    let skippedNoEmail = 0;

    for (const row of memberRows) {
      const member = {
        knvb_id: row.knvb_id,
        email: row.email,
        stadion_id: row.stadion_id,
        photo_state: row.photo_state,
        data: JSON.parse(row.data_json)
      };

      const customer = prepareCustomer(member, freescoutDb, rondoClubDb, nikkiDb);
      if (customer) {
        customers.push(customer);
      } else {
        skippedNoEmail++;
      }
    }

    logVerbose(`Prepared ${customers.length} customers for FreeScout (${skippedNoEmail} skipped - no email)`);

    if (verbose && customers.length > 0) {
      logVerbose('Sample prepared customer:');
      logVerbose(JSON.stringify(customers[0], null, 2));
    }

    return {
      success: true,
      customers: customers
    };

  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error preparing FreeScout customers:', errorMsg);
    return { success: false, customers: [], error: errorMsg };
  } finally {
    // Close all database connections
    if (rondoClubDb) rondoClubDb.close();
    if (freescoutDb) freescoutDb.close();
    if (nikkiDb) nikkiDb.close();
  }
}

module.exports = { runPrepare };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const jsonOutput = process.argv.includes('--json');

  runPrepare({ verbose })
    .then(result => {
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exitCode = 1;
      } else if (jsonOutput) {
        console.log(JSON.stringify(result.customers, null, 2));
      } else if (!verbose) {
        // In default mode, print summary
        console.log(`Prepared ${result.customers.length} customers for FreeScout`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
