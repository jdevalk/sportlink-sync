require('varlock/auto-load');

const otplib = require('otplib');
const { chromium } = require('playwright');
const {
  openDb,
  getAllTrackedMembers,
  upsertMemberFunctions,
  upsertMemberCommittees,
  upsertCommissies,
  clearMemberFunctions,
  clearMemberCommittees,
  upsertMemberFreeFields,
  clearMemberFreeFields
} = require('./lib/stadion-db');
const { createSyncLogger } = require('./lib/logger');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function createDebugLogger(enabled) {
  return (...args) => {
    if (enabled) {
      console.log(...args);
    }
  };
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

/**
 * Login to Sportlink (reuses pattern from download-photos-from-sportlink.js)
 */
async function loginToSportlink(page, logger) {
  const username = readEnv('SPORTLINK_USERNAME');
  const password = readEnv('SPORTLINK_PASSWORD');
  const otpSecret = readEnv('SPORTLINK_OTP_SECRET');

  if (!username || !password) {
    throw new Error('Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD');
  }

  logger.verbose('Navigating to Sportlink login page...');
  await page.goto('https://club.sportlink.com/', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#kc-login');

  logger.verbose('Waiting for OTP field...');
  await page.waitForSelector('#otp', { timeout: 20000 });

  if (!otpSecret) {
    throw new Error('Missing SPORTLINK_OTP_SECRET');
  }

  const otpCode = await otplib.generate({ secret: otpSecret });
  if (!otpCode) {
    throw new Error('OTP generation failed');
  }

  await page.fill('#otp', otpCode);
  await page.click('#kc-login');

  logger.verbose('Waiting for login to complete...');
  await page.waitForLoadState('networkidle');

  try {
    await page.waitForSelector('#panelHeaderTasks', { timeout: 30000 });
    logger.verbose('Login successful');
  } catch (error) {
    throw new Error('Login failed: Could not find dashboard element');
  }
}

/**
 * Parse functions API response
 * Expected structure (may vary - needs validation against real response):
 * {
 *   MemberFunctions: {
 *     Function: [{ FunctionDescription, RelationStart, RelationEnd, Status }]
 *   },
 *   MemberCommittees: {
 *     Committee: [{ CommitteeId, CommitteeName, CommitteeFunctionName, RelationStart, RelationEnd, Status }]
 *   }
 * }
 */
function parseFunctionsResponse(data, knvbId) {
  const functions = [];
  const committees = [];

  // Parse member functions
  const memberFunctions = data?.MemberFunctions?.Function || data?.Function || [];
  const funcArray = Array.isArray(memberFunctions) ? memberFunctions : [memberFunctions].filter(Boolean);

  for (const func of funcArray) {
    if (func.FunctionDescription) {
      functions.push({
        knvb_id: knvbId,
        function_description: func.FunctionDescription,
        relation_start: func.RelationStart || null,
        relation_end: func.RelationEnd || null,
        is_active: func.Status === 'ACTIVE' || func.Status === 'Actief' || !func.RelationEnd
      });
    }
  }

  // Parse member committees
  const memberCommittees = data?.MemberCommittees?.Committee || data?.Committee || [];
  const commArray = Array.isArray(memberCommittees) ? memberCommittees : [memberCommittees].filter(Boolean);

  for (const comm of commArray) {
    if (comm.CommitteeName) {
      committees.push({
        knvb_id: knvbId,
        committee_name: comm.CommitteeName,
        sportlink_committee_id: comm.PublicCommitteeId || comm.CommitteeId || null,
        role_name: comm.CommitteeFunctionName || comm.FunctionDescription || null,
        relation_start: comm.RelationStart || null,
        relation_end: comm.RelationEnd || null,
        is_active: comm.Status === 'ACTIVE' || comm.Status === 'Actief' || !comm.RelationEnd
      });
    }
  }

  return { functions, committees };
}

/**
 * Parse MemberFreeFields API response
 * Extracts Remarks3 (FreeScout ID) and Remarks8 (VOG datum)
 * @param {Object} data - MemberFreeFields API response
 * @param {string} knvbId - Member KNVB ID
 * @returns {{freescout_id: number|null, vog_datum: string|null}}
 */
function parseFreeFieldsResponse(data, knvbId) {
  const freeFields = data?.FreeFields || {};

  // Remarks3 = FreeScout ID (number)
  const remarks3 = freeFields.Remarks3?.Value;
  const freescoutId = remarks3 ? parseInt(remarks3, 10) : null;

  // Remarks8 = VOG datum (date string, format may vary)
  const remarks8 = freeFields.Remarks8?.Value;
  // Normalize date to YYYY-MM-DD if present
  let vogDatum = null;
  if (remarks8) {
    // Try to parse date - Sportlink may use various formats
    // Common formats: YYYY-MM-DD, DD-MM-YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(remarks8)) {
      vogDatum = remarks8;
    } else if (/^\d{2}-\d{2}-\d{4}$/.test(remarks8)) {
      // Convert DD-MM-YYYY to YYYY-MM-DD
      const [day, month, year] = remarks8.split('-');
      vogDatum = `${year}-${month}-${day}`;
    } else {
      // Store as-is if unknown format
      vogDatum = remarks8;
    }
  }

  return {
    knvb_id: knvbId,
    freescout_id: isNaN(freescoutId) ? null : freescoutId,
    vog_datum: vogDatum
  };
}

/**
 * Parse MemberHeader API response
 * Extracts financial block status and photo metadata
 * @param {Object} data - MemberHeader API response
 * @param {string} knvbId - Member KNVB ID
 * @returns {{has_financial_block: number, photo_url: string|null, photo_date: string|null}}
 */
function parseMemberHeaderResponse(data, knvbId) {
  // Handle null/missing Photo object gracefully
  const photoUrl = data?.Photo?.Url || null;
  const photoDate = data?.Photo?.PhotoDate || null;

  // Boolean to integer for SQLite (true -> 1, false/null -> 0)
  const hasFinancialBlock = data?.HasFinancialTransferBlockOwnClub === true ? 1 : 0;

  return {
    has_financial_block: hasFinancialBlock,
    photo_url: photoUrl,
    photo_date: photoDate
  };
}

/**
 * Fetch member data from the /other tab (both FreeFields and MemberHeader APIs)
 * @param {Object} page - Playwright page object
 * @param {string} knvbId - Member KNVB ID
 * @param {Object} logger - Logger instance
 * @returns {Promise<{knvb_id: string, freescout_id: number|null, vog_datum: string|null, has_financial_block: number, photo_url: string|null, photo_date: string|null}|null>}
 */
async function fetchMemberDataFromOtherPage(page, knvbId, logger) {
  const otherUrl = `https://club.sportlink.com/member/member-details/${knvbId}/other`;

  // Set up promises BEFORE navigation (existing pattern)
  const freeFieldsPromise = page.waitForResponse(
    resp => resp.url().includes('/remarks/MemberFreeFields?'),
    { timeout: 15000 }
  ).catch(() => null);

  // NEW: Add MemberHeader promise in parallel
  const memberHeaderPromise = page.waitForResponse(
    resp => resp.url().includes('/member/MemberHeader?'),
    { timeout: 15000 }
  ).catch(() => null);

  logger.verbose(`  Navigating to ${otherUrl}...`);
  await page.goto(otherUrl, { waitUntil: 'networkidle' });

  // Await both responses
  const [freeFieldsResponse, memberHeaderResponse] = await Promise.all([
    freeFieldsPromise,
    memberHeaderPromise
  ]);

  // Parse FreeFields response
  let freeFieldsData = null;
  if (freeFieldsResponse && freeFieldsResponse.ok()) {
    try {
      freeFieldsData = await freeFieldsResponse.json();
    } catch (err) {
      logger.verbose(`  Error parsing MemberFreeFields: ${err.message}`);
    }
  }

  // Parse MemberHeader response
  let memberHeaderData = null;
  if (memberHeaderResponse && memberHeaderResponse.ok()) {
    try {
      memberHeaderData = await memberHeaderResponse.json();
    } catch (err) {
      logger.verbose(`  Error parsing MemberHeader: ${err.message}`);
    }
  }

  // Merge both data sources
  if (!freeFieldsData && !memberHeaderData) {
    logger.verbose(`  No API responses captured`);
    return null;
  }

  const freeFieldsResult = freeFieldsData ? parseFreeFieldsResponse(freeFieldsData, knvbId) : { knvb_id: knvbId, freescout_id: null, vog_datum: null };
  const memberHeaderResult = memberHeaderData ? parseMemberHeaderResponse(memberHeaderData, knvbId) : { has_financial_block: 0, photo_url: null, photo_date: null };

  logger.verbose(`  Financial block: ${memberHeaderResult.has_financial_block}, Photo: ${memberHeaderResult.photo_url ? 'yes' : 'no'}`);

  return {
    knvb_id: knvbId,
    freescout_id: freeFieldsResult.freescout_id,
    vog_datum: freeFieldsResult.vog_datum,
    has_financial_block: memberHeaderResult.has_financial_block,
    photo_url: memberHeaderResult.photo_url,
    photo_date: memberHeaderResult.photo_date
  };
}

/**
 * Fetch functions for a single member
 * Captures both MemberFunctions and MemberCommittees API responses
 */
async function fetchMemberFunctions(page, knvbId, logger) {
  const functionsUrl = `https://club.sportlink.com/member/member-details/${knvbId}/functions`;

  // Set up promises to wait for both responses
  // Use precise URL matching to avoid capturing UnionMemberFunctions instead of MemberFunctions
  const functionsPromise = page.waitForResponse(
    resp => resp.url().includes('/function/MemberFunctions?'),
    { timeout: 15000 }
  ).catch(() => null);

  const committeesPromise = page.waitForResponse(
    resp => resp.url().includes('/function/MemberCommittees?'),
    { timeout: 15000 }
  ).catch(() => null);

  logger.verbose(`  Navigating to ${functionsUrl}...`);
  await page.goto(functionsUrl, { waitUntil: 'networkidle' });

  // Wait for both responses (or timeout)
  const [functionsResponse, committeesResponse] = await Promise.all([
    functionsPromise,
    committeesPromise
  ]);

  // Parse the responses
  let functionsData = null;
  let committeesData = null;

  if (functionsResponse && functionsResponse.ok()) {
    try {
      functionsData = await functionsResponse.json();
    } catch (err) {
      logger.verbose(`  Error parsing MemberFunctions: ${err.message}`);
    }
  }

  if (committeesResponse && committeesResponse.ok()) {
    try {
      committeesData = await committeesResponse.json();
    } catch (err) {
      logger.verbose(`  Error parsing MemberCommittees: ${err.message}`);
    }
  }

  // Combine the responses
  if (functionsData || committeesData) {
    return {
      MemberFunctions: functionsData,
      MemberCommittees: committeesData
    };
  }

  logger.verbose(`  No API responses captured`);
  return null;
}

/**
 * Main download orchestration
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, total: number, downloaded: number, functionsCount: number, committeesCount: number, errors: Array}>}
 */
async function runFunctionsDownload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    downloaded: 0,
    functionsCount: 0,
    committeesCount: 0,
    freeFieldsCount: 0,
    skipped: 0,
    errors: []
  };

  const db = openDb();
  try {
    // Get all tracked members (those already synced to Stadion)
    const members = getAllTrackedMembers(db);
    result.total = members.length;

    if (members.length === 0) {
      logger.log('No tracked members found. Run Stadion sync first.');
      return result;
    }

    logger.log(`Downloading functions for ${members.length} members`);

    // Clear existing data for fresh import
    clearMemberFunctions(db);
    clearMemberCommittees(db);
    clearMemberFreeFields(db);

    const debugEnabled = parseBool(readEnv('DEBUG_LOG', 'false'));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    if (debugEnabled) {
      const logDebug = createDebugLogger(true);
      page.on('request', r => logDebug('>>', r.method(), r.url()));
      page.on('response', r => logDebug('<<', r.status(), r.url()));
    }

    const allFunctions = [];
    const allCommittees = [];
    const allFreeFields = [];
    const uniqueCommitteeNames = new Set();

    try {
      await loginToSportlink(page, logger);

      // Process each member
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        logger.verbose(`Processing ${i + 1}/${members.length}: ${member.knvb_id}`);

        try {
          const data = await fetchMemberFunctions(page, member.knvb_id, logger);

          if (data) {
            const parsed = parseFunctionsResponse(data, member.knvb_id);

            if (parsed.functions.length > 0 || parsed.committees.length > 0) {
              allFunctions.push(...parsed.functions);
              allCommittees.push(...parsed.committees);

              // Collect unique committee names
              parsed.committees.forEach(c => uniqueCommitteeNames.add(c.committee_name));

              result.downloaded++;
              logger.verbose(`  Found ${parsed.functions.length} functions, ${parsed.committees.length} committees`);

              // Fetch free fields and MemberHeader data from /other tab for members with functions/committees
              // These members may have VOG certificates, FreeScout IDs, financial blocks, and photos
              logger.verbose(`  Fetching member data from /other page...`);
              const memberData = await fetchMemberDataFromOtherPage(page, member.knvb_id, logger);
              if (memberData && (memberData.freescout_id || memberData.vog_datum || memberData.has_financial_block || memberData.photo_url)) {
                allFreeFields.push(memberData);
                logger.verbose(`  Found FreeScout ID: ${memberData.freescout_id || 'none'}, VOG datum: ${memberData.vog_datum || 'none'}`);
              }
            } else {
              result.skipped++;
              logger.verbose(`  No functions or committees found`);
            }
          } else {
            result.skipped++;
            logger.verbose(`  No data returned`);
          }
        } catch (error) {
          result.errors.push({ knvb_id: member.knvb_id, message: error.message });
          logger.verbose(`  Error: ${error.message}`);
        }

        // Random delay between members to avoid rate limiting
        if (i < members.length - 1) {
          const delay = 500 + Math.random() * 1000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    } finally {
      await browser.close();
    }

    // Store to database
    if (allFunctions.length > 0) {
      upsertMemberFunctions(db, allFunctions);
      result.functionsCount = allFunctions.length;
    }

    if (allCommittees.length > 0) {
      upsertMemberCommittees(db, allCommittees);
      result.committeesCount = allCommittees.length;
    }

    if (allFreeFields.length > 0) {
      upsertMemberFreeFields(db, allFreeFields);
      result.freeFieldsCount = allFreeFields.length;
    }

    // Create commissie records from unique committee names
    // Plus add "Verenigingsbreed" for club-level functions
    const commissies = [
      { commissie_name: 'Verenigingsbreed', sportlink_id: null }
    ];
    for (const name of uniqueCommitteeNames) {
      commissies.push({ commissie_name: name, sportlink_id: null });
    }

    if (commissies.length > 0) {
      upsertCommissies(db, commissies);
      logger.verbose(`Created/updated ${commissies.length} commissies`);
    }

    // Summary
    logger.log(`Downloaded functions for ${result.downloaded}/${result.total} members`);
    logger.log(`  Functions found: ${result.functionsCount}`);
    logger.log(`  Committee memberships found: ${result.committeesCount}`);
    logger.log(`  Unique commissies: ${commissies.length}`);
    logger.log(`  Free fields (VOG/FreeScout): ${result.freeFieldsCount}`);

    if (result.errors.length > 0) {
      logger.log(`  Errors: ${result.errors.length}`);
      result.success = false;
    }

    return result;

  } finally {
    db.close();
  }
}

module.exports = { runFunctionsDownload };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  runFunctionsDownload({ verbose })
    .then(result => {
      if (!result.success) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
