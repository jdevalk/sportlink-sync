const path = require('path');
const Database = require('better-sqlite3');
const { stableStringify, computeHash, nowISO } = require('./utils');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'laposta-sync.sqlite');

/**
 * Compute hash for member data used in change detection.
 * @param {string} email - Member email
 * @param {Object} customFields - Custom field values
 * @returns {string} SHA-256 hash
 */
function computeSourceHash(email, customFields) {
  const payload = stableStringify({ email, custom_fields: customFields || {} });
  return computeHash(payload);
}

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
 * Initialize database schema.
 * @param {Database} db - Database instance
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sportlink_runs (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      results_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS laposta_fields (
      list_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      custom_name TEXT NOT NULL,
      datatype TEXT,
      required INTEGER,
      options_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (list_id, field_id)
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      list_index INTEGER NOT NULL,
      list_id TEXT,
      email TEXT NOT NULL,
      custom_fields_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      last_synced_custom_fields_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (list_index, email)
    );

    CREATE INDEX IF NOT EXISTS idx_members_list_hash
      ON members (list_index, source_hash, last_synced_hash);
  `);

  // Migration: add last_synced_custom_fields_json if missing
  const memberColumns = db.prepare('PRAGMA table_info(members)').all();
  const hasSyncedFields = memberColumns.some(column => column.name === 'last_synced_custom_fields_json');
  if (!hasSyncedFields) {
    db.exec('ALTER TABLE members ADD COLUMN last_synced_custom_fields_json TEXT');
  }
}

/**
 * Insert a Sportlink run result.
 * @param {Database} db - Database instance
 * @param {string} resultsJson - JSON string of results
 */
function insertSportlinkRun(db, resultsJson) {
  const stmt = db.prepare(`
    INSERT INTO sportlink_runs (created_at, results_json)
    VALUES (?, ?)
  `);
  stmt.run(nowISO(), resultsJson);
}

/**
 * Get latest Sportlink results JSON.
 * @param {Database} db - Database instance
 * @returns {string|null} Results JSON or null if none
 */
function getLatestSportlinkResults(db) {
  const row = db.prepare(`
    SELECT results_json
    FROM sportlink_runs
    ORDER BY id DESC
    LIMIT 1
  `).get();

  return row ? row.results_json : null;
}

/**
 * Upsert members into the database.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index (1-4)
 * @param {string|null} listId - Laposta list ID
 * @param {Array} members - Member objects with email and custom_fields
 */
function upsertMembers(db, listIndex, listId, members) {
  const now = nowISO();
  const stmt = db.prepare(`
    INSERT INTO members (
      list_index, list_id, email, custom_fields_json, source_hash, last_seen_at, created_at
    )
    VALUES (
      @list_index, @list_id, @email, @custom_fields_json, @source_hash, @last_seen_at, @created_at
    )
    ON CONFLICT(list_index, email) DO UPDATE SET
      list_id = excluded.list_id,
      custom_fields_json = excluded.custom_fields_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const rows = members.map(member => {
    const customFields = member.custom_fields || {};
    return {
      list_index: listIndex,
      list_id: listId || null,
      email: member.email,
      custom_fields_json: stableStringify(customFields),
      source_hash: computeSourceHash(member.email, customFields),
      last_seen_at: now,
      created_at: now
    };
  });

  db.transaction(insertRows => {
    insertRows.forEach(row => stmt.run(row));
  })(rows);
}

/**
 * Delete all members for a list.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 */
function deleteMembersForList(db, listIndex) {
  db.prepare('DELETE FROM members WHERE list_index = ?').run(listIndex);
}

/**
 * Delete members not in the provided email list.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 * @param {string[]} emails - Emails to keep
 */
function deleteMembersNotInList(db, listIndex, emails) {
  if (!emails || emails.length === 0) {
    deleteMembersForList(db, listIndex);
    return;
  }

  const placeholders = emails.map(() => '?').join(', ');
  const stmt = db.prepare(`
    DELETE FROM members
    WHERE list_index = ?
      AND lower(email) NOT IN (${placeholders})
  `);
  stmt.run(listIndex, ...emails.map(email => String(email).toLowerCase()));
}

/**
 * Get members needing sync (hash mismatch or never synced).
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 * @param {boolean} [force=false] - Return all members regardless of sync state
 * @param {boolean} [includePrevious=false] - Include previous synced custom fields
 * @returns {Array} Members needing sync
 */
