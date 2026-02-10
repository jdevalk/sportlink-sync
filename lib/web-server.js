require('varlock/auto-load');

const fastify = require('fastify');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const SqliteStore = require('fastify-session-better-sqlite3-store');
const { requireAuth, loginHandler, logoutHandler } = require('./auth');
const { getPipelineOverview, getRunHistory, getRunDetail, getErrors, getRunErrors, isPipelineRunning, clearAllLogs, closeDb } = require('./dashboard-queries');
const { checkAndAlertOverdue } = require('./alert-email');

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

  // Helper: Format next run time
  function formatNextRun(nextRunObj) {
    if (!nextRunObj) return '';
    const formatted = nextRunObj.time.toLocaleString('en-US', {
      timeZone: 'Europe/Amsterdam',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return formatted;
  }

  // Known pipelines for validation
  const KNOWN_PIPELINES = {
    people: 'People',
    nikki: 'Nikki',
    freescout: 'FreeScout',
    teams: 'Teams',
    functions: 'Member roles + VOG',
    'functions-full': 'Member roles (full)',
    discipline: 'Discipline',
    'former-members': 'Former members'
  };

  // GET / - Dashboard overview (requires auth)
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const pipelines = getPipelineOverview();
    return reply.view('overview', {
      title: 'Dashboard',
      page: 'overview',
      user: request.session.user,
      pipelines,
      formatRelativeTime,
      formatDuration,
      formatNextRun
    });
  });

  // GET /pipeline/:name - Run history for a pipeline (requires auth)
  app.get('/pipeline/:name', { preHandler: requireAuth }, async (request, reply) => {
    const pipelineName = request.params.name;

    // Validate pipeline name
    if (!KNOWN_PIPELINES[pipelineName]) {
      return reply.code(404).send('Pipeline not found');
    }

    // Parse page parameter
    const page = parseInt(request.query.page || '1', 10);
    if (isNaN(page) || page < 1) {
      return reply.code(400).send('Invalid page parameter');
    }

    // Get run history
    const history = getRunHistory(pipelineName, page, 20);

    return reply.view('run-history', {
      title: `${KNOWN_PIPELINES[pipelineName]} - Run History`,
      page: 'overview',
      user: request.session.user,
      pipelineName,
      pipelineDisplayName: KNOWN_PIPELINES[pipelineName],
      runs: history.runs,
      pagination: {
        current: history.currentPage,
        total: history.totalPages,
        perPage: history.perPage,
        totalRuns: history.totalRuns
      },
      formatDuration
    });
  });

  // POST /api/pipeline/:name/start - Trigger a pipeline run (requires auth)
  app.post('/api/pipeline/:name/start', { preHandler: requireAuth }, async (request, reply) => {
    const pipelineName = request.params.name;

    if (!KNOWN_PIPELINES[pipelineName]) {
      return reply.code(404).send({ ok: false, error: 'Unknown pipeline' });
    }

    // Prevent starting a pipeline that's already running
    if (isPipelineRunning(pipelineName)) {
      return reply.code(409).send({ ok: false, error: 'Pipeline is already running' });
    }

    try {
      const projectRoot = path.join(__dirname, '..');

      // Map dashboard pipeline names to sync.sh arguments
      const PIPELINE_ARGS = {
        'functions-full': ['functions', '--all', '--with-invoice'],
        'former-members': ['former-members']
      };
      const args = PIPELINE_ARGS[pipelineName] || [pipelineName];

      // Use systemd-run to launch as a transient service, so the process
      // survives web server restarts and isn't killed with the service.
      const child = spawn('systemd-run', [
        '--quiet',
        `--unit=rondo-sync-${pipelineName}`,
        '--working-directory', projectRoot,
        'scripts/sync.sh', ...args
      ], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      app.log.info(`Pipeline "${pipelineName}" started by ${request.session.user} via systemd-run`);
      return { ok: true, pipeline: pipelineName };
    } catch (err) {
      app.log.error(`Failed to start pipeline "${pipelineName}": ${err.message}`);
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // GET /run/:id - Run detail (requires auth)
  app.get('/run/:id', { preHandler: requireAuth }, async (request, reply) => {
    const runId = parseInt(request.params.id, 10);
    if (isNaN(runId)) {
      return reply.code(400).send('Invalid run ID');
    }

    // Get run detail
    const detail = getRunDetail(runId);
    if (!detail) {
      return reply.code(404).send('Run not found');
    }

    return reply.view('run-detail', {
      title: `Run #${runId}`,
      page: 'overview',
      user: request.session.user,
      run: detail.run,
      pipelineDisplayName: KNOWN_PIPELINES[detail.run.pipeline] || detail.run.pipeline,
      steps: detail.steps,
      errorCount: detail.errorCount,
      formatDuration
    });
  });

  // GET /errors - Error browser with filters (requires auth)
  app.get('/errors', { preHandler: requireAuth }, async (request, reply) => {
    // Parse query parameters
    const pipeline = request.query.pipeline || '';
    const dateFrom = request.query.date_from || '';
    const dateTo = request.query.date_to || '';
    const runId = request.query.run_id ? parseInt(request.query.run_id, 10) : null;
    const page = parseInt(request.query.page || '1', 10);

    if (isNaN(page) || page < 1) {
      return reply.code(400).send('Invalid page parameter');
    }

    // Build filter object
    const filters = {
      pipeline: pipeline || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      runId: runId || null,
      page
    };

    // Get errors
    const result = getErrors(filters);

    return reply.view('errors', {
      title: 'Error Browser',
      page: 'errors',
      user: request.session.user,
      errors: result.errors,
      totalErrors: result.totalErrors,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      filters: {
        pipeline,
        dateFrom,
        dateTo,
        runId,
        page
      }
    });
  });

  // GET /errors/:runId - Error detail for a specific run (requires auth)
  app.get('/errors/:runId', { preHandler: requireAuth }, async (request, reply) => {
    const runId = parseInt(request.params.runId, 10);
    if (isNaN(runId)) {
      return reply.code(400).send('Invalid run ID');
    }

    // Get run errors
    const result = getRunErrors(runId);
    if (!result) {
      return reply.code(404).send('Run not found');
    }

    return reply.view('error-detail', {
      title: `Errors for Run #${runId}`,
      page: 'errors',
      user: request.session.user,
      run: result.run,
      pipelineDisplayName: KNOWN_PIPELINES[result.run.pipeline] || result.run.pipeline,
      errors: result.errors
    });
  });

  // POST /api/logs/clear - Clear all logs (requires auth)
  app.post('/api/logs/clear', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = clearAllLogs();
      app.log.info(`Logs cleared by ${request.session.user}: ${result.runs} runs, ${result.steps} steps, ${result.errors} errors`);
      return reply.redirect('/errors');
    } catch (err) {
      app.log.error(`Failed to clear logs: ${err.message}`);
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // Periodic overdue pipeline check (every 30 minutes)
  const overdueInterval = setInterval(() => {
    checkAndAlertOverdue().catch(err => {
      app.log.error(`Overdue check failed: ${err.message}`);
    });
  }, 30 * 60 * 1000); // 30 minutes

  // Initial overdue check after 10-second startup delay
  setTimeout(() => {
    checkAndAlertOverdue().catch(err => {
      app.log.error(`Initial overdue check failed: ${err.message}`);
    });
  }, 10000);

  // Register onClose hook for clean shutdown
  app.addHook('onClose', async () => {
    clearInterval(overdueInterval);
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
