const { openDb } = require('./dashboard-db');

// Shared database connection (opened lazily, reused)
let db = null;

/**
 * Ensure database connection is open
 * @private
 */
function ensureDb() {
  if (!db) {
    db = openDb();
  }
  return db;
}

/**
 * Pipeline configurations with cron schedules and overdue thresholds
 * @private
 */
const PIPELINE_CONFIG = {
  people: { hours: 4, displayName: 'People' },
  nikki: { hours: 25, displayName: 'Nikki' },
  freescout: { hours: 25, displayName: 'FreeScout' },
  teams: { hours: 192, displayName: 'Teams' }, // 8 days
  functions: { hours: 4, displayName: 'Functions' },
  discipline: { hours: 192, displayName: 'Discipline' } // 8 days
};

/**
 * Get pipeline overview for all primary pipelines
 * @returns {Array<Object>} Array of pipeline objects with status
 */
function getPipelineOverview() {
  const database = ensureDb();
  const now = new Date();
  const pipelines = [];

  for (const [name, config] of Object.entries(PIPELINE_CONFIG)) {
    // Get latest run
    const run = database.prepare(`
      SELECT * FROM runs
      WHERE pipeline = ? AND club_slug = 'rondo'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(name);

    // Get last completed run (for previous duration display)
    const previousRun = database.prepare(`
      SELECT * FROM runs
      WHERE pipeline = ? AND club_slug = 'rondo' AND outcome IN ('success', 'failure')
      ORDER BY started_at DESC
      LIMIT 1
    `).get(name);

    // Compute overdue status
    let isOverdue = false;
    if (run && run.started_at) {
      const lastRun = new Date(run.started_at);
      const hoursSince = (now - lastRun) / (1000 * 60 * 60);
      isOverdue = hoursSince > config.hours;
    } else {
      // Never run = overdue
      isOverdue = true;
    }

    // Determine status
    let status = 'unknown';
    if (run) {
      status = run.outcome; // 'success', 'failure', 'running'
    }

    pipelines.push({
      name,
      displayName: config.displayName,
      status,
      isOverdue,
      lastRun: run || null,
      previousRun: previousRun || null
    });
  }

  return pipelines;
}

/**
 * Get paginated run history for a pipeline
 * @param {string} pipeline - Pipeline name
 * @param {number} page - Page number (1-indexed)
 * @param {number} perPage - Runs per page
 * @returns {Object} { runs: Array, totalRuns: number, totalPages: number }
 */
function getRunHistory(pipeline, page = 1, perPage = 20) {
  const database = ensureDb();

  // Get total count
  const countRow = database.prepare(`
    SELECT COUNT(*) as count FROM runs
    WHERE pipeline = ? AND club_slug = 'rondo'
  `).get(pipeline);
  const totalRuns = countRow.count;
  const totalPages = Math.ceil(totalRuns / perPage);

  // Get paginated runs
  const offset = (page - 1) * perPage;
  const runs = database.prepare(`
    SELECT * FROM runs
    WHERE pipeline = ? AND club_slug = 'rondo'
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(pipeline, perPage, offset);

  return {
    runs,
    totalRuns,
    totalPages,
    currentPage: page,
    perPage
  };
}

/**
 * Get run detail with steps and error count
 * @param {number} runId - Run ID
 * @returns {Object|null} { run: Object, steps: Array, errorCount: number }
 */
function getRunDetail(runId) {
  const database = ensureDb();

  // Get run
  const run = database.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
  if (!run) {
    return null;
  }

  // Get steps
  const steps = database.prepare(`
    SELECT * FROM run_steps
    WHERE run_id = ?
    ORDER BY started_at ASC
  `).all(runId);

  // Get error count
  const errorRow = database.prepare(`
    SELECT COUNT(*) as count FROM run_errors WHERE run_id = ?
  `).get(runId);
  const errorCount = errorRow.count;

  return {
    run,
    steps,
    errorCount
  };
}

/**
 * Get paginated errors with optional filters
 * @param {Object} options - Filter options
 * @param {string} [options.pipeline] - Pipeline name
 * @param {string} [options.dateFrom] - ISO date string (start of day)
 * @param {string} [options.dateTo] - ISO date string (end of day)
 * @param {number} [options.runId] - Run ID
 * @param {number} [options.page=1] - Page number (1-indexed)
 * @param {number} [options.perPage=20] - Results per page
 * @returns {Object} { errors: Array, totalErrors: number, totalPages: number }
 */
function getErrors(options = {}) {
  const database = ensureDb();
  const {
    pipeline,
    dateFrom,
    dateTo,
    runId,
    page = 1,
    perPage = 20
  } = options;

  // Build WHERE clause dynamically
  const whereConditions = ['runs.club_slug = ?'];
  const params = ['rondo'];

  if (pipeline) {
    whereConditions.push('runs.pipeline = ?');
    params.push(pipeline);
  }

  if (dateFrom) {
    whereConditions.push('run_errors.created_at >= ?');
    params.push(dateFrom);
  }

  if (dateTo) {
    // Add time to include full day
    whereConditions.push('run_errors.created_at <= ?');
    params.push(dateTo + 'T23:59:59');
  }

  if (runId) {
    whereConditions.push('run_errors.run_id = ?');
    params.push(runId);
  }

  const whereClause = whereConditions.join(' AND ');

  // Get total count
  const countRow = database.prepare(`
    SELECT COUNT(*) as count FROM run_errors
    JOIN runs ON run_errors.run_id = runs.id
    WHERE ${whereClause}
  `).get(...params);
  const totalErrors = countRow.count;
  const totalPages = Math.ceil(totalErrors / perPage);

  // Get paginated errors
  const offset = (page - 1) * perPage;
  const errors = database.prepare(`
    SELECT
      run_errors.id,
      run_errors.run_id,
      run_errors.step_name,
      run_errors.member_identifier,
      run_errors.error_message,
      run_errors.created_at,
      runs.pipeline
    FROM run_errors
    JOIN runs ON run_errors.run_id = runs.id
    WHERE ${whereClause}
    ORDER BY run_errors.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  return {
    errors,
    totalErrors,
    totalPages,
    currentPage: page,
    perPage
  };
}

/**
 * Get all errors for a specific run
 * @param {number} runId - Run ID
 * @returns {Object|null} { run: Object, errors: Array }
 */
function getRunErrors(runId) {
  const database = ensureDb();

  // Get run
  const run = database.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
  if (!run) {
    return null;
  }

  // Get all errors for this run
  const errors = database.prepare(`
    SELECT * FROM run_errors
    WHERE run_id = ?
    ORDER BY created_at ASC
  `).all(runId);

  return {
    run,
    errors
  };
}

/**
 * Close database connection (for clean shutdown)
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getPipelineOverview,
  getRunHistory,
  getRunDetail,
  getErrors,
  getRunErrors,
  closeDb
};

// CLI self-test
if (require.main === module) {
  console.log('Running dashboard-queries self-test...\n');

  console.log('Testing getPipelineOverview():');
  const overview = getPipelineOverview();
  console.log(`  Found ${overview.length} pipelines`);
  overview.forEach(p => {
    console.log(`  - ${p.displayName}: status=${p.status}, overdue=${p.isOverdue}, lastRun=${p.lastRun ? p.lastRun.started_at : 'never'}`);
  });

  console.log('\nTesting getRunHistory():');
  const history = getRunHistory('people', 1, 5);
  console.log(`  Total runs: ${history.totalRuns}, showing ${history.runs.length}`);
  if (history.runs.length > 0) {
    console.log(`  Latest run: ${history.runs[0].started_at} (outcome: ${history.runs[0].outcome})`);
  }

  console.log('\nTesting getRunDetail():');
  if (history.runs.length > 0) {
    const detail = getRunDetail(history.runs[0].id);
    if (detail) {
      console.log(`  Run ${detail.run.id}: ${detail.steps.length} steps, ${detail.errorCount} errors`);
    }
  } else {
    console.log('  No runs found to test detail');
  }

  closeDb();
  console.log('\nSelf-test complete!');
}
