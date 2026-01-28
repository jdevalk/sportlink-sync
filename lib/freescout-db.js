const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'freescout-sync.sqlite');

/**
 * Deterministic JSON serialization for hash computation.
 * Ensures identical objects always produce the same string representation.
 */
function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute SHA-256 hash of customer data for change detection.
 * Uses KNVB ID as stable identifier.
 */
function computeSourceHash(knvbId, data) {
  const payload = stableStringify({ knvb_id: knvbId, data: data || {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Open database and initialize schema.
 */
function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  initDb(db);
  return db;
}

/**
 * Initialize database tables and indexes.
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS freescout_customers (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      freescout_id INTEGER,
      data_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_freescout_customers_hash
      ON freescout_customers (source_hash, last_synced_hash);

    CREATE INDEX IF NOT EXISTS idx_freescout_customers_email
      ON freescout_customers (email);
  `);
}

/**
 * Insert or update customer records in bulk.
 * Each customer: { knvb_id, email, data }
 */
function upsertCustomers(db, customers) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO freescout_customers (
      knvb_id,
      email,
      data_json,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @knvb_id,
      @email,
      @data_json,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(knvb_id) DO UPDATE SET
      email = excluded.email,
      data_json = excluded.data_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = customers.map((customer) => {
    const data = customer.data || {};
    return {
      knvb_id: customer.knvb_id,
      email: customer.email,
      data_json: stableStringify(data),
      source_hash: computeSourceHash(customer.knvb_id, data),
      last_seen_at: now,
      created_at: now
    };
  });

  insertMany(rows);
}

/**
 * Get customers needing sync (source_hash != last_synced_hash).
 * If force=true, return all customers regardless of sync state.
 * Returns: [{ knvb_id, email, data, source_hash, freescout_id }]
 */
function getCustomersNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT knvb_id, email, data_json, source_hash, freescout_id
      FROM freescout_customers
      ORDER BY knvb_id ASC
    `)
    : db.prepare(`
      SELECT knvb_id, email, data_json, source_hash, freescout_id
      FROM freescout_customers
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY knvb_id ASC
    `);

  return stmt.all().map((row) => ({
    knvb_id: row.knvb_id,
    email: row.email,
    data: JSON.parse(row.data_json),
    source_hash: row.source_hash,
    freescout_id: row.freescout_id
  }));
}

/**
 * Update sync state after successful sync to FreeScout.
 * Stores FreeScout customer ID for future updates/deletes.
 */
function updateSyncState(db, knvbId, sourceHash, freescoutId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE freescout_customers
    SET last_synced_at = ?, last_synced_hash = ?, freescout_id = ?
    WHERE knvb_id = ?
  `);
  stmt.run(now, sourceHash, freescoutId || null, knvbId);
}

/**
 * Get a single customer record by KNVB ID.
 * Returns: { knvb_id, email, data, source_hash, freescout_id, last_synced_at } or null
 */
function getCustomerByKnvbId(db, knvbId) {
  const stmt = db.prepare(`
    SELECT knvb_id, email, data_json, source_hash, freescout_id, last_synced_at
    FROM freescout_customers
    WHERE knvb_id = ?
  `);
  const row = stmt.get(knvbId);
  if (!row) return null;
  return {
    knvb_id: row.knvb_id,
    email: row.email,
    data: JSON.parse(row.data_json),
    source_hash: row.source_hash,
    freescout_id: row.freescout_id,
    last_synced_at: row.last_synced_at
  };
}

/**
 * Get a single customer record by FreeScout ID.
 * Returns: { knvb_id, email, data, source_hash, freescout_id, last_synced_at } or null
 */
function getCustomerByFreescoutId(db, freescoutId) {
  const stmt = db.prepare(`
    SELECT knvb_id, email, data_json, source_hash, freescout_id, last_synced_at
    FROM freescout_customers
    WHERE freescout_id = ?
  `);
  const row = stmt.get(freescoutId);
  if (!row) return null;
  return {
    knvb_id: row.knvb_id,
    email: row.email,
    data: JSON.parse(row.data_json),
    source_hash: row.source_hash,
    freescout_id: row.freescout_id,
    last_synced_at: row.last_synced_at
  };
}

/**
 * Find tracked customers not in provided list (for delete detection).
 * Returns customers that exist in DB but not in knvbIds array.
 */
function getCustomersNotInList(db, knvbIds) {
  if (!knvbIds || knvbIds.length === 0) {
    // All tracked customers are "not in list" if list is empty
    const stmt = db.prepare(`
      SELECT knvb_id, email, freescout_id
      FROM freescout_customers
      ORDER BY knvb_id ASC
    `);
    return stmt.all();
  }

  const placeholders = knvbIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT knvb_id, email, freescout_id
    FROM freescout_customers
    WHERE knvb_id NOT IN (${placeholders})
    ORDER BY knvb_id ASC
  `);

  return stmt.all(...knvbIds);
}

/**
 * Delete customer from tracking table.
 */
function deleteCustomer(db, knvbId) {
  const stmt = db.prepare(`
    DELETE FROM freescout_customers
    WHERE knvb_id = ?
  `);
  stmt.run(knvbId);
}

/**
 * Get all tracked customers.
 * Returns: [{ knvb_id, email, freescout_id, source_hash, last_synced_at }]
 */
function getAllTrackedCustomers(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, email, freescout_id, source_hash, last_synced_at
    FROM freescout_customers
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
  stableStringify,
  computeSourceHash,
  upsertCustomers,
  getCustomersNeedingSync,
  updateSyncState,
  getCustomerByKnvbId,
  getCustomerByFreescoutId,
  getCustomersNotInList,
  deleteCustomer,
  getAllTrackedCustomers
};
