#!/usr/bin/env node
require('varlock/auto-load');

const postmark = require('postmark');
const fs = require('fs');

/**
 * Validate required environment variables
 * @returns {boolean} True if all required env vars are set
 */
function validateEnv() {
  const required = {
    POSTMARK_API_KEY: 'Postmark Server API Token',
    POSTMARK_FROM_EMAIL: 'Verified sender email address',
    OPERATOR_EMAIL: 'Recipient email address'
  };

  const missing = [];
  for (const [key, description] of Object.entries(required)) {
    if (!process.env[key]) {
      missing.push(`${key} (${description})`);
    }
  }

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(item => console.error(`  - ${item}`));
    return false;
  }

  return true;
}

/**
 * Escape HTML entities
 * @param {string} text - Raw text
 * @returns {string} HTML-safe text
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format plain text content as HTML email
 * Parses the structured sync output into semantic HTML
 * @param {string} textContent - Plain text content
 * @returns {string} HTML-formatted content
 */
function formatAsHtml(textContent) {
  const lines = textContent.split('\n');
  const htmlParts = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (we handle spacing with CSS)
    if (trimmed === '') {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      continue;
    }

    // Major divider (========) - skip, we use CSS for section styling
    if (/^=+$/.test(trimmed)) {
      continue;
    }

    // Minor divider (--------) - thin horizontal rule
    if (/^-+$/.test(trimmed)) {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      htmlParts.push('<hr class="minor">');
      continue;
    }

    // Main title (various sync summaries)
    if (/^(SPORTLINK|PEOPLE|PHOTO|TEAM|DISCIPLINE) SYNC SUMMARY$/.test(trimmed)) {
      htmlParts.push(`<h1>${escapeHtml(trimmed)}</h1>`);
      continue;
    }

    // Section headers (all caps) - handles TOTALS, PER-LIST BREAKDOWN, STADION SYNC, ERRORS, etc.
    if (/^[A-Z][A-Z\s()-]+$/.test(trimmed) && trimmed.length > 3) {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      htmlParts.push(`<h2>${escapeHtml(trimmed)}</h2>`);
      continue;
    }

    // List items (starting with -)
    if (trimmed.startsWith('- ')) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      htmlParts.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
      continue;
    }

    // Key-value lines (containing :)
    if (trimmed.includes(':') && !trimmed.startsWith('Log file:')) {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIndex);
      const value = trimmed.slice(colonIndex + 1).trim();
      htmlParts.push(`<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`);
      continue;
    }

    // Log file line - smaller, muted
    if (trimmed.startsWith('Log file:')) {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      htmlParts.push(`<p class="log-path">${escapeHtml(trimmed)}</p>`);
      continue;
    }

    // Default: regular paragraph
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
    htmlParts.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  if (inList) {
    htmlParts.push('</ul>');
  }

  const bodyContent = htmlParts.join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      max-width: 600px;
      color: #333;
      line-height: 1.5;
    }
    h1 {
      font-size: 20px;
      border-bottom: 2px solid #333;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 14px;
      color: #666;
      margin-top: 24px;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    /* First h2 after intro needs less top margin */
    h1 + * + h2, h1 + h2 {
      margin-top: 16px;
    }
    p {
      margin: 4px 0;
    }
    strong {
      color: #000;
    }
    ul {
      margin: 8px 0;
      padding-left: 20px;
    }
    li {
      margin: 4px 0;
    }
    hr.minor {
      border: none;
      border-top: 1px solid #ddd;
      margin: 16px 0;
    }
    .log-path {
      font-size: 12px;
      color: #999;
      margin-top: 24px;
    }
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

/**
 * Read log file content
 * @param {string} filePath - Path to log file
 * @returns {string|null} File content or null on error
 */
function readLogFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Failed to read log file ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Send email via Postmark
 * @param {string} logContent - Content to send in email body
 * @param {string} [syncType] - Optional sync type for subject line
 */
function sendEmail(logContent, syncType) {
  const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);

  const today = new Date().toISOString().split('T')[0];
  const typeLabel = syncType ? ` (${syncType})` : '';

  client.sendEmail({
    From: `Sportlink SYNC <${process.env.POSTMARK_FROM_EMAIL}>`,
    To: process.env.OPERATOR_EMAIL,
    Subject: `Sportlink Sync Report${typeLabel} - ${today}`,
    HtmlBody: formatAsHtml(logContent),
    TextBody: logContent
  })
    .then(() => {
      console.log('Email sent successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to send email:', error.message);
      process.exit(1);
    });
}

/**
 * Main entry point
 */
function main() {
  // Check for log file argument
  const logFilePath = process.argv[2];
  const syncType = process.argv[3]; // Optional: people, photos, teams, all

  if (!logFilePath) {
    console.error('Usage: node send-email.js <log-file-path> [sync-type]');
    console.error('');
    console.error('Sends the contents of a log file via Postmark email.');
    console.error('');
    console.error('Arguments:');
    console.error('  log-file-path  - Path to log file to send');
    console.error('  sync-type      - Optional: people, photos, teams, or all');
    console.error('');
    console.error('Required environment variables:');
    console.error('  POSTMARK_API_KEY      - Postmark Server API Token');
    console.error('  POSTMARK_FROM_EMAIL   - Verified sender email address');
    console.error('  OPERATOR_EMAIL        - Recipient email address');
    process.exit(1);
  }

  // Validate environment variables
  if (!validateEnv()) {
    process.exit(1);
  }

  // Read log file
  const logContent = readLogFile(logFilePath);
  if (logContent === null) {
    process.exit(1);
  }

  // Send email
  sendEmail(logContent, syncType);
}

main();