function getMembersNeedingSync(db, listIndex, force = false, includePrevious = false) {
  const selectFields = includePrevious
    ? 'email, custom_fields_json, source_hash, last_synced_custom_fields_json'
    : 'email, custom_fields_json, source_hash';

  const whereClause = force
    ? 'WHERE list_index = ?'
    : 'WHERE list_index = ? AND (last_synced_hash IS NULL OR last_synced_hash != source_hash)';

  const stmt = db.prepare(`
    SELECT ${selectFields}
    FROM members
    ${whereClause}
    ORDER BY email ASC
  `);

  return stmt.all(listIndex).map(row => {
    const result = {
      email: row.email,
      custom_fields: JSON.parse(row.custom_fields_json),
      source_hash: row.source_hash
    };

    if (includePrevious) {
      result.last_synced_custom_fields = row.last_synced_custom_fields_json
        ? JSON.parse(row.last_synced_custom_fields_json)
        : null;
    }

    return result;
  });
}

/**
 * Get members needing sync with previous custom fields for diff display.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 * @param {boolean} [force=false] - Return all members regardless of sync state
 * @returns {Array} Members with previous custom fields
 */
function getMembersNeedingSyncWithPrevious(db, listIndex, force = false) {
  return getMembersNeedingSync(db, listIndex, force, true);
}

/**
 * Get all members for a list.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 * @returns {Array} All members
 */
function getMembersForList(db, listIndex) {
  return db.prepare(`
    SELECT email, source_hash, last_synced_hash
    FROM members
    WHERE list_index = ?
  `).all(listIndex);
}

/**
 * Get members by email address.
 * @param {Database} db - Database instance
 * @param {string} email - Email to search
 * @param {number|null} [listIndex=null] - Optional list index filter
 * @returns {Array} Matching members
 */
function getMembersByEmail(db, email, listIndex = null) {
  const stmt = listIndex
    ? db.prepare(`
        SELECT list_index, list_id, email, custom_fields_json, source_hash,
               last_seen_at, last_synced_at, last_synced_hash
        FROM members
        WHERE list_index = ? AND lower(email) = lower(?)
        ORDER BY list_index ASC
      `)
    : db.prepare(`
        SELECT list_index, list_id, email, custom_fields_json, source_hash,
               last_seen_at, last_synced_at, last_synced_hash
        FROM members
        WHERE lower(email) = lower(?)
        ORDER BY list_index ASC
      `);

  const rows = listIndex ? stmt.all(listIndex, email) : stmt.all(email);

  return rows.map(row => ({
    list_index: row.list_index,
    list_id: row.list_id,
    email: row.email,
    custom_fields: JSON.parse(row.custom_fields_json),
    source_hash: row.source_hash,
    last_seen_at: row.last_seen_at,
    last_synced_at: row.last_synced_at,
    last_synced_hash: row.last_synced_hash
  }));
}

/**
 * Update sync state after successful Laposta sync.
 * @param {Database} db - Database instance
 * @param {number} listIndex - List index
 * @param {string} email - Member email
 * @param {string} sourceHash - Hash that was synced
 * @param {Object} customFields - Custom fields that were synced
 */
function updateSyncState(db, listIndex, email, sourceHash, customFields) {
  const stmt = db.prepare(`
    UPDATE members
    SET last_synced_at = ?, last_synced_hash = ?, last_synced_custom_fields_json = ?
    WHERE list_index = ? AND email = ?
  `);
  stmt.run(nowISO(), sourceHash, stableStringify(customFields || {}), listIndex, email);
}

/**
 * Upsert Laposta field definitions.
 * @param {Database} db - Database instance
 * @param {string} listId - Laposta list ID
 * @param {Array} fields - Field definitions from Laposta API
 */
function upsertLapostaFields(db, listId, fields) {
  const now = nowISO();
  const stmt = db.prepare(`
    INSERT INTO laposta_fields (
      list_id, field_id, custom_name, datatype, required, options_json, updated_at
    )
    VALUES (
      @list_id, @field_id, @custom_name, @datatype, @required, @options_json, @updated_at
    )
    ON CONFLICT(list_id, field_id) DO UPDATE SET
      custom_name = excluded.custom_name,
      datatype = excluded.datatype,
      required = excluded.required,
      options_json = excluded.options_json,
      updated_at = excluded.updated_at
  `);

  const rows = fields.map(field => ({
    list_id: listId,
    field_id: field.field_id,
    custom_name: field.custom_name || field.tag || '',
    datatype: field.datatype || '',
    required: field.required ? 1 : 0,
    options_json: JSON.stringify(field.options_full || field.options || []),
    updated_at: now
  }));

  db.transaction(insertRows => {
    insertRows.forEach(row => stmt.run(row));
  })(rows);
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
  computeSourceHash,
  upsertMembers,
  deleteMembersForList,
  deleteMembersNotInList,
  getMembersNeedingSync,
  getMembersNeedingSyncWithPrevious,
  getMembersForList,
  getMembersByEmail,
  updateSyncState,
  upsertLapostaFields,
  insertSportlinkRun,
  getLatestSportlinkResults
};
