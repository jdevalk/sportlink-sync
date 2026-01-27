const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'stadion-sync.sqlite');

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
 * Compute SHA-256 hash of member data for change detection.
 * Uses KNVB ID as stable identifier (email can change).
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
    CREATE TABLE IF NOT EXISTS stadion_members (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL UNIQUE,
      stadion_id INTEGER,
      email TEXT,
      data_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_members_hash
      ON stadion_members (source_hash, last_synced_hash);

    CREATE INDEX IF NOT EXISTS idx_stadion_members_email
      ON stadion_members (email);

    CREATE TABLE IF NOT EXISTS stadion_parents (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      stadion_id INTEGER,
      data_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_parents_hash
      ON stadion_parents (source_hash, last_synced_hash);

    CREATE TABLE IF NOT EXISTS stadion_important_dates (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      date_type TEXT NOT NULL,
      date_value TEXT NOT NULL,
      stadion_date_id INTEGER,
      source_hash TEXT NOT NULL,
      last_synced_hash TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, date_type)
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_important_dates_sync
      ON stadion_important_dates (source_hash, last_synced_hash);

    CREATE TABLE IF NOT EXISTS stadion_teams (
      id INTEGER PRIMARY KEY,
      team_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      stadion_id INTEGER,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_teams_hash
      ON stadion_teams (source_hash, last_synced_hash);

    CREATE TABLE IF NOT EXISTS stadion_work_history (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      stadion_work_history_id INTEGER,
      is_backfill INTEGER DEFAULT 0,
      source_hash TEXT NOT NULL,
      last_synced_hash TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, team_name)
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_work_history_member
      ON stadion_work_history (knvb_id);

    CREATE TABLE IF NOT EXISTS sportlink_team_members (
      id INTEGER PRIMARY KEY,
      sportlink_team_id TEXT NOT NULL,
      sportlink_person_id TEXT NOT NULL,
      member_type TEXT NOT NULL,
      role_description TEXT,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(sportlink_team_id, sportlink_person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sportlink_team_members_person
      ON sportlink_team_members (sportlink_person_id);

    CREATE INDEX IF NOT EXISTS idx_sportlink_team_members_team
      ON sportlink_team_members (sportlink_team_id);
  `);

  // Add photo state tracking columns if they don't exist
  const memberColumns = db.prepare('PRAGMA table_info(stadion_members)').all();

  if (!memberColumns.some(col => col.name === 'person_image_date')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN person_image_date TEXT');
  }

  if (!memberColumns.some(col => col.name === 'photo_state')) {
    db.exec(`ALTER TABLE stadion_members ADD COLUMN photo_state TEXT DEFAULT 'no_photo' CHECK(photo_state IN ('no_photo', 'pending_download', 'downloaded', 'pending_upload', 'synced', 'pending_delete'))`);
  }

  if (!memberColumns.some(col => col.name === 'photo_state_updated_at')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN photo_state_updated_at TEXT');
  }

  // Add Sportlink metadata columns to stadion_teams if they don't exist
  const teamColumns = db.prepare('PRAGMA table_info(stadion_teams)').all();

  if (!teamColumns.some(col => col.name === 'sportlink_id')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN sportlink_id TEXT');
  }

  if (!teamColumns.some(col => col.name === 'game_activity')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN game_activity TEXT');
  }

  if (!teamColumns.some(col => col.name === 'gender')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN gender TEXT');
  }

  if (!teamColumns.some(col => col.name === 'player_count')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN player_count INTEGER');
  }

  if (!teamColumns.some(col => col.name === 'staff_count')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN staff_count INTEGER');
  }
}

/**
 * Insert or update member records in bulk.
 * Each member: { knvb_id, email, data, person_image_date }
 */
function upsertMembers(db, members) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_members (
      knvb_id,
      email,
      data_json,
      source_hash,
      last_seen_at,
      created_at,
      person_image_date,
      photo_state,
      photo_state_updated_at
    )
    VALUES (
      @knvb_id,
      @email,
      @data_json,
      @source_hash,
      @last_seen_at,
      @created_at,
      @person_image_date,
      CASE WHEN @person_image_date IS NOT NULL THEN 'pending_download' ELSE 'no_photo' END,
      @photo_state_updated_at
    )
    ON CONFLICT(knvb_id) DO UPDATE SET
      email = excluded.email,
      data_json = excluded.data_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at,
      person_image_date = excluded.person_image_date,
      photo_state = CASE
        -- Photo added or changed: trigger download
        WHEN excluded.person_image_date IS NOT NULL
             AND (stadion_members.person_image_date IS NULL
                  OR excluded.person_image_date != stadion_members.person_image_date)
          THEN 'pending_download'
        -- Photo removed: trigger deletion
        WHEN excluded.person_image_date IS NULL
             AND stadion_members.person_image_date IS NOT NULL
          THEN 'pending_delete'
        -- No change: keep current state
        ELSE stadion_members.photo_state
      END,
      photo_state_updated_at = CASE
        WHEN excluded.person_image_date IS NOT NULL
             AND (stadion_members.person_image_date IS NULL
                  OR excluded.person_image_date != stadion_members.person_image_date)
          THEN excluded.photo_state_updated_at
        WHEN excluded.person_image_date IS NULL
             AND stadion_members.person_image_date IS NOT NULL
          THEN excluded.photo_state_updated_at
        ELSE stadion_members.photo_state_updated_at
      END
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = members.map((member) => {
    const data = member.data || {};
    return {
      knvb_id: member.knvb_id,
      email: member.email || null,
      data_json: stableStringify(data),
      source_hash: computeSourceHash(member.knvb_id, data),
      last_seen_at: now,
      created_at: now,
      person_image_date: member.person_image_date || null,
      photo_state_updated_at: now
    };
  });

  insertMany(rows);
}

/**
 * Get members needing sync (source_hash != last_synced_hash).
 * If force=true, return all members regardless of sync state.
 * Returns: [{ knvb_id, email, data, source_hash, stadion_id }]
 */
function getMembersNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT knvb_id, email, data_json, source_hash, stadion_id
      FROM stadion_members
      ORDER BY knvb_id ASC
    `)
    : db.prepare(`
      SELECT knvb_id, email, data_json, source_hash, stadion_id
      FROM stadion_members
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY knvb_id ASC
    `);

  return stmt.all().map((row) => ({
    knvb_id: row.knvb_id,
    email: row.email,
    data: JSON.parse(row.data_json),
    source_hash: row.source_hash,
    stadion_id: row.stadion_id
  }));
}

/**
 * Update sync state after successful sync to Stadion.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateSyncState(db, knvbId, sourceHash, stadionId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_members
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE knvb_id = ?
  `);
  stmt.run(now, sourceHash, stadionId || null, knvbId);
}

/**
 * Delete member from tracking table.
 */
function deleteMember(db, knvbId) {
  const stmt = db.prepare(`
    DELETE FROM stadion_members
    WHERE knvb_id = ?
  `);
  stmt.run(knvbId);
}

/**
 * Find tracked members not in provided list (for delete detection).
 * Returns members that exist in DB but not in knvbIds array.
 */
function getMembersNotInList(db, knvbIds) {
  if (!knvbIds || knvbIds.length === 0) {
    // All tracked members are "not in list" if list is empty
    const stmt = db.prepare(`
      SELECT knvb_id, email, stadion_id
      FROM stadion_members
      ORDER BY knvb_id ASC
    `);
    return stmt.all();
  }

  const placeholders = knvbIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT knvb_id, email, stadion_id
    FROM stadion_members
    WHERE knvb_id NOT IN (${placeholders})
    ORDER BY knvb_id ASC
  `);

  return stmt.all(...knvbIds);
}

/**
 * Get ALL tracked members with their KNVB ID and Stadion ID.
 * Used for building parent-child relationship mappings.
 * Returns all members in stadion_members table, not just those needing sync.
 */
function getAllTrackedMembers(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, stadion_id
    FROM stadion_members
    WHERE knvb_id IS NOT NULL AND stadion_id IS NOT NULL
  `);
  return stmt.all();
}

/**
 * Compute SHA-256 hash of parent data for change detection.
 * Uses email as stable identifier (parents have no KNVB ID).
 */
function computeParentHash(email, data) {
  const payload = stableStringify({ email: email, data: data || {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert or update parent records in bulk.
 * Each parent: { email, data }
 */
function upsertParents(db, parents) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_parents (
      email,
      data_json,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @email,
      @data_json,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(email) DO UPDATE SET
      data_json = excluded.data_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = parents.map((parent) => {
    const data = parent.data || {};
    // Store the full parent object (including childKnvbIds) in data_json
    const fullParent = {
      data: data,
      childKnvbIds: parent.childKnvbIds || []
    };
    return {
      email: parent.email,
      data_json: stableStringify(fullParent),
      source_hash: computeParentHash(parent.email, data),
      last_seen_at: now,
      created_at: now
    };
  });

  insertMany(rows);
}

/**
 * Get parents needing sync (source_hash != last_synced_hash).
 * If force=true, return all parents regardless of sync state.
 * Returns: [{ email, data, source_hash, stadion_id }]
 */
function getParentsNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT email, data_json, source_hash, stadion_id
      FROM stadion_parents
      ORDER BY email ASC
    `)
    : db.prepare(`
      SELECT email, data_json, source_hash, stadion_id
      FROM stadion_parents
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY email ASC
    `);

  return stmt.all().map((row) => {
    const parsed = JSON.parse(row.data_json);
    // Support both old format (data directly) and new format (data + childKnvbIds)
    const data = parsed.data || parsed;
    const childKnvbIds = parsed.childKnvbIds || [];
    return {
      email: row.email,
      data: data,
      childKnvbIds: childKnvbIds,
      source_hash: row.source_hash,
      stadion_id: row.stadion_id
    };
  });
}

/**
 * Update sync state after successful parent sync to Stadion.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateParentSyncState(db, email, sourceHash, stadionId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_parents
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE email = ?
  `);
  stmt.run(now, sourceHash, stadionId || null, email);
}

/**
 * Delete parent from tracking table.
 */
function deleteParent(db, email) {
  const stmt = db.prepare(`
    DELETE FROM stadion_parents
    WHERE email = ?
  `);
  stmt.run(email);
}

/**
 * Reset all parent stadion_ids (after server-side duplicate merge).
 * This clears stadion_id and last_synced_hash so parents will be re-synced.
 * The next sync will use email lookup to find existing persons.
 * @param {Object} db - SQLite database connection
 * @returns {number} Number of parents reset
 */
function resetParentStadionIds(db) {
  const stmt = db.prepare(`
    UPDATE stadion_parents
    SET stadion_id = NULL,
        last_synced_hash = NULL,
        last_synced_at = NULL
  `);
  const result = stmt.run();
  return result.changes;
}

/**
 * Find tracked parents not in provided list (for orphan detection).
 * Returns parents that exist in DB but not in emails array.
 */
function getParentsNotInList(db, emails) {
  if (!emails || emails.length === 0) {
    // All tracked parents are "not in list" if list is empty
    const stmt = db.prepare(`
      SELECT email, stadion_id
      FROM stadion_parents
      ORDER BY email ASC
    `);
    return stmt.all();
  }

  const placeholders = emails.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT email, stadion_id
    FROM stadion_parents
    WHERE email NOT IN (${placeholders})
    ORDER BY email ASC
  `);

  return stmt.all(...emails);
}

/**
 * Get members by photo state (for photo sync operations)
 * @param {Object} db - SQLite database connection
 * @param {string} state - Photo state to filter by
 * @returns {Array<{knvb_id: string, email: string, person_image_date: string, stadion_id: number}>}
 */
function getMembersByPhotoState(db, state) {
  const stmt = db.prepare(`
    SELECT knvb_id, email, person_image_date, stadion_id
    FROM stadion_members
    WHERE photo_state = ?
    ORDER BY knvb_id ASC
  `);
  return stmt.all(state);
}

/**
 * Update photo state after download/upload/delete operations
 * @param {Object} db - SQLite database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string} newState - New photo state
 */
function updatePhotoState(db, knvbId, newState) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_members
    SET photo_state = ?, photo_state_updated_at = ?
    WHERE knvb_id = ?
  `);
  stmt.run(newState, now, knvbId);
}

/**
 * Clear photo state to no_photo (after successful deletion)
 * Also clears person_image_date to prevent re-triggering
 * @param {Object} db - SQLite database connection
 * @param {string} knvbId - Member KNVB ID
 */
function clearPhotoState(db, knvbId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_members
    SET photo_state = 'no_photo', person_image_date = NULL, photo_state_updated_at = ?
    WHERE knvb_id = ?
  `);
  stmt.run(now, knvbId);
}

/**
 * Compute hash for important date tracking
 */
function computeDateHash(knvbId, dateType, dateValue) {
  const payload = stableStringify({ knvb_id: knvbId, date_type: dateType, date_value: dateValue });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Upsert important date record
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string} dateType - Date type (e.g., 'birth_date')
 * @param {string} dateValue - Date value (YYYY-MM-DD)
 */
function upsertImportantDate(db, knvbId, dateType, dateValue) {
  const now = new Date().toISOString();
  const sourceHash = computeDateHash(knvbId, dateType, dateValue);

  const stmt = db.prepare(`
    INSERT INTO stadion_important_dates (
      knvb_id, date_type, date_value, source_hash, created_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(knvb_id, date_type) DO UPDATE SET
      date_value = excluded.date_value,
      source_hash = excluded.source_hash
  `);
  stmt.run(knvbId, dateType, dateValue, sourceHash, now);
}

/**
 * Get important dates needing sync (new or changed)
 * @param {Object} db - Database connection
 * @param {boolean} force - Force sync all dates
 * @returns {Array<{knvb_id: string, date_type: string, date_value: string, source_hash: string, stadion_date_id: number|null}>}
 */
function getImportantDatesNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
        SELECT d.knvb_id, d.date_type, d.date_value, d.source_hash, d.stadion_date_id, m.stadion_id
        FROM stadion_important_dates d
        JOIN stadion_members m ON d.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
        ORDER BY d.knvb_id ASC
      `)
    : db.prepare(`
        SELECT d.knvb_id, d.date_type, d.date_value, d.source_hash, d.stadion_date_id, m.stadion_id
        FROM stadion_important_dates d
        JOIN stadion_members m ON d.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
          AND (d.last_synced_hash IS NULL OR d.last_synced_hash != d.source_hash)
        ORDER BY d.knvb_id ASC
      `);
  return stmt.all();
}

/**
 * Update important date sync state after successful sync
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string} dateType - Date type
 * @param {string} sourceHash - Source hash that was synced
 * @param {number} stadionDateId - WordPress post ID of the important date
 */
function updateImportantDateSyncState(db, knvbId, dateType, sourceHash, stadionDateId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_important_dates
    SET last_synced_at = ?, last_synced_hash = ?, stadion_date_id = ?
    WHERE knvb_id = ? AND date_type = ?
  `);
  stmt.run(now, sourceHash, stadionDateId, knvbId, dateType);
}

/**
 * Get important dates for members no longer in Sportlink (for deletion)
 * @param {Object} db - Database connection
 * @param {Array<string>} currentKnvbIds - Current member KNVB IDs
 * @returns {Array<{knvb_id: string, date_type: string, stadion_date_id: number}>}
 */
function getOrphanImportantDates(db, currentKnvbIds) {
  if (!currentKnvbIds || currentKnvbIds.length === 0) {
    const stmt = db.prepare(`
      SELECT knvb_id, date_type, stadion_date_id
      FROM stadion_important_dates
      WHERE stadion_date_id IS NOT NULL
    `);
    return stmt.all();
  }

  const placeholders = currentKnvbIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT knvb_id, date_type, stadion_date_id
    FROM stadion_important_dates
    WHERE knvb_id NOT IN (${placeholders})
      AND stadion_date_id IS NOT NULL
  `);
  return stmt.all(...currentKnvbIds);
}

/**
 * Delete important date record from tracking
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string} dateType - Date type
 */
function deleteImportantDate(db, knvbId, dateType) {
  const stmt = db.prepare(`
    DELETE FROM stadion_important_dates
    WHERE knvb_id = ? AND date_type = ?
  `);
  stmt.run(knvbId, dateType);
}

/**
 * Get all tracked important dates count
 */
function getImportantDatesCount(db) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM stadion_important_dates');
  return stmt.get().count;
}

/**
 * Get synced important dates count
 */
function getSyncedImportantDatesCount(db) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM stadion_important_dates WHERE stadion_date_id IS NOT NULL');
  return stmt.get().count;
}

