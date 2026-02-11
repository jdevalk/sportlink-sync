/**
 * Shared HTTP client for making authenticated API requests.
 *
 * Consolidates common HTTP request logic used by rondo-club-client and freescout-client.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { createLoggerAdapter } = require('./log-adapters');

const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Make an authenticated HTTP request.
 *
 * @param {Object} config - Request configuration
 * @param {string} config.baseUrl - Base URL for the API
 * @param {string} config.endpoint - API endpoint path
 * @param {string} config.method - HTTP method (GET, POST, PUT, DELETE)
 * @param {Object} [config.body] - Request body (will be JSON stringified)
 * @param {Object} [config.headers] - Custom headers to include
 * @param {string} [config.apiName='API'] - API name for error messages
 * @param {number} [config.timeout=30000] - Request timeout in milliseconds
 * @param {Object} [config.options] - Additional options (logger, verbose)
 * @returns {Promise<{status: number, body: any}>}
 */
function makeRequest(config) {
  return new Promise((resolve, reject) => {
    const {
      baseUrl,
      endpoint,
      method,
      body = null,
      headers = {},
      apiName = 'API',
      timeout = DEFAULT_TIMEOUT,
      options = {}
    } = config;

    const { logger, verbose = false } = options;
    const { verbose: logVerbose } = createLoggerAdapter({ logger, verbose });

    // Parse base URL
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch (err) {
      reject(new Error(`Invalid base URL: ${baseUrl}`));
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
        'Content-Type': 'application/json',
        ...headers
      },
      timeout
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
          const error = new Error(`${apiName} error (${res.statusCode})`);
          error.status = res.statusCode;
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ETIMEDOUT') {
        const timeoutError = new Error(`Request timeout: ${apiName} did not respond within ${timeout / 1000} seconds`);
        timeoutError.code = 'ETIMEDOUT';
        reject(timeoutError);
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const timeoutError = new Error(`Request timeout: ${apiName} did not respond within ${timeout / 1000} seconds`);
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
 * Create Basic Auth header value.
 * @param {string} username
 * @param {string} password
 * @returns {string} Authorization header value
 */
function createBasicAuthHeader(username, password) {
  const authString = `${username}:${password}`;
  return `Basic ${Buffer.from(authString).toString('base64')}`;
}

module.exports = {
  makeRequest,
  createBasicAuthHeader,
  DEFAULT_TIMEOUT
};
