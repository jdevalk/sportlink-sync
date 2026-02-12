const path = require('path');
const Database = require('better-sqlite3');
const { stableStringify, computeHash } = require('./utils');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'freescout-conversations.sqlite');

/**
 * Compute SHA-256 hash of conversation data for change detection.
 * Uses conversation ID as stable identifier.
 */
function computeConversationHash(conversation) {
  const payload = stableStringify({
    id: conversation.id,
    subject: conversation.subject || '',
    status: conversation.status || '',
    createdAt: conversation.createdAt
  });
  return computeHash(payload);
}

/**
 * Open database and initialize schema.
 */
function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initDb(db);
  return db;
}

/**
 * Initialize database tables and indexes.
 */
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS freescout_conversations (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL UNIQUE,
      knvb_id TEXT NOT NULL,
      freescout_customer_id INTEGER NOT NULL,
      subject TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      rondo_club_activity_id INTEGER,
      last_synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_knvb_id
      ON freescout_conversations (knvb_id);

    CREATE INDEX IF NOT EXISTS idx_conversations_unsynced
      ON freescout_conversations (rondo_club_activity_id)
      WHERE rondo_club_activity_id IS NULL;

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Insert or update conversation records in bulk.
 * Each conversation: { conversation_id, knvb_id, freescout_customer_id, subject, status, created_at, source_hash }
 */
function upsertConversations(db, conversations) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO freescout_conversations (
      conversation_id,
      knvb_id,
      freescout_customer_id,
      subject,
      status,
      created_at,
      source_hash
    )
    VALUES (
      @conversation_id,
      @knvb_id,
      @freescout_customer_id,
      @subject,
      @status,
      @created_at,
      @source_hash
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      subject = excluded.subject,
      status = excluded.status,
      source_hash = excluded.source_hash
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  insertMany(conversations);
}

/**
 * Get conversations that haven't been synced to Rondo Club yet.
 * Returns: [{ conversation_id, knvb_id, freescout_customer_id, subject, status, created_at }]
 */
function getUnsyncedConversations(db) {
  const stmt = db.prepare(`
    SELECT conversation_id, knvb_id, freescout_customer_id, subject, status, created_at
    FROM freescout_conversations
    WHERE rondo_club_activity_id IS NULL
    ORDER BY created_at ASC
  `);
  return stmt.all();
}

/**
 * Mark a conversation as synced to Rondo Club.
 */
function markConversationSynced(db, conversationId, rondoClubActivityId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE freescout_conversations
    SET rondo_club_activity_id = ?,
        last_synced_at = ?
    WHERE conversation_id = ?
  `);
  stmt.run(rondoClubActivityId, now, conversationId);
}

/**
 * Get the last sync timestamp from metadata.
 * Returns: ISO timestamp string or null
 */
function getLastSyncTimestamp(db) {
  const stmt = db.prepare(`
    SELECT value
    FROM sync_metadata
    WHERE key = 'last_download_at'
  `);
  const row = stmt.get();
  return row ? row.value : null;
}

/**
 * Update the last sync timestamp in metadata.
 */
function updateLastSyncTimestamp(db, timestamp) {
  const stmt = db.prepare(`
    INSERT INTO sync_metadata (key, value)
    VALUES ('last_download_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(timestamp);
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
  computeConversationHash,
  upsertConversations,
  getUnsyncedConversations,
  markConversationSynced,
  getLastSyncTimestamp,
  updateLastSyncTimestamp
};
