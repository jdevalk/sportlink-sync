require('dotenv').config();

const otplib = require('otplib');
const { chromium } = require('playwright');
const { openDb, insertSportlinkRun } = require('./laposta-db');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function createLogger(enabled) {
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

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function main() {
  const username = readEnv('SPORTLINK_USERNAME');
  const password = readEnv('SPORTLINK_PASSWORD');
  const otpSecret = readEnv('SPORTLINK_OTP_SECRET');

  if (!username || !password) {
    throw new Error('Missing SPORTLINK_USERNAME or SPORTLINK_PASSWORD');
  }

  const debugEnabled = parseBool(readEnv('DEBUG_LOG', 'false'));
  const logDebug = createLogger(debugEnabled);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    if (debugEnabled) {
      page.on('request', r => logDebug('>>', r.method(), r.url()));
      page.on('response', r => logDebug('<<', r.status(), r.url()));
    }

    await page.goto('https://club.sportlink.com/', { waitUntil: 'domcontentloaded' });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#kc-login');

    await page.waitForSelector('#otp', { timeout: 20000 });
    if (!otpSecret) {
      throw new Error('Missing SPORTLINK_OTP_SECRET');
    }
    const otpCode = await otplib.generate({ secret: otpSecret });
    if (!otpCode) {
      throw new Error('OTP is required to continue');
    }
    await page.fill('#otp', otpCode);
    await page.click('#kc-login');

    await page.waitForLoadState('networkidle');

    logDebug('Waiting for login success selector: #panelHeaderTasks');
    try {
      await page.waitForSelector('#panelHeaderTasks', { timeout: 30000 });
    } catch (error) {
      throw error;
    }

    const memberSearchPageUrl = 'https://club.sportlink.com/member/search';
    logDebug('Navigating to member search page:', memberSearchPageUrl);
    await page.goto(memberSearchPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    const waitSeconds = Math.floor(Math.random() * 4) + 1; // Random between 1-5 seconds
    logDebug(`Waiting ${waitSeconds} seconds before clicking search button...`);
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    logDebug('Clicking show more button: #btnShowMore');
    await page.waitForSelector('#btnShowMore', { timeout: 20000 });
    await page.click('#btnShowMore');

    logDebug('Checking union teams checkbox: #scFetchUnionTeams_input');
    await page.waitForSelector('#scFetchUnionTeams_input', { timeout: 20000 });
    await page.check('#scFetchUnionTeams_input');

    // Set up listener for the SearchMembers POST response before clicking
    logDebug('Setting up response listener for SearchMembers POST request...');
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/navajo/entity/common/clubweb/member/search/SearchMembers') && resp.request().method() === 'POST',
      { timeout: 60000 } // 60 seconds timeout for long-running search requests
    );

    logDebug('Clicking search button: #btnSearch');
    await page.click('#btnSearch');

    const response = await responsePromise;
    logDebug('Search response received. Status:', response.status(), response.statusText());
    logDebug('Search response headers:', JSON.stringify(response.headers(), null, 2));
    
    if (!response.ok()) {
      let errorBody = '';
      try {
        errorBody = await response.text();
        logDebug('Search response body:', errorBody);
      } catch (e) {
        logDebug('Could not read response body:', e.message);
      }
      console.error('Search request failed:');
      console.error('  URL:', response.url());
      console.error('  Status:', response.status(), response.statusText());
      console.error('  Response body:', errorBody || '(empty)');
      throw new Error(`Search request failed (${response.status()} ${response.statusText()}): ${errorBody || 'No error details'}`);
    }
    const jsonData = await response.json();
    const jsonText = JSON.stringify(jsonData);
    const db = openDb();
    try {
      insertSportlinkRun(db, jsonText);
    } finally {
      db.close();
    }
    console.log('Results JSON saved to SQLite.');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
