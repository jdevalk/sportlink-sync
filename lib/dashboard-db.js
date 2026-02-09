const path = require('path');
const Database = require('better-sqlite3');
const { nowISO } = require('./utils');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'dashboard.sqlite');

// Track if migration has been checked (per process)
let migrationChecked = false;

/**
 * Open database connection and initialize schema.
 * @param {string} [dbPath] - Database file path
 * @returns {Database} Database instance
 */
function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initDb(db);
  return db;
}

/**
 * Initialize database schema for run tracking.
 * @param {Database} db - Database instance
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      club_slug TEXT NOT NULL DEFAULT 'rondo',
      pipeline TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      outcome TEXT CHECK(outcome IN ('success', 'failure', 'running', 'partial')),
      total_created INTEGER DEFAULT 0,
      total_updated INTEGER DEFAULT 0,
      total_skipped INTEGER DEFAULT 0,
      total_failed INTEGER DEFAULT 0,
      summary_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_club_pipeline
      ON runs (club_slug, pipeline, started_at);

    CREATE TABLE IF NOT EXISTS run_steps (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      club_slug TEXT NOT NULL DEFAULT 'rondo',
      step_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      outcome TEXT CHECK(outcome IN ('success', 'failure', 'skipped', 'partial')),
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      detail_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_run_steps_run_id
      ON run_steps (run_id);

    CREATE TABLE IF NOT EXISTS run_errors (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      run_step_id INTEGER REFERENCES run_steps(id),
      club_slug TEXT NOT NULL DEFAULT 'rondo',
      step_name TEXT NOT NULL,
      member_identifier TEXT,
      error_message TEXT NOT NULL,
      error_stack TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_errors_run_id
      ON run_errors (run_id);

    CREATE INDEX IF NOT EXISTS idx_run_errors_club_step
      ON run_errors (club_slug, step_name, created_at);
  `);

  // Migration: expand outcome CHECK constraint to include 'partial'
  // Only check once per process to avoid race conditions
  if (!migrationChecked) {
    migrationChecked = true;

    // Only migrate if table EXISTS and doesn't support 'partial'
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").get();

    let needsMigration = false;
    if (tableExists) {
      try {
        db.exec("BEGIN");
        db.exec("INSERT INTO runs (pipeline, started_at, outcome) VALUES ('__test__', '2000-01-01', 'partial')");
        db.exec("DELETE FROM runs WHERE pipeline = '__test__'");
        db.exec("COMMIT");
      } catch (e) {
        // 'partial' not yet in CHECK constraint - need migration
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          // Ignore rollback errors
        }
        needsMigration = true;
      }
    }

    if (needsMigration) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;

      -- Migrate runs table
      ALTER TABLE runs RENAME TO runs_old;

      CREATE TABLE runs (
        id INTEGER PRIMARY KEY,
        club_slug TEXT NOT NULL DEFAULT 'rondo',
        pipeline TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        outcome TEXT CHECK(outcome IN ('success', 'failure', 'running', 'partial')),
        total_created INTEGER DEFAULT 0,
        total_updated INTEGER DEFAULT 0,
        total_skipped INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0,
        summary_json TEXT
      );

      INSERT INTO runs SELECT * FROM runs_old;
      DROP TABLE runs_old;

      CREATE INDEX IF NOT EXISTS idx_runs_club_pipeline
        ON runs (club_slug, pipeline, started_at);

      -- Migrate run_steps table
      ALTER TABLE run_steps RENAME TO run_steps_old;

      CREATE TABLE run_steps (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        club_slug TEXT NOT NULL DEFAULT 'rondo',
        step_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        outcome TEXT CHECK(outcome IN ('success', 'failure', 'skipped', 'partial')),
        created_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        skipped_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        detail_json TEXT
      );

      INSERT INTO run_steps SELECT * FROM run_steps_old;
      DROP TABLE run_steps_old;

      CREATE INDEX IF NOT EXISTS idx_run_steps_run_id
        ON run_steps (run_id);

      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    }
  }
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb
};

// CLI: Initialize database and verify schema
if (require.main === module) {
  const dbPath = process.argv[2] || DEFAULT_DB_PATH;
  const db = openDb(dbPath);
  console.log(`Dashboard database initialized at ${dbPath}`);
  db.close();
}
