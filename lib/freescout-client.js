require('varlock/auto-load');

const https = require('https');
const http = require('http');
const { URL } = require('url');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

/**
 * Check if FreeScout credentials are configured
 * @returns {{configured: boolean, missing: string[]}}
 */
function checkCredentials() {
  const apiKey = readEnv('FREESCOUT_API_KEY');
  const baseUrl = readEnv('FREESCOUT_BASE_URL');
  const missing = [];

  if (!apiKey) missing.push('FREESCOUT_API_KEY');
  if (!baseUrl) missing.push('FREESCOUT_BASE_URL');

  return {
    configured: missing.length === 0,
    missing
  };
}

/**
 * Make an authenticated request to FreeScout REST API
 * @param {string} endpoint - API endpoint (e.g., '/api/users/me')
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {Object|null} body - Request body (will be JSON stringified)
 * @param {Object} options - Optional parameters
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose] - Verbose mode
 * @returns {Promise<{status: number, body: any}>}
 */
function freescoutRequest(endpoint, method, body = null, options = {}) {
  return new Promise((resolve, reject) => {
    const { logger, verbose = false } = options;
    const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

    const creds = checkCredentials();
    if (!creds.configured) {
      reject(new Error(`Missing ${creds.missing.join(' and ')}`));
      return;
    }

    const apiKey = readEnv('FREESCOUT_API_KEY');
    const baseUrl = readEnv('FREESCOUT_BASE_URL');

    // Parse base URL
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch (err) {
      reject(new Error(`Invalid FREESCOUT_BASE_URL: ${baseUrl}`));
      return;
    }

    // Determine protocol module
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Build full path
    const fullPath = endpoint.startsWith('/')
      ? endpoint
      : `/${endpoint}`;

    logVerbose(`${method} ${fullPath}`);

    // Prepare request body
    const requestBody = body ? JSON.stringify(body) : null;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: fullPath,
      method: method.toUpperCase(),
      headers: {
        'X-FreeScout-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    };

    if (requestBody) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        logVerbose(`Response status: ${res.statusCode}`);

        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Non-JSON response
          parsed = data;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          const error = new Error(`FreeScout API error (${res.statusCode})`);
          error.status = res.statusCode;
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ETIMEDOUT') {
        const timeoutError = new Error('Request timeout: FreeScout API did not respond within 30 seconds');
        timeoutError.code = 'ETIMEDOUT';
        reject(timeoutError);
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const timeoutError = new Error('Request timeout: FreeScout API did not respond within 30 seconds');
      timeoutError.code = 'ETIMEDOUT';
      reject(timeoutError);
    });

    if (requestBody) {
      req.write(requestBody);
    }

    req.end();
  });
}

/**
 * Test connection to FreeScout API
 * @param {Object} options - Optional parameters
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose] - Verbose mode
 * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
 */
async function testConnection(options = {}) {
  const { logger, verbose = false } = options;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

  // First check if credentials are configured
  const creds = checkCredentials();
  if (!creds.configured) {
    return {
      success: false,
      error: `Missing ${creds.missing.join(' and/or ')}`
    };
  }

  try {
    logVerbose('Testing FreeScout connection...');

    // Request current user endpoint to verify credentials
    const response = await freescoutRequest('/api/users/me', 'GET', null, options);

    logVerbose(`Connected as: ${response.body.first_name || ''} ${response.body.last_name || ''}`);

    return {
      success: true,
      user: response.body
    };
  } catch (error) {
    const errorMessage = error.message || 'Connection failed';

    return {
      success: false,
      error: errorMessage,
      details: error.details
    };
  }
}

/**
 * Make a FreeScout request with retry logic for 5xx errors
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object|null} body - Request body
 * @param {Object} options - Optional parameters
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<{status: number, body: any}>}
 */
async function freescoutRequestWithRetry(endpoint, method, body = null, options = {}, maxRetries = 3) {
  const { logger, verbose = false } = options;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await freescoutRequest(endpoint, method, body, options);
    } catch (error) {
      lastError = error;
      const status = error.status;

      // Only retry on 5xx server errors
      if (!status || status < 500) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        logVerbose(`Server error (${status}), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

module.exports = { freescoutRequest, freescoutRequestWithRetry, testConnection, checkCredentials };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');

  testConnection({ verbose })
    .then((result) => {
      if (result.success) {
        console.log('FreeScout connection OK');
        if (verbose && result.user) {
          console.log(`User: ${result.user.first_name || ''} ${result.user.last_name || ''} (${result.user.email || 'no email'})`);
        }
        process.exitCode = 0;
      } else {
        console.error(`FreeScout connection FAILED: ${result.error}`);
        if (verbose && result.details) {
          console.error('Details:', JSON.stringify(result.details, null, 2));
        }
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('Unexpected error:', err.message);
      if (verbose) {
        console.error(err.stack);
      }
      process.exitCode = 1;
    });
}
