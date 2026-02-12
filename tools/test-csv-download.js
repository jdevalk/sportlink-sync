// TEST SCRIPT - Download CSV and examine structure WITHOUT writing to database
require('dotenv/config');

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');
const { parse } = require('csv-parse');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function generateTotpFromSecret(secretValue) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', Buffer.from(secretValue, 'ascii')).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

async function loginToNikki(page) {
  const username = readEnv('NIKKI_USERNAME');
  const password = readEnv('NIKKI_PASSWORD');
  const otpSecret = readEnv('NIKKI_OTP_SECRET');

  if (!username || !password) {
    throw new Error('Missing NIKKI_USERNAME or NIKKI_PASSWORD');
  }

  console.log('Navigating to Nikki login page...');
  await page.goto('https://mijn.nikki-online.nl/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]', { timeout: 15000 });

  console.log('Filling credentials...');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);

  const otpField = await page.$('input[name="otp"]');
  if (otpField && otpSecret) {
    const otpCode = generateTotpFromSecret(otpSecret);
    await otpField.fill(otpCode);
  }

  await page.waitForTimeout(3000);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL((url) => !url.includes('login'), { timeout: 15000 }).catch(() => null);
  console.log('Logged in');
}

async function downloadCsv(page) {
  console.log('Navigating to /leden...');
  await page.waitForTimeout(1000);
  await page.goto('https://mijn.nikki-online.nl/leden', { waitUntil: 'domcontentloaded' });

  const downloadsDir = path.join(process.cwd(), 'downloads');
  await fs.mkdir(downloadsDir, { recursive: true });

  // First, check what elements are available
  console.log('Looking for Rapporten elements...');
  const allLinks = await page.$$eval('a, button', elements =>
    elements.map(el => ({ tag: el.tagName, text: el.textContent?.trim(), href: el.href }))
  );
  console.log('Links containing "rapport" or "export":',
    allLinks.filter(l => l.text?.toLowerCase().includes('rapport') || l.text?.toLowerCase().includes('export') || l.href?.includes('rapport') || l.href?.includes('export'))
  );

  console.log('Setting up download listener...');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

  console.log('Clicking Rapporten link...');
  const rapportenSelectors = [
    'a:has-text("Rapporten")',
    'button:has-text("Rapporten")',
    '[href*="rapport"]',
    'a[href*="export"]',
    'a:has-text("Export")',
    'button:has-text("Export")'
  ];

  let clicked = false;
  for (const selector of rapportenSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log(`Found element with selector: ${selector}`);
        const text = await element.textContent();
        const href = await element.getAttribute('href');
        console.log(`  Text: ${text}, Href: ${href}`);

        await element.click();
        clicked = true;
        console.log(`Clicked: ${selector}`);
        break;
      }
    } catch (e) {
      console.log(`Selector ${selector} failed: ${e.message}`);
      continue;
    }
  }

  if (!clicked) {
    throw new Error('Could not find Rapporten link');
  }

  console.log('Waiting for download...');
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename() || 'nikki-export.csv';
  const filePath = path.join(downloadsDir, suggestedFilename);
  await download.saveAs(filePath);
  console.log(`Downloaded to: ${filePath}`);

  return filePath;
}

async function parseCsv(filePath) {
  console.log('Parsing CSV...');
  const records = await new Promise((resolve, reject) => {
    const rows = [];
    require('fs').createReadStream(filePath)
      .pipe(parse({
        columns: true,
        delimiter: ';',
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        quote: false
      }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });

  // Clean quotes
  const cleaned = records.map(row => {
    const c = {};
    for (const [key, value] of Object.entries(row)) {
      const cleanKey = key.replace(/^"|"$/g, '');
      const cleanValue = typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
      c[cleanKey] = cleanValue;
    }
    return c;
  });

  return cleaned;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  try {
    await loginToNikki(page);
    const csvPath = await downloadCsv(page);
    const records = await parseCsv(csvPath);

    console.log('\n=== CSV STRUCTURE ===');
    console.log('Total records:', records.length);
    if (records.length > 0) {
      console.log('Columns:', Object.keys(records[0]).join(', '));
    }

    // Find MMXL50W
    const mmxl50w = records.filter(r => {
      const lidnr = r.lid_nr || r.lidnr || r.LidNr || r['Lid nr'] || r.Lidnr || r['Lidnr.'];
      return lidnr === 'MMXL50W';
    });

    console.log('\n=== MMXL50W ENTRIES ===');
    console.log('Count:', mmxl50w.length);
    mmxl50w.forEach((entry, idx) => {
      console.log(`\nEntry ${idx + 1}:`, JSON.stringify(entry, null, 2));
    });

    // Check for 2025 entries specifically
    const mmxl2025 = mmxl50w.filter(r => {
      const jaar = r.jaar || r.Jaar || r.year || r.Year;
      return jaar === '2025';
    });
    console.log('\n=== 2025 ENTRIES FOR MMXL50W ===');
    console.log('Count:', mmxl2025.length);

    // Keep file for inspection
    console.log(`\nCSV saved at: ${csvPath}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
