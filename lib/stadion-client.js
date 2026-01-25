require('varlock/auto-load');

const https = require('https');
const { URL } = require('url');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

/**
 * Validate Stadion credentials exist
 * @throws {Error} If credentials are missing or invalid
 */
function validateCredentials() {
  const url = readEnv('STADION_URL');
  const username = readEnv('STADION_USERNAME');
  const password = readEnv('STADION_APP_PASSWORD');

  if (!url || !username || !password) {
    throw new Error('STADION_URL, STADION_USERNAME, and STADION_APP_PASSWORD required in .env');
  }

  if (!url.startsWith('https://')) {
    throw new Error('STADION_URL must start with https://');
  }
}

/**
 * Make an authenticated request to Stadion WordPress REST API
 * @param {string} endpoint - API endpoint (e.g., 'wp/v2/users/me' or full path)
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {Object|null} body - Request body (will be JSON stringified)
 * @param {Object} options - Optional parameters
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose] - Verbose mode
 * @returns {Promise<{status: number, body: any}>}
 */
function stadionRequest(endpoint, method, body = null, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      validateCredentials();
    } catch (error) {
      reject(error);
      return;
    }

    const { logger, verbose = false } = options;
    const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

    const baseUrl = readEnv('STADION_URL');
    const username = readEnv('STADION_USERNAME');
    const password = readEnv('STADION_APP_PASSWORD');

    // Build Basic Auth header
    const authString = `${username}:${password}`;
    const authHeader = `Basic ${Buffer.from(authString).toString('base64')}`;

    // Parse base URL and build full path
    const parsedUrl = new URL(baseUrl);
    const fullPath = endpoint.startsWith('/')
      ? endpoint
      : `/wp-json/${endpoint}`;

    logVerbose(`${method} ${fullPath}`);

    // Prepare request body
    const requestBody = body ? JSON.stringify(body) : null;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: fullPath,
      method: method.toUpperCase(),
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    };

    if (requestBody) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = https.request(requestOptions, (res) => {
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
          const error = new Error(`Stadion API error (${res.statusCode})`);
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ETIMEDOUT') {
        const timeoutError = new Error('Request timeout: Stadion API did not respond within 30 seconds');
        timeoutError.code = 'ETIMEDOUT';
        reject(timeoutError);
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const timeoutError = new Error('Request timeout: Stadion API did not respond within 30 seconds');
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
 * Parse WordPress error response
 * @param {Object|string} errorBody - Error response from WordPress
 * @returns {Object} Normalized error object
 */
function parseWordPressError(errorBody) {
  if (typeof errorBody === 'string') {
    return {
      code: 'unknown',
      message: errorBody,
      status: null
    };
  }

  if (errorBody && typeof errorBody === 'object') {
    return {
      code: errorBody.code || 'unknown',
      message: errorBody.message || JSON.stringify(errorBody),
      status: errorBody.data?.status || errorBody.status || null
    };
  }

  return {
    code: 'unknown',
    message: 'Unknown error',
    status: null
  };
}

/**
 * Test connection to Stadion WordPress REST API
 * @param {Object} options - Optional parameters
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose] - Verbose mode
 * @returns {Promise<{success: boolean, name?: string, url?: string, error?: string, details?: Object}>}
 */
async function testConnection(options = {}) {
  const { logger, verbose = false } = options;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});
  const logError = logger ? logger.error.bind(logger) : () => {};

  try {
    logVerbose('Testing Stadion connection...');

    // Request WordPress REST API root endpoint
    const response = await stadionRequest('', 'GET', null, options);

    const siteName = response.body.name || 'Unknown Site';
    const siteUrl = response.body.url || readEnv('STADION_URL');

    logVerbose(`Connected to: ${siteName}`);

    return {
      success: true,
      name: siteName,
      url: siteUrl
    };
  } catch (error) {
    const wpError = parseWordPressError(error.details);
    const errorMessage = error.message || 'Connection failed';

    logError(`Connection failed: ${errorMessage}`);
    if (error.details) {
      logVerbose(`Error details: ${JSON.stringify(wpError)}`);
    }

    return {
      success: false,
      error: errorMessage,
      details: wpError
    };
  }
}

module.exports = { stadionRequest, testConnection };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');

  testConnection({ verbose })
    .then((result) => {
      if (result.success) {
        console.log(`Stadion connection OK: ${result.name}`);
        if (verbose) {
          console.log(`URL: ${result.url}`);
        }
        process.exitCode = 0;
      } else {
        console.error(`Stadion connection FAILED: ${result.error}`);
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
