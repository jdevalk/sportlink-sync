require('varlock/auto-load');

const fastify = require('fastify');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const SqliteStore = require('fastify-session-better-sqlite3-store');
const { requireAuth, loginHandler, logoutHandler } = require('./auth');

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

  // GET / - Dashboard (requires auth, placeholder for Phase 37)
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.session.user;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard - Rondo Sync</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="dashboard">
    <header>
      <h1>Rondo Sync Dashboard</h1>
      <div class="user-info">
        <span>Welcome, ${user.displayName}</span>
        <form method="POST" action="/logout" style="display: inline; margin-left: 1rem;">
          <button type="submit">Logout</button>
        </form>
      </div>
    </header>
    <main>
      <p>Dashboard UI coming in Phase 37...</p>
    </main>
  </div>
</body>
</html>
    `;
    return reply.type('text/html').send(html);
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