/**
 * Compute SHA-256 hash of team data for change detection.
 * Uses team name as identifier.
 */
function computeTeamHash(teamName) {
  const payload = stableStringify({ team_name: teamName });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert or update team records in bulk.
 * Each team: team_name (string)
 */
function upsertTeams(db, teamNames) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_teams (
      team_name,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @team_name,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(team_name) DO UPDATE SET
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = teamNames.map((teamName) => ({
    team_name: teamName,
    source_hash: computeTeamHash(teamName),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get teams needing sync (source_hash != last_synced_hash).
 * If force=true, return all teams regardless of sync state.
 * Returns: [{ team_name, source_hash, stadion_id }]
 */
function getTeamsNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT team_name, source_hash, stadion_id, last_synced_hash
      FROM stadion_teams
      ORDER BY team_name ASC
    `)
    : db.prepare(`
      SELECT team_name, source_hash, stadion_id, last_synced_hash
      FROM stadion_teams
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY team_name ASC
    `);

  return stmt.all();
}

/**
 * Update sync state after successful team sync to Stadion.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateTeamSyncState(db, teamName, sourceHash, stadionId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_teams
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE team_name = ?
  `);
  stmt.run(now, sourceHash, stadionId || null, teamName);
}

/**
 * Get all teams with their stadion_id (for Phase 14 mapping).
 * Returns: [{ team_name, stadion_id }]
 */
function getAllTeams(db) {
  const stmt = db.prepare(`
    SELECT team_name, stadion_id
    FROM stadion_teams
    WHERE stadion_id IS NOT NULL
    ORDER BY team_name ASC
  `);
  return stmt.all();
}

/**
 * Compute SHA-256 hash of work history for change detection.
 * Uses KNVB ID and team name as identifier.
 */
function computeWorkHistoryHash(knvbId, teamName) {
  const payload = stableStringify({ knvb_id: knvbId, team_name: teamName });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert or update work history records in bulk.
 * Each record: { knvb_id, team_name, is_backfill }
 */
function upsertWorkHistory(db, workHistoryRecords) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_work_history (
      knvb_id,
      team_name,
      is_backfill,
      source_hash,
      created_at
    )
    VALUES (
      @knvb_id,
      @team_name,
      @is_backfill,
      @source_hash,
      @created_at
    )
    ON CONFLICT(knvb_id, team_name) DO UPDATE SET
      source_hash = excluded.source_hash,
      is_backfill = excluded.is_backfill
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = workHistoryRecords.map((record) => ({
    knvb_id: record.knvb_id,
    team_name: record.team_name,
    is_backfill: record.is_backfill ? 1 : 0,
    source_hash: computeWorkHistoryHash(record.knvb_id, record.team_name),
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get work history records needing sync (hash changed or force).
 * Joins with stadion_members to get stadion_id for each member.
 * Returns: [{ knvb_id, team_name, is_backfill, source_hash, stadion_id, stadion_work_history_id }]
 */
function getWorkHistoryNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
        SELECT w.knvb_id, w.team_name, w.is_backfill, w.source_hash,
               w.stadion_work_history_id, m.stadion_id
        FROM stadion_work_history w
        JOIN stadion_members m ON w.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
        ORDER BY w.knvb_id ASC, w.team_name ASC
      `)
    : db.prepare(`
        SELECT w.knvb_id, w.team_name, w.is_backfill, w.source_hash,
               w.stadion_work_history_id, m.stadion_id
        FROM stadion_work_history w
        JOIN stadion_members m ON w.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
          AND (w.last_synced_hash IS NULL OR w.last_synced_hash != w.source_hash)
        ORDER BY w.knvb_id ASC, w.team_name ASC
      `);
  return stmt.all();
}

/**
 * Get all work history for a member.
 * Returns: [{ team_name, is_backfill, last_synced_at, stadion_work_history_id }]
 */
function getMemberWorkHistory(db, knvbId) {
  const stmt = db.prepare(`
    SELECT team_name, is_backfill, last_synced_at, stadion_work_history_id
    FROM stadion_work_history
    WHERE knvb_id = ?
    ORDER BY team_name ASC
  `);
  return stmt.all(knvbId);
}

/**
 * Get all work history grouped by member.
 * Returns Map<knvb_id, Set<team_name>> for change detection.
 */
function getWorkHistoryByMember(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, team_name
    FROM stadion_work_history
    ORDER BY knvb_id ASC
  `);
  const rows = stmt.all();

  const memberTeams = new Map();
  rows.forEach(row => {
    if (!memberTeams.has(row.knvb_id)) {
      memberTeams.set(row.knvb_id, new Set());
    }
    memberTeams.get(row.knvb_id).add(row.team_name);
  });

  return memberTeams;
}

/**
 * Update work history sync state after successful sync.
 * Stores WordPress work_history row index (stadion_work_history_id) for future updates.
 */
function updateWorkHistorySyncState(db, knvbId, teamName, sourceHash, stadionWorkHistoryId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_work_history
    SET last_synced_at = ?, last_synced_hash = ?, stadion_work_history_id = ?
    WHERE knvb_id = ? AND team_name = ?
  `);
  stmt.run(now, sourceHash, stadionWorkHistoryId, knvbId, teamName);
}

/**
 * Delete a work history record from tracking.
 */
function deleteWorkHistory(db, knvbId, teamName) {
  const stmt = db.prepare(`
    DELETE FROM stadion_work_history
    WHERE knvb_id = ? AND team_name = ?
  `);
  stmt.run(knvbId, teamName);
}

/**
 * Delete all work history records for a member.
 */
function deleteAllMemberWorkHistory(db, knvbId) {
  const stmt = db.prepare(`
    DELETE FROM stadion_work_history
    WHERE knvb_id = ?
  `);
  stmt.run(knvbId);
}

/**
 * Compute SHA-256 hash for team with metadata.
 */
function computeTeamMetadataHash(teamName, metadata) {
  const payload = stableStringify({
    team_name: teamName,
    sportlink_id: metadata.sportlink_id,
    game_activity: metadata.game_activity,
    gender: metadata.gender,
    player_count: metadata.player_count,
    staff_count: metadata.staff_count
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert or update team records with extended metadata.
 * Each team: { team_name, sportlink_id, game_activity, gender, player_count, staff_count }
 */
function upsertTeamsWithMetadata(db, teams) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_teams (
      team_name,
      sportlink_id,
      game_activity,
      gender,
      player_count,
      staff_count,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @team_name,
      @sportlink_id,
      @game_activity,
      @gender,
      @player_count,
      @staff_count,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(team_name) DO UPDATE SET
      sportlink_id = excluded.sportlink_id,
      game_activity = excluded.game_activity,
      gender = excluded.gender,
      player_count = excluded.player_count,
      staff_count = excluded.staff_count,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = teams.map((team) => ({
    team_name: team.team_name,
    sportlink_id: team.sportlink_id || null,
    game_activity: team.game_activity || null,
    gender: team.gender || null,
    player_count: team.player_count || null,
    staff_count: team.staff_count || null,
    source_hash: computeTeamMetadataHash(team.team_name, team),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Compute hash for team member record.
 */
function computeTeamMemberHash(sportlinkTeamId, sportlinkPersonId, memberType, roleDescription) {
  const payload = stableStringify({
    sportlink_team_id: sportlinkTeamId,
    sportlink_person_id: sportlinkPersonId,
    member_type: memberType,
    role_description: roleDescription
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert or update team member records in bulk.
 * Each member: { sportlink_team_id, sportlink_person_id, member_type, role_description }
 */
function upsertTeamMembers(db, members) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_team_members (
      sportlink_team_id,
      sportlink_person_id,
      member_type,
      role_description,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @sportlink_team_id,
      @sportlink_person_id,
      @member_type,
      @role_description,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(sportlink_team_id, sportlink_person_id) DO UPDATE SET
      member_type = excluded.member_type,
      role_description = excluded.role_description,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = members.map((member) => ({
    sportlink_team_id: member.sportlink_team_id,
    sportlink_person_id: member.sportlink_person_id,
    member_type: member.member_type,
    role_description: member.role_description || null,
    source_hash: computeTeamMemberHash(
      member.sportlink_team_id,
      member.sportlink_person_id,
      member.member_type,
      member.role_description
    ),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get team member role for a given KNVB ID and team name.
 * Looks up via sportlink_team_members joined with stadion_teams.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID (PublicPersonId)
 * @param {string} teamName - Team name to lookup
 * @returns {string|null} - Role description or null if not found
 */
function getTeamMemberRole(db, knvbId, teamName) {
  const stmt = db.prepare(`
    SELECT tm.role_description, tm.member_type
    FROM sportlink_team_members tm
    JOIN stadion_teams t ON tm.sportlink_team_id = t.sportlink_id
    WHERE tm.sportlink_person_id = ?
      AND t.team_name = ? COLLATE NOCASE
  `);
  const row = stmt.get(knvbId, teamName);
  if (row && row.role_description) {
    return row.role_description;
  }
  // Fallback to member_type if no role_description
  if (row && row.member_type === 'player') {
    return 'Speler';
  }
  if (row && row.member_type === 'staff') {
    return 'Staflid';
  }
  return null;
}

/**
 * Clear all team members before fresh import.
 * @param {Object} db - Database connection
 */
function clearTeamMembers(db) {
  db.exec('DELETE FROM sportlink_team_members');
}

/**
 * Get team by sportlink_id.
 * @param {Object} db - Database connection
 * @param {string} sportlinkId - Sportlink team ID
 * @returns {Object|null} - Team record or null
 */
function getTeamBySportlinkId(db, sportlinkId) {
  const stmt = db.prepare(`
    SELECT team_name, sportlink_id, stadion_id, game_activity, gender, player_count, staff_count
    FROM stadion_teams
    WHERE sportlink_id = ?
  `);
  return stmt.get(sportlinkId) || null;
}

/**
 * Get team member count for a team.
 * @param {Object} db - Database connection
 * @param {string} sportlinkTeamId - Sportlink team ID
 * @returns {{ players: number, staff: number }}
 */
function getTeamMemberCounts(db, sportlinkTeamId) {
  const playerStmt = db.prepare(`
    SELECT COUNT(*) as count FROM sportlink_team_members
    WHERE sportlink_team_id = ? AND member_type = 'player'
  `);
  const staffStmt = db.prepare(`
    SELECT COUNT(*) as count FROM sportlink_team_members
    WHERE sportlink_team_id = ? AND member_type = 'staff'
  `);
  return {
    players: playerStmt.get(sportlinkTeamId)?.count || 0,
    staff: staffStmt.get(sportlinkTeamId)?.count || 0
  };
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
  stableStringify,
  computeSourceHash,
  upsertMembers,
  getMembersNeedingSync,
  updateSyncState,
  deleteMember,
  getMembersNotInList,
  getAllTrackedMembers,
  computeParentHash,
  upsertParents,
  getParentsNeedingSync,
  updateParentSyncState,
  deleteParent,
  resetParentStadionIds,
  getParentsNotInList,
  getMembersByPhotoState,
  updatePhotoState,
  clearPhotoState,
  computeDateHash,
  upsertImportantDate,
  getImportantDatesNeedingSync,
  updateImportantDateSyncState,
  getOrphanImportantDates,
  deleteImportantDate,
  getImportantDatesCount,
  getSyncedImportantDatesCount,
  computeTeamHash,
  upsertTeams,
  getTeamsNeedingSync,
  updateTeamSyncState,
  getAllTeams,
  computeTeamMetadataHash,
  upsertTeamsWithMetadata,
  computeTeamMemberHash,
  upsertTeamMembers,
  getTeamMemberRole,
  clearTeamMembers,
  getTeamBySportlinkId,
  getTeamMemberCounts,
  computeWorkHistoryHash,
  upsertWorkHistory,
  getWorkHistoryNeedingSync,
  getMemberWorkHistory,
  getWorkHistoryByMember,
  updateWorkHistorySyncState,
  deleteWorkHistory,
  deleteAllMemberWorkHistory
};
