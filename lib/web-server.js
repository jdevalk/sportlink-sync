require('varlock/auto-load');

const fastify = require('fastify');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const SqliteStore = require('fastify-session-better-sqlite3-store');
const { requireAuth, loginHandler, logoutHandler } = require('./auth');
const { getPipelineOverview, getRunHistory, getRunDetail, closeDb } = require('./dashboard-queries');

/**
 * Build and configure Fastify server with all plugins and routes.
 * @returns {Promise<FastifyInstance>}
 */
async function buildServer() {
  // Create Fastify instance
  const app = fastify({
    logger: true,
    trustProxy: true // Required for rate limiting behind nginx
  });

  // Validate SESSION_SECRET
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32');
  }

  // Ensure data directory exists for session database
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Register @fastify/cookie (required by @fastify/session)
  await app.register(require('@fastify/cookie'));

  // Register @fastify/formbody (parse POST form data)
  await app.register(require('@fastify/formbody'));

  // Create SQLite database for sessions
  const sessionDb = new Database(path.join(dataDir, 'sessions.sqlite'));

  // Register @fastify/session with SQLite store
  await app.register(require('@fastify/session'), {
    secret: sessionSecret,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    },
    store: new SqliteStore(sessionDb)
  });

  // Register @fastify/rate-limit (not global - per-route)
  await app.register(require('@fastify/rate-limit'), {
    global: false
  });

  // Register @fastify/static (serve static files from public/)
  await app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/public/'
  });

  // Register @fastify/view with EJS templates
  await app.register(require('@fastify/view'), {
    engine: {
      ejs: require('ejs')
    },
    root: path.join(__dirname, '..', 'views')
  });

  // Routes

  // GET /login - Login page (unauthenticated)
  app.get('/login', async (request, reply) => {
    // If already logged in, redirect to dashboard
    if (request.session.user) {
      return reply.redirect('/');
    }
    return reply.view('login', { error: null });
  });

  // POST /login - Login handler (rate limited)
  app.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, loginHandler);

  // POST /logout - Logout handler (requires auth)
  app.post('/logout', { preHandler: requireAuth }, logoutHandler);

  // GET /health - Health check (unauthenticated, for monitoring)
  app.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Helper: Format relative time
  function formatRelativeTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  // Helper: Format duration
  function formatDuration(ms) {
    if (!ms) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  // GET / - Dashboard overview (requires auth)
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const pipelines = getPipelineOverview();
    return reply.view('overview', {
      title: 'Dashboard',
      page: 'overview',
      user: request.session.user,
      pipelines,
      formatRelativeTime,
      formatDuration
    });
  });

  // Register onClose hook for clean shutdown
  app.addHook('onClose', async () => {
    closeDb();
  });

  return app;
}

module.exports = { buildServer };

// CLI: Start server
if (require.main === module) {
  const HOST = process.env.WEB_HOST || '127.0.0.1';
  const PORT = parseInt(process.env.WEB_PORT || '3000', 10);

  buildServer().then(server => {
    server.listen({ port: PORT, host: HOST }, (err) => {
      if (err) {
        server.log.error(err);
        process.exit(1);
      }
    });
  }).catch(err => {
    console.error('Failed to build server:', err);
    process.exit(1);
  });
}
