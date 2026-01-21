const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'laposta-sync.sqlite');

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

function computeSourceHash(email, customFields) {
  const payload = stableStringify({ email, custom_fields: customFields || {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  initDb(db);
  return db;
}

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
      created_at TEXT NOT NULL,
      UNIQUE (list_index, email)
    );

    CREATE INDEX IF NOT EXISTS idx_members_list_hash
      ON members (list_index, source_hash, last_synced_hash);
  `);
}

function insertSportlinkRun(db, resultsJson) {
  const stmt = db.prepare(`
    INSERT INTO sportlink_runs (created_at, results_json)
    VALUES (?, ?)
  `);
  const now = new Date().toISOString();
  stmt.run(now, resultsJson);
}

function getLatestSportlinkResults(db) {
  const stmt = db.prepare(`
    SELECT results_json
    FROM sportlink_runs
    ORDER BY id DESC
    LIMIT 1
  `);
  const row = stmt.get();
  if (!row) return null;
  return row.results_json;
}

function upsertMembers(db, listIndex, listId, members) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO members (
      list_index,
      list_id,
      email,
      custom_fields_json,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @list_index,
      @list_id,
      @email,
      @custom_fields_json,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(list_index, email) DO UPDATE SET
      list_id = excluded.list_id,
      custom_fields_json = excluded.custom_fields_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = members.map((member) => {
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

  insertMany(rows);
}

function deleteMembersForList(db, listIndex) {
  const stmt = db.prepare(`
    DELETE FROM members
    WHERE list_index = ?
  `);
  stmt.run(listIndex);
}

function getMembersNeedingSync(db, listIndex, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT email, custom_fields_json, source_hash
      FROM members
      WHERE list_index = ?
      ORDER BY email ASC
    `)
    : db.prepare(`
      SELECT email, custom_fields_json, source_hash
      FROM members
      WHERE list_index = ?
        AND (last_synced_hash IS NULL OR last_synced_hash != source_hash)
      ORDER BY email ASC
    `);
  return stmt.all(listIndex).map((row) => ({
    email: row.email,
    custom_fields: JSON.parse(row.custom_fields_json),
    source_hash: row.source_hash
  }));
}

function getMembersByEmail(db, email, listIndex = null) {
  const stmt = listIndex
    ? db.prepare(`
      SELECT list_index, list_id, email, custom_fields_json, source_hash,
             last_seen_at, last_synced_at, last_synced_hash
      FROM members
      WHERE list_index = ?
        AND lower(email) = lower(?)
      ORDER BY list_index ASC
    `)
    : db.prepare(`
      SELECT list_index, list_id, email, custom_fields_json, source_hash,
             last_seen_at, last_synced_at, last_synced_hash
      FROM members
      WHERE lower(email) = lower(?)
      ORDER BY list_index ASC
    `);
  const rows = listIndex
    ? stmt.all(listIndex, email)
    : stmt.all(email);
  return rows.map((row) => ({
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

function updateSyncState(db, listIndex, email, sourceHash) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE members
    SET last_synced_at = ?, last_synced_hash = ?
    WHERE list_index = ? AND email = ?
  `);
  stmt.run(now, sourceHash, listIndex, email);
}

function upsertLapostaFields(db, listId, fields) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO laposta_fields (
      list_id,
      field_id,
      custom_name,
      datatype,
      required,
      options_json,
      updated_at
    )
    VALUES (
      @list_id,
      @field_id,
      @custom_name,
      @datatype,
      @required,
      @options_json,
      @updated_at
    )
    ON CONFLICT(list_id, field_id) DO UPDATE SET
      custom_name = excluded.custom_name,
      datatype = excluded.datatype,
      required = excluded.required,
      options_json = excluded.options_json,
      updated_at = excluded.updated_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = fields.map((field) => ({
    list_id: listId,
    field_id: field.field_id,
    custom_name: field.custom_name || field.tag || '',
    datatype: field.datatype || '',
    required: field.required ? 1 : 0,
    options_json: JSON.stringify(field.options_full || field.options || []),
    updated_at: now
  }));

  insertMany(rows);
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
  stableStringify,
  computeSourceHash,
  upsertMembers,
  deleteMembersForList,
  getMembersNeedingSync,
  getMembersByEmail,
  updateSyncState,
  upsertLapostaFields,
  insertSportlinkRun,
  getLatestSportlinkResults
};
