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
  clearMemberCommittees
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
 * Fetch functions for a single member
 * Captures both MemberFunctions and MemberCommittees API responses
 */
async function fetchMemberFunctions(page, knvbId, logger) {
  const functionsUrl = `https://club.sportlink.com/member/member-details/${knvbId}/functions`;

  // Log all navajo requests to understand the API pattern
  const seenUrls = [];
  const requestHandler = req => {
    if (req.url().includes('/navajo/')) {
      seenUrls.push(`${req.method()} ${req.url()}`);
    }
  };
  page.on('request', requestHandler);

  // Set up promises to wait for both responses (no method filter - could be GET or POST)
  const functionsPromise = page.waitForResponse(
    resp => resp.url().includes('MemberFunctions'),
    { timeout: 15000 }
  ).catch(() => null);

  const committeesPromise = page.waitForResponse(
    resp => resp.url().includes('MemberCommittees'),
    { timeout: 15000 }
  ).catch(() => null);

  logger.verbose(`  Navigating to ${functionsUrl}...`);
  await page.goto(functionsUrl, { waitUntil: 'networkidle' });

  // Wait for both responses (or timeout)
  const [functionsResponse, committeesResponse] = await Promise.all([
    functionsPromise,
    committeesPromise
  ]);

  // Clean up event listener
  page.removeListener('request', requestHandler);

  // Log what navajo requests we saw
  if (seenUrls.length > 0) {
    logger.verbose(`    Navajo requests seen: ${seenUrls.length}`);
    for (const url of seenUrls) {
      logger.verbose(`      ${url}`);
    }
  } else {
    logger.verbose(`    No navajo requests seen`);
  }

  // Parse the responses
  let functionsData = null;
  let committeesData = null;

  if (functionsResponse && functionsResponse.ok()) {
    try {
      functionsData = await functionsResponse.json();
      logger.verbose(`    Captured MemberFunctions response`);
    } catch (err) {
      logger.verbose(`    Error parsing MemberFunctions: ${err.message}`);
    }
  } else if (functionsResponse) {
    logger.verbose(`    MemberFunctions response not ok: ${functionsResponse.status()}`);
  }

  if (committeesResponse && committeesResponse.ok()) {
    try {
      committeesData = await committeesResponse.json();
      logger.verbose(`    Captured MemberCommittees response`);
    } catch (err) {
      logger.verbose(`    Error parsing MemberCommittees: ${err.message}`);
    }
  } else if (committeesResponse) {
    logger.verbose(`    MemberCommittees response not ok: ${committeesResponse.status()}`);
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
            // Debug: log the raw data structure
            const funcData = data?.MemberFunctions;
            const commData = data?.MemberCommittees;
            logger.verbose(`    MemberFunctions keys: ${funcData ? Object.keys(funcData).join(', ') : 'null'}`);
            logger.verbose(`    MemberCommittees keys: ${commData ? Object.keys(commData).join(', ') : 'null'}`);
            if (funcData?.Function) {
              logger.verbose(`    Function array length: ${funcData.Function.length}`);
            }

            const parsed = parseFunctionsResponse(data, member.knvb_id);

            if (parsed.functions.length > 0 || parsed.committees.length > 0) {
              allFunctions.push(...parsed.functions);
              allCommittees.push(...parsed.committees);

              // Collect unique committee names
              parsed.committees.forEach(c => uniqueCommitteeNames.add(c.committee_name));

              result.downloaded++;
              logger.verbose(`  Found ${parsed.functions.length} functions, ${parsed.committees.length} committees`);
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
