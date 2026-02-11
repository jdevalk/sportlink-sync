const crypto = require('crypto');
const argon2 = require('argon2');
const { loadUsers } = require('./user-config');

/**
 * Fastify preHandler hook that requires authentication.
 * Redirects to /login if user is not logged in.
 * @param {FastifyRequest} request
 * @param {FastifyReply} reply
 */
async function requireAuth(request, reply) {
  if (!request.session.user) {
    return reply.redirect('/login');
  }
}

/**
 * Login handler for POST /login.
 * Validates credentials, creates session, and redirects to dashboard.
 * @param {FastifyRequest} request
 * @param {FastifyReply} reply
 */
async function loginHandler(request, reply) {
  const { username, password } = request.body || {};

  // Validate input
  if (!username || !password) {
    return reply.code(401).view('login', { error: 'Invalid username or password' });
  }

  // Load users from config
  let users;
  try {
    users = loadUsers();
  } catch (err) {
    request.log.error(`Failed to load user config: ${err.message}`);
    return reply.code(500).view('login', { error: 'Server configuration error' });
  }

  // Find user by username
  const user = users.find(u => u.username === username);
  if (!user) {
    // Generic error - don't reveal if username exists
    return reply.code(401).view('login', { error: 'Invalid username or password' });
  }

  // Verify password with Argon2
  let valid = false;
  try {
    valid = await argon2.verify(user.passwordHash, password);
  } catch (err) {
    request.log.error(`Password verification failed for ${username}: ${err.message}`);
    return reply.code(401).view('login', { error: 'Invalid username or password' });
  }

  if (!valid) {
    return reply.code(401).view('login', { error: 'Invalid username or password' });
  }

  // Session fixation prevention: regenerate session ID
  await request.session.regenerate();

  // Set session data
  request.session.user = {
    username: user.username,
    displayName: user.displayName
  };

  // Redirect to dashboard
  return reply.redirect('/');
}

/**
 * Logout handler for POST /logout.
 * Destroys session and redirects to login page.
 * @param {FastifyRequest} request
 * @param {FastifyReply} reply
 */
async function logoutHandler(request, reply) {
  // Destroy session
  await request.session.destroy();
  return reply.redirect('/login');
}

/**
 * Fastify preHandler hook that requires a valid API key.
 * Reads `X-Sync-API-Key` header and compares against SYNC_API_KEY env var.
 * @param {FastifyRequest} request
 * @param {FastifyReply} reply
 */
async function requireApiKey(request, reply) {
  const configuredKey = process.env.SYNC_API_KEY;
  if (!configuredKey) {
    return reply.code(503).send({ ok: false, error: 'API key not configured on server' });
  }

  const providedKey = request.headers['x-sync-api-key'];
  if (!providedKey) {
    return reply.code(401).send({ ok: false, error: 'Missing X-Sync-API-Key header' });
  }

  const a = Buffer.from(configuredKey);
  const b = Buffer.from(String(providedKey));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return reply.code(403).send({ ok: false, error: 'Invalid API key' });
  }
}

module.exports = {
  requireAuth,
  requireApiKey,
  loginHandler,
  logoutHandler
};
