const path = require('path');
const Database = require('better-sqlite3');
const { stableStringify, computeHash } = require('./utils');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'rondo-sync.sqlite');

/**
 * Compute SHA-256 hash of member data for change detection.
 * Uses KNVB ID as stable identifier (email can change).
 */
function computeSourceHash(knvbId, data) {
  const payload = stableStringify({ knvb_id: knvbId, data: data || {} });
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

    -- DEPRECATED (v2.3): Birthday sync now uses acf.birthdate on person. Table kept for backward compat.
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
      team_name TEXT NOT NULL COLLATE NOCASE,
      sportlink_id TEXT UNIQUE,
      stadion_id INTEGER,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_teams_hash
      ON stadion_teams (source_hash, last_synced_hash);

    CREATE INDEX IF NOT EXISTS idx_stadion_teams_name
      ON stadion_teams (team_name COLLATE NOCASE);

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

    CREATE TABLE IF NOT EXISTS stadion_commissies (
      id INTEGER PRIMARY KEY,
      commissie_name TEXT NOT NULL UNIQUE,
      sportlink_id TEXT UNIQUE,
      stadion_id INTEGER,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_synced_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_commissies_hash
      ON stadion_commissies (source_hash, last_synced_hash);

    CREATE INDEX IF NOT EXISTS idx_stadion_commissies_name
      ON stadion_commissies (commissie_name);

    CREATE TABLE IF NOT EXISTS sportlink_member_functions (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      function_description TEXT NOT NULL,
      relation_start TEXT,
      relation_end TEXT,
      is_active INTEGER DEFAULT 1,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, function_description)
    );

    CREATE INDEX IF NOT EXISTS idx_sportlink_member_functions_knvb
      ON sportlink_member_functions (knvb_id);

    CREATE TABLE IF NOT EXISTS sportlink_member_committees (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      committee_name TEXT NOT NULL,
      sportlink_committee_id TEXT,
      role_name TEXT,
      relation_start TEXT,
      relation_end TEXT,
      is_active INTEGER DEFAULT 1,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, committee_name)
    );

    CREATE INDEX IF NOT EXISTS idx_sportlink_member_committees_knvb
      ON sportlink_member_committees (knvb_id);

    CREATE TABLE IF NOT EXISTS stadion_commissie_work_history (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      commissie_name TEXT NOT NULL,
      role_name TEXT,
      stadion_work_history_id INTEGER,
      is_backfill INTEGER DEFAULT 0,
      source_hash TEXT NOT NULL,
      last_synced_hash TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(knvb_id, commissie_name, role_name)
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_commissie_work_history_member
      ON stadion_commissie_work_history (knvb_id);

    CREATE TABLE IF NOT EXISTS sportlink_member_free_fields (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL UNIQUE,
      freescout_id INTEGER,
      vog_datum TEXT,
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sportlink_member_free_fields_knvb
      ON sportlink_member_free_fields (knvb_id);

    CREATE TABLE IF NOT EXISTS sportlink_member_invoice_data (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL UNIQUE,
      -- Invoice Address
      invoice_street TEXT,
      invoice_house_number TEXT,
      invoice_house_number_addition TEXT,
      invoice_postal_code TEXT,
      invoice_city TEXT,
      invoice_country TEXT,
      invoice_address_is_default INTEGER DEFAULT 1,
      -- Invoice Contact
      invoice_last_name TEXT,
      invoice_infix TEXT,
      invoice_initials TEXT,
      invoice_email TEXT,
      invoice_external_code TEXT,
      -- Metadata
      source_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sportlink_member_invoice_data_knvb
      ON sportlink_member_invoice_data (knvb_id);
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

  // Add photo URL columns if they don't exist (Phase 19 migration)
  if (!memberColumns.some(col => col.name === 'photo_url')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN photo_url TEXT');
  }

  if (!memberColumns.some(col => col.name === 'photo_date')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN photo_date TEXT');
  }

  // Add bidirectional timestamp columns for conflict detection (Phase 20)
  // These track when each syncable field was last modified in each system
  // NULL means "modified before tracking started"

  // email timestamps
  if (!memberColumns.some(col => col.name === 'email_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN email_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'email_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN email_sportlink_modified TEXT');
  }

  // email2 timestamps
  if (!memberColumns.some(col => col.name === 'email2_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN email2_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'email2_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN email2_sportlink_modified TEXT');
  }

  // mobile timestamps
  if (!memberColumns.some(col => col.name === 'mobile_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN mobile_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'mobile_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN mobile_sportlink_modified TEXT');
  }

  // phone timestamps
  if (!memberColumns.some(col => col.name === 'phone_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN phone_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'phone_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN phone_sportlink_modified TEXT');
  }

  // datum_vog timestamps
  if (!memberColumns.some(col => col.name === 'datum_vog_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN datum_vog_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'datum_vog_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN datum_vog_sportlink_modified TEXT');
  }

  // freescout_id timestamps
  if (!memberColumns.some(col => col.name === 'freescout_id_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN freescout_id_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'freescout_id_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN freescout_id_sportlink_modified TEXT');
  }

  // financiele_blokkade timestamps
  if (!memberColumns.some(col => col.name === 'financiele_blokkade_stadion_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN financiele_blokkade_stadion_modified TEXT');
  }
  if (!memberColumns.some(col => col.name === 'financiele_blokkade_sportlink_modified')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN financiele_blokkade_sportlink_modified TEXT');
  }

  // sync_origin tracks last edit source (user_edit, sync_sportlink_to_stadion, sync_stadion_to_sportlink)
  if (!memberColumns.some(col => col.name === 'sync_origin')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN sync_origin TEXT');
  }

  // tracked_fields_hash for change detection (Phase 22)
  if (!memberColumns.some(col => col.name === 'tracked_fields_hash')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN tracked_fields_hash TEXT');
  }

  // huidig_vrijwilliger status from Rondo Club (Quick 016)
  if (!memberColumns.some(col => col.name === 'huidig_vrijwilliger')) {
    db.exec('ALTER TABLE stadion_members ADD COLUMN huidig_vrijwilliger INTEGER DEFAULT 0');
  }

  // conflict_resolutions audit table (Phase 21)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conflict_resolutions (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      sportlink_value TEXT,
      stadion_value TEXT,
      sportlink_modified TEXT,
      stadion_modified TEXT,
      winning_system TEXT NOT NULL,
      resolution_reason TEXT NOT NULL,
      resolved_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_knvb
      ON conflict_resolutions (knvb_id);

    CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_resolved
      ON conflict_resolutions (resolved_at);
  `);

  // stadion_change_detections audit table (Phase 22)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stadion_change_detections (
      id INTEGER PRIMARY KEY,
      knvb_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      detected_at TEXT NOT NULL,
      stadion_modified_gmt TEXT NOT NULL,
      detection_run_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stadion_change_detections_knvb
      ON stadion_change_detections (knvb_id);

    CREATE INDEX IF NOT EXISTS idx_stadion_change_detections_detected
      ON stadion_change_detections (detected_at);
  `);

  // reverse_sync_state singleton table (Phase 22)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reverse_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_detection_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Add synced_at column for reverse sync tracking (Phase 23)
  const changeDetectionColumns = db.prepare('PRAGMA table_info(stadion_change_detections)').all();
  if (!changeDetectionColumns.some(col => col.name === 'synced_at')) {
    db.exec('ALTER TABLE stadion_change_detections ADD COLUMN synced_at TEXT');
  }

  // Add MemberHeader columns to sportlink_member_free_fields if they don't exist
  const freeFieldColumns = db.prepare('PRAGMA table_info(sportlink_member_free_fields)').all();

  if (!freeFieldColumns.some(col => col.name === 'has_financial_block')) {
    db.exec('ALTER TABLE sportlink_member_free_fields ADD COLUMN has_financial_block INTEGER DEFAULT 0');
  }

  if (!freeFieldColumns.some(col => col.name === 'photo_url')) {
    db.exec('ALTER TABLE sportlink_member_free_fields ADD COLUMN photo_url TEXT');
  }

  if (!freeFieldColumns.some(col => col.name === 'photo_date')) {
    db.exec('ALTER TABLE sportlink_member_free_fields ADD COLUMN photo_date TEXT');
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

  if (!teamColumns.some(col => col.name === 'team_code')) {
    db.exec('ALTER TABLE stadion_teams ADD COLUMN team_code TEXT');
  }

  // Migration: Check if we need to migrate from team_name UNIQUE to sportlink_id UNIQUE
  // This is needed because old schema had UNIQUE on team_name which causes issues with team renames
  const teamIndexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='stadion_teams'").all();
  const hasTeamNameUnique = teamIndexes.some(idx => idx.sql && idx.sql.includes('team_name') && idx.sql.toLowerCase().includes('unique'));

  // Also check for inline UNIQUE constraint by looking at table definition
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stadion_teams'").get();
  const hasInlineTeamNameUnique = tableInfo?.sql && tableInfo.sql.includes('team_name') && tableInfo.sql.includes('UNIQUE');

  // If team_name has UNIQUE constraint (inline or index), migrate the table
  if (hasInlineTeamNameUnique) {
    db.exec(`
      -- Create new table with correct schema
      CREATE TABLE IF NOT EXISTS stadion_teams_new (
        id INTEGER PRIMARY KEY,
        team_name TEXT NOT NULL COLLATE NOCASE,
        sportlink_id TEXT UNIQUE,
        team_code TEXT,
        stadion_id INTEGER,
        source_hash TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_synced_at TEXT,
        last_synced_hash TEXT,
        created_at TEXT NOT NULL,
        game_activity TEXT,
        gender TEXT,
        player_count INTEGER,
        staff_count INTEGER
      );

      -- Copy data from old table
      INSERT INTO stadion_teams_new (
        id, team_name, sportlink_id, team_code, stadion_id, source_hash,
        last_seen_at, last_synced_at, last_synced_hash, created_at,
        game_activity, gender, player_count, staff_count
      )
      SELECT
        id, team_name, sportlink_id, team_code, stadion_id, source_hash,
        last_seen_at, last_synced_at, last_synced_hash, created_at,
        game_activity, gender, player_count, staff_count
      FROM stadion_teams;

      -- Drop old table
      DROP TABLE stadion_teams;

      -- Rename new table
      ALTER TABLE stadion_teams_new RENAME TO stadion_teams;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_stadion_teams_hash
        ON stadion_teams (source_hash, last_synced_hash);

      CREATE INDEX IF NOT EXISTS idx_stadion_teams_name
        ON stadion_teams (team_name COLLATE NOCASE);
    `);
  }

  // Remove deprecated member_type column (v20.0 Phase 154)
  const teamMemberColumns = db.prepare('PRAGMA table_info(sportlink_team_members)').all();
  if (teamMemberColumns.some(col => col.name === 'member_type')) {
    db.exec('ALTER TABLE sportlink_team_members DROP COLUMN member_type');
  }
}

/**
 * Insert or update member records in bulk.
 * Each member: { knvb_id, email, data, person_image_date, photo_url, photo_date }
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
      photo_url,
      photo_date,
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
      @photo_url,
      @photo_date,
      CASE
        WHEN @photo_url IS NOT NULL THEN 'pending_download'
        WHEN @person_image_date IS NOT NULL THEN 'pending_download'
        ELSE 'no_photo'
      END,
      @photo_state_updated_at
    )
    ON CONFLICT(knvb_id) DO UPDATE SET
      email = excluded.email,
      data_json = excluded.data_json,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at,
      person_image_date = excluded.person_image_date,
      photo_url = excluded.photo_url,
      photo_date = excluded.photo_date,
      photo_state = CASE
        -- Photo added or changed (URL or date differs) - use photo_url when available
        WHEN excluded.photo_url IS NOT NULL
             AND (stadion_members.photo_url IS NULL
                  OR excluded.photo_url != stadion_members.photo_url
                  OR excluded.photo_date != stadion_members.photo_date)
          THEN 'pending_download'
        -- Fallback to person_image_date for members without photo_url
        WHEN excluded.photo_url IS NULL
             AND excluded.person_image_date IS NOT NULL
             AND (stadion_members.person_image_date IS NULL
                  OR excluded.person_image_date != stadion_members.person_image_date)
          THEN 'pending_download'
        -- Photo removed: only trust person_image_date going null as a delete signal
        -- Do NOT use photo_url going null, as that can happen when free fields
        -- data is temporarily unavailable (failed API call, incomplete sync)
        WHEN excluded.person_image_date IS NULL
             AND stadion_members.person_image_date IS NOT NULL
             AND stadion_members.photo_state IN ('synced', 'pending_upload', 'downloaded', 'pending_download')
          THEN 'pending_delete'
        -- No change: keep current state
        ELSE stadion_members.photo_state
      END,
      photo_state_updated_at = CASE
        -- Photo changed via photo_url
        WHEN excluded.photo_url IS NOT NULL
             AND (stadion_members.photo_url IS NULL
                  OR excluded.photo_url != stadion_members.photo_url
                  OR excluded.photo_date != stadion_members.photo_date)
          THEN excluded.photo_state_updated_at
        -- Photo changed via person_image_date (fallback)
        WHEN excluded.photo_url IS NULL
             AND excluded.person_image_date IS NOT NULL
             AND (stadion_members.person_image_date IS NULL
                  OR excluded.person_image_date != stadion_members.person_image_date)
          THEN excluded.photo_state_updated_at
        -- Photo removed
        WHEN excluded.photo_url IS NULL
             AND stadion_members.photo_url IS NOT NULL
          THEN excluded.photo_state_updated_at
        WHEN excluded.photo_url IS NULL
             AND excluded.person_image_date IS NULL
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
      photo_url: member.photo_url || null,
      photo_date: member.photo_date || null,
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
 * Update sync state after successful sync to Rondo Club.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateSyncState(db, knvbId, sourceHash, rondoClubId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_members
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE knvb_id = ?
  `);
  stmt.run(now, sourceHash, rondoClubId || null, knvbId);
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
 * Get ALL tracked members with their KNVB ID and Rondo Club ID.
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
  return computeHash(payload);
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
 * Update sync state after successful parent sync to Rondo Club.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateParentSyncState(db, email, sourceHash, rondoClubId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_parents
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE email = ?
  `);
  stmt.run(now, sourceHash, rondoClubId || null, email);
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
 * Get members needing photo download with their photo URLs
 * @param {Object} db - SQLite database connection
 * @returns {Array<{knvb_id: string, photo_url: string, photo_date: string, stadion_id: number}>}
 */
function getMembersNeedingPhotoDownload(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, photo_url, photo_date, stadion_id
    FROM stadion_members
    WHERE photo_state = 'pending_download'
      AND photo_url IS NOT NULL
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
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
 * Clear expired photo URL while keeping pending_download state.
 *
 * When a Sportlink CDN signed URL expires (~4 hours after generation),
 * the photo cannot be downloaded. This clears the stale URL from both
 * stadion_members and sportlink_member_free_fields so the next functions
 * sync will generate a fresh signed URL.
 *
 * The member stays in 'pending_download' state (with photo_url = NULL),
 * so getMembersNeedingPhotoDownload will skip it (requires photo_url IS NOT NULL).
 * Once the next functions sync provides a fresh URL, the upsert will detect the
 * URL change (NULL -> new URL) and the member will be eligible for download again.
 *
 * @param {Object} db - SQLite database connection
 * @param {string} knvbId - Member KNVB ID
 */
function clearExpiredPhotoUrl(db, knvbId) {
  const now = new Date().toISOString();

  // Clear URL in stadion_members (keep pending_download state)
  const memberStmt = db.prepare(`
    UPDATE stadion_members
    SET photo_url = NULL, photo_state_updated_at = ?
    WHERE knvb_id = ?
  `);
  memberStmt.run(now, knvbId);

  // Clear URL in sportlink_member_free_fields to prevent the people pipeline
  // from re-populating stadion_members with the same expired URL
  const freeFieldsStmt = db.prepare(`
    UPDATE sportlink_member_free_fields
    SET photo_url = NULL
    WHERE knvb_id = ?
  `);
  freeFieldsStmt.run(knvbId);
}

/**
 * Compute hash for important date tracking
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
 */
function computeDateHash(knvbId, dateType, dateValue) {
  const payload = stableStringify({ knvb_id: knvbId, date_type: dateType, date_value: dateValue });
  return computeHash(payload);
}

/**
 * Upsert important date record
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
 */
function getImportantDatesCount(db) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM stadion_important_dates');
  return stmt.get().count;
}

/**
 * Get synced important dates count
 * @deprecated v2.3 - Birthday sync now uses acf.birthdate on person records
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
  return computeHash(payload);
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
      SELECT team_name, sportlink_id, game_activity, gender, source_hash, stadion_id, last_synced_hash
      FROM stadion_teams
      ORDER BY team_name ASC
    `)
    : db.prepare(`
      SELECT team_name, sportlink_id, game_activity, gender, source_hash, stadion_id, last_synced_hash
      FROM stadion_teams
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY team_name ASC
    `);

  return stmt.all();
}

/**
 * Update sync state after successful team sync to Rondo Club.
 * Stores WordPress post ID for future updates/deletes.
 */
function updateTeamSyncState(db, sportlinkId, sourceHash, rondoClubId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_teams
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE sportlink_id = ?
  `);
  stmt.run(now, sourceHash, rondoClubId || null, sportlinkId);
}

/**
 * Get all teams with their stadion_id (for Phase 14 mapping).
 * Returns: [{ team_name, team_code, stadion_id }]
 */
function getAllTeams(db) {
  const stmt = db.prepare(`
    SELECT team_name, team_code, stadion_id
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
  return computeHash(payload);
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
  return computeHash(payload);
}

/**
 * Insert or update team records with extended metadata.
 * Each team: { team_name, sportlink_id, game_activity, gender, player_count, staff_count }
 *
 * Uses sportlink_id as the conflict key so team renames are handled correctly:
 * - If a team is renamed in Sportlink, the existing row is updated with the new name
 * - The stadion_id (WordPress post ID) is preserved, allowing the WordPress title to be updated
 */
function upsertTeamsWithMetadata(db, teams) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_teams (
      team_name,
      sportlink_id,
      team_code,
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
      @team_code,
      @game_activity,
      @gender,
      @player_count,
      @staff_count,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(sportlink_id) DO UPDATE SET
      team_name = excluded.team_name,
      team_code = excluded.team_code,
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
    team_code: team.team_code || null,
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
function computeTeamMemberHash(sportlinkTeamId, sportlinkPersonId, roleDescription) {
  const payload = stableStringify({
    sportlink_team_id: sportlinkTeamId,
    sportlink_person_id: sportlinkPersonId,
    role_description: roleDescription
  });
  return computeHash(payload);
}

/**
 * Insert or update team member records in bulk.
 * Each member: { sportlink_team_id, sportlink_person_id, role_description }
 */
function upsertTeamMembers(db, members) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_team_members (
      sportlink_team_id,
      sportlink_person_id,
      role_description,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @sportlink_team_id,
      @sportlink_person_id,
      @role_description,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(sportlink_team_id, sportlink_person_id) DO UPDATE SET
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
    role_description: member.role_description || null,
    source_hash: computeTeamMemberHash(
      member.sportlink_team_id,
      member.sportlink_person_id,
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
    SELECT tm.role_description
    FROM sportlink_team_members tm
    JOIN stadion_teams t ON tm.sportlink_team_id = t.sportlink_id
    WHERE tm.sportlink_person_id = ?
      AND t.team_name = ? COLLATE NOCASE
  `);
  const row = stmt.get(knvbId, teamName);
  return row?.role_description || null;
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
 * Find teams in database that are not in the current team list (orphans).
 * @param {Object} db - Database connection
 * @param {Array<string>} currentTeamNames - Current team names from Sportlink
 * @returns {Array<{team_name: string, stadion_id: number}>}
 */
function getOrphanTeams(db, currentTeamNames) {
  if (!currentTeamNames || currentTeamNames.length === 0) {
    // All tracked teams are orphans if list is empty
    const stmt = db.prepare(`
      SELECT team_name, stadion_id
      FROM stadion_teams
      ORDER BY team_name ASC
    `);
    return stmt.all();
  }

  const placeholders = currentTeamNames.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT team_name, stadion_id
    FROM stadion_teams
    WHERE team_name COLLATE NOCASE NOT IN (${placeholders})
    ORDER BY team_name ASC
  `);

  return stmt.all(...currentTeamNames);
}

/**
 * Delete a team from tracking database.
 * @param {Object} db - Database connection
 * @param {string} teamName - Team name to delete
 */
function deleteTeam(db, teamName) {
  const stmt = db.prepare(`
    DELETE FROM stadion_teams
    WHERE team_name = ? COLLATE NOCASE
  `);
  stmt.run(teamName);
}

/**
 * Delete a team by sportlink_id.
 * @param {Object} db - Database connection
 * @param {string} sportlinkId - Sportlink team ID to delete
 */
function deleteTeamBySportlinkId(db, sportlinkId) {
  const stmt = db.prepare(`
    DELETE FROM stadion_teams
    WHERE sportlink_id = ?
  `);
  stmt.run(sportlinkId);
}

/**
 * Get all teams for sync operation (includes all columns needed).
 * @param {Object} db - Database connection
 * @returns {Array<{team_name: string, sportlink_id: string, stadion_id: number, source_hash: string, last_synced_hash: string}>}
 */
function getAllTeamsForSync(db) {
  const stmt = db.prepare(`
    SELECT team_name, sportlink_id, game_activity, gender, stadion_id, source_hash, last_synced_hash
    FROM stadion_teams
    ORDER BY team_name ASC
  `);
  return stmt.all();
}

/**
 * Find teams in database that are not in the current Sportlink data (orphans).
 * Uses sportlink_id for comparison to handle team renames correctly.
 * @param {Object} db - Database connection
 * @param {Array<string>} currentSportlinkIds - Current Sportlink team IDs from download
 * @returns {Array<{team_name: string, sportlink_id: string, stadion_id: number}>}
 */
function getOrphanTeamsBySportlinkId(db, currentSportlinkIds) {
  if (!currentSportlinkIds || currentSportlinkIds.length === 0) {
    // All tracked teams are orphans if list is empty
    const stmt = db.prepare(`
      SELECT team_name, sportlink_id, stadion_id
      FROM stadion_teams
      ORDER BY team_name ASC
    `);
    return stmt.all();
  }

  const placeholders = currentSportlinkIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT team_name, sportlink_id, stadion_id
    FROM stadion_teams
    WHERE sportlink_id IS NULL
       OR sportlink_id NOT IN (${placeholders})
    ORDER BY team_name ASC
  `);

  return stmt.all(...currentSportlinkIds);
}

// ============================================================================
// COMMISSIE FUNCTIONS
// ============================================================================

/**
 * Compute SHA-256 hash of commissie data for change detection.
 */
function computeCommissieHash(commissieName, sportlinkId = null) {
  const payload = stableStringify({ commissie_name: commissieName, sportlink_id: sportlinkId });
  return computeHash(payload);
}

/**
 * Insert or update commissie records in bulk.
 * Each commissie: { commissie_name, sportlink_id }
 */
function upsertCommissies(db, commissies) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_commissies (
      commissie_name,
      sportlink_id,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @commissie_name,
      @sportlink_id,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(commissie_name) DO UPDATE SET
      sportlink_id = COALESCE(excluded.sportlink_id, stadion_commissies.sportlink_id),
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = commissies.map((commissie) => ({
    commissie_name: commissie.commissie_name,
    sportlink_id: commissie.sportlink_id || null,
    source_hash: computeCommissieHash(commissie.commissie_name, commissie.sportlink_id),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get commissies needing sync (source_hash != last_synced_hash).
 * If force=true, return all commissies regardless of sync state.
 * Returns: [{ commissie_name, sportlink_id, source_hash, stadion_id }]
 */
function getCommissiesNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
      SELECT commissie_name, sportlink_id, source_hash, stadion_id, last_synced_hash
      FROM stadion_commissies
      ORDER BY commissie_name ASC
    `)
    : db.prepare(`
      SELECT commissie_name, sportlink_id, source_hash, stadion_id, last_synced_hash
      FROM stadion_commissies
      WHERE last_synced_hash IS NULL OR last_synced_hash != source_hash
      ORDER BY commissie_name ASC
    `);

  return stmt.all();
}

/**
 * Update sync state after successful commissie sync to Rondo Club.
 */
function updateCommissieSyncState(db, commissieName, sourceHash, rondoClubId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_commissies
    SET last_synced_at = ?, last_synced_hash = ?, stadion_id = ?
    WHERE commissie_name = ?
  `);
  stmt.run(now, sourceHash, rondoClubId || null, commissieName);
}

/**
 * Get all commissies with their stadion_id.
 * Returns: [{ commissie_name, stadion_id }]
 */
function getAllCommissies(db) {
  const stmt = db.prepare(`
    SELECT commissie_name, stadion_id
    FROM stadion_commissies
    WHERE stadion_id IS NOT NULL
    ORDER BY commissie_name ASC
  `);
  return stmt.all();
}

/**
 * Get a commissie by name.
 * @param {Object} db - Database connection
 * @param {string} name - Commissie name
 * @returns {Object|null} - Commissie record or null
 */
function getCommissieByName(db, name) {
  const stmt = db.prepare(`
    SELECT commissie_name, sportlink_id, stadion_id, source_hash, last_synced_hash
    FROM stadion_commissies
    WHERE commissie_name = ?
  `);
  return stmt.get(name) || null;
}

/**
 * Delete a commissie from tracking database.
 * @param {Object} db - Database connection
 * @param {string} commissieName - Commissie name to delete
 */
function deleteCommissie(db, commissieName) {
  const stmt = db.prepare(`
    DELETE FROM stadion_commissies
    WHERE commissie_name = ?
  `);
  stmt.run(commissieName);
}

/**
 * Find commissies in database that are not in the current list (orphans).
 * @param {Object} db - Database connection
 * @param {Array<string>} currentNames - Current commissie names from Sportlink
 * @returns {Array<{commissie_name: string, stadion_id: number}>}
 */
function getOrphanCommissies(db, currentNames) {
  if (!currentNames || currentNames.length === 0) {
    const stmt = db.prepare(`
      SELECT commissie_name, stadion_id
      FROM stadion_commissies
      ORDER BY commissie_name ASC
    `);
    return stmt.all();
  }

  const placeholders = currentNames.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT commissie_name, stadion_id
    FROM stadion_commissies
    WHERE commissie_name NOT IN (${placeholders})
    ORDER BY commissie_name ASC
  `);

  return stmt.all(...currentNames);
}

// ============================================================================
// MEMBER FUNCTIONS (Club-level functions like "Voorzitter")
// ============================================================================

/**
 * Compute hash for member function record.
 */
function computeMemberFunctionHash(knvbId, functionDescription, relationStart, relationEnd, isActive) {
  const payload = stableStringify({
    knvb_id: knvbId,
    function_description: functionDescription,
    relation_start: relationStart,
    relation_end: relationEnd,
    is_active: isActive
  });
  return computeHash(payload);
}

/**
 * Insert or update member function records in bulk.
 * Each function: { knvb_id, function_description, relation_start, relation_end, is_active }
 */
function upsertMemberFunctions(db, functions) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_member_functions (
      knvb_id,
      function_description,
      relation_start,
      relation_end,
      is_active,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @knvb_id,
      @function_description,
      @relation_start,
      @relation_end,
      @is_active,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(knvb_id, function_description) DO UPDATE SET
      relation_start = excluded.relation_start,
      relation_end = excluded.relation_end,
      is_active = excluded.is_active,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = functions.map((func) => ({
    knvb_id: func.knvb_id,
    function_description: func.function_description,
    relation_start: func.relation_start || null,
    relation_end: func.relation_end || null,
    is_active: func.is_active ? 1 : 0,
    source_hash: computeMemberFunctionHash(
      func.knvb_id,
      func.function_description,
      func.relation_start,
      func.relation_end,
      func.is_active
    ),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get all member functions for a member.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {Array<{function_description: string, relation_start: string, relation_end: string, is_active: number}>}
 */
function getMemberFunctions(db, knvbId) {
  const stmt = db.prepare(`
    SELECT function_description, relation_start, relation_end, is_active
    FROM sportlink_member_functions
    WHERE knvb_id = ?
    ORDER BY function_description ASC
  `);
  return stmt.all(knvbId);
}

/**
 * Get all active member functions.
 * @param {Object} db - Database connection
 * @returns {Array<{knvb_id: string, function_description: string, relation_start: string}>}
 */
function getAllActiveMemberFunctions(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, function_description, relation_start, relation_end
    FROM sportlink_member_functions
    WHERE is_active = 1
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
}

/**
 * Clear all member functions for fresh import.
 * @param {Object} db - Database connection
 */
function clearMemberFunctions(db) {
  db.exec('DELETE FROM sportlink_member_functions');
}

// ============================================================================
// MEMBER COMMITTEES (Committee memberships like "Jeugdcommissie")
// ============================================================================

/**
 * Compute hash for member committee record.
 */
function computeMemberCommitteeHash(knvbId, committeeName, roleName, relationStart, relationEnd, isActive) {
  const payload = stableStringify({
    knvb_id: knvbId,
    committee_name: committeeName,
    role_name: roleName,
    relation_start: relationStart,
    relation_end: relationEnd,
    is_active: isActive
  });
  return computeHash(payload);
}

/**
 * Insert or update member committee records in bulk.
 * Each committee: { knvb_id, committee_name, sportlink_committee_id, role_name, relation_start, relation_end, is_active }
 */
function upsertMemberCommittees(db, committees) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_member_committees (
      knvb_id,
      committee_name,
      sportlink_committee_id,
      role_name,
      relation_start,
      relation_end,
      is_active,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @knvb_id,
      @committee_name,
      @sportlink_committee_id,
      @role_name,
      @relation_start,
      @relation_end,
      @is_active,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(knvb_id, committee_name) DO UPDATE SET
      sportlink_committee_id = excluded.sportlink_committee_id,
      role_name = excluded.role_name,
      relation_start = excluded.relation_start,
      relation_end = excluded.relation_end,
      is_active = excluded.is_active,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = committees.map((comm) => ({
    knvb_id: comm.knvb_id,
    committee_name: comm.committee_name,
    sportlink_committee_id: comm.sportlink_committee_id || null,
    role_name: comm.role_name || null,
    relation_start: comm.relation_start || null,
    relation_end: comm.relation_end || null,
    is_active: comm.is_active ? 1 : 0,
    source_hash: computeMemberCommitteeHash(
      comm.knvb_id,
      comm.committee_name,
      comm.role_name,
      comm.relation_start,
      comm.relation_end,
      comm.is_active
    ),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get all member committees for a member.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {Array<{committee_name: string, role_name: string, relation_start: string, relation_end: string, is_active: number}>}
 */
function getMemberCommittees(db, knvbId) {
  const stmt = db.prepare(`
    SELECT committee_name, role_name, relation_start, relation_end, is_active
    FROM sportlink_member_committees
    WHERE knvb_id = ?
    ORDER BY committee_name ASC
  `);
  return stmt.all(knvbId);
}

/**
 * Get all active member committees.
 * @param {Object} db - Database connection
 * @returns {Array<{knvb_id: string, committee_name: string, role_name: string, relation_start: string}>}
 */
function getAllActiveMemberCommittees(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, committee_name, role_name, relation_start, relation_end
    FROM sportlink_member_committees
    WHERE is_active = 1
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
}

/**
 * Clear all member committees for fresh import.
 * @param {Object} db - Database connection
 */
function clearMemberCommittees(db) {
  db.exec('DELETE FROM sportlink_member_committees');
}

/**
 * Get all unique committee names from member committees.
 * @param {Object} db - Database connection
 * @returns {Array<string>} - Unique committee names
 */
function getUniqueCommitteeNames(db) {
  const stmt = db.prepare(`
    SELECT DISTINCT committee_name
    FROM sportlink_member_committees
    ORDER BY committee_name ASC
  `);
  return stmt.all().map(row => row.committee_name);
}

// ============================================================================
// COMMISSIE WORK HISTORY (Work history for commissie memberships)
// ============================================================================

/**
 * Compute hash for commissie work history record.
 */
function computeCommissieWorkHistoryHash(knvbId, commissieName, roleName, isActive) {
  const payload = stableStringify({
    knvb_id: knvbId,
    commissie_name: commissieName,
    role_name: roleName,
    is_active: isActive
  });
  return computeHash(payload);
}

/**
 * Insert or update commissie work history records in bulk.
 * Each record: { knvb_id, commissie_name, is_backfill }
 */
function upsertCommissieWorkHistory(db, records) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_commissie_work_history (
      knvb_id,
      commissie_name,
      role_name,
      is_backfill,
      source_hash,
      created_at
    )
    VALUES (
      @knvb_id,
      @commissie_name,
      @role_name,
      @is_backfill,
      @source_hash,
      @created_at
    )
    ON CONFLICT(knvb_id, commissie_name, role_name) DO UPDATE SET
      source_hash = excluded.source_hash,
      is_backfill = excluded.is_backfill
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = records.map((record) => ({
    knvb_id: record.knvb_id,
    commissie_name: record.commissie_name,
    role_name: record.role_name || null,
    is_backfill: record.is_backfill ? 1 : 0,
    source_hash: computeCommissieWorkHistoryHash(
      record.knvb_id,
      record.commissie_name,
      record.role_name,
      record.is_active
    ),
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get commissie work history records needing sync.
 * Joins with stadion_members to get stadion_id for each member.
 */
function getCommissieWorkHistoryNeedingSync(db, force = false) {
  const stmt = force
    ? db.prepare(`
        SELECT w.knvb_id, w.commissie_name, w.is_backfill, w.source_hash,
               w.stadion_work_history_id, m.stadion_id
        FROM stadion_commissie_work_history w
        JOIN stadion_members m ON w.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
        ORDER BY w.knvb_id ASC, w.commissie_name ASC
      `)
    : db.prepare(`
        SELECT w.knvb_id, w.commissie_name, w.is_backfill, w.source_hash,
               w.stadion_work_history_id, m.stadion_id
        FROM stadion_commissie_work_history w
        JOIN stadion_members m ON w.knvb_id = m.knvb_id
        WHERE m.stadion_id IS NOT NULL
          AND (w.last_synced_hash IS NULL OR w.last_synced_hash != w.source_hash)
        ORDER BY w.knvb_id ASC, w.commissie_name ASC
      `);
  return stmt.all();
}

/**
 * Get all commissie work history for a member.
 */
function getMemberCommissieWorkHistory(db, knvbId) {
  const stmt = db.prepare(`
    SELECT commissie_name, role_name, is_backfill, last_synced_at, stadion_work_history_id
    FROM stadion_commissie_work_history
    WHERE knvb_id = ?
    ORDER BY commissie_name ASC, role_name ASC
  `);
  return stmt.all(knvbId);
}

/**
 * Update commissie work history sync state after successful sync.
 */
function updateCommissieWorkHistorySyncState(db, knvbId, commissieName, roleName, sourceHash, stadionWorkHistoryId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE stadion_commissie_work_history
    SET last_synced_at = ?, last_synced_hash = ?, stadion_work_history_id = ?
    WHERE knvb_id = ? AND commissie_name = ? AND (role_name = ? OR (role_name IS NULL AND ? IS NULL))
  `);
  stmt.run(now, sourceHash, stadionWorkHistoryId, knvbId, commissieName, roleName, roleName);
}

/**
 * Delete a commissie work history record from tracking.
 */
function deleteCommissieWorkHistory(db, knvbId, commissieName, roleName) {
  const stmt = db.prepare(`
    DELETE FROM stadion_commissie_work_history
    WHERE knvb_id = ? AND commissie_name = ? AND (role_name = ? OR (role_name IS NULL AND ? IS NULL))
  `);
  stmt.run(knvbId, commissieName, roleName, roleName);
}

/**
 * Delete all commissie work history records for a member.
 */
function deleteAllMemberCommissieWorkHistory(db, knvbId) {
  const stmt = db.prepare(`
    DELETE FROM stadion_commissie_work_history
    WHERE knvb_id = ?
  `);
  stmt.run(knvbId);
}

// ============================================================================
// MEMBER FREE FIELDS (FreeScout ID, VOG datum from Sportlink /other tab)
// ============================================================================

/**
 * Compute hash for member free fields record.
 */
function computeMemberFreeFieldsHash(knvbId, freescoutId, vogDatum, hasFinancialBlock, photoUrl, photoDate) {
  const payload = stableStringify({
    knvb_id: knvbId,
    freescout_id: freescoutId,
    vog_datum: vogDatum,
    has_financial_block: hasFinancialBlock,
    photo_url: photoUrl,
    photo_date: photoDate
  });
  return computeHash(payload);
}

/**
 * Insert or update member free fields records in bulk.
 * Each record: { knvb_id, freescout_id, vog_datum, has_financial_block, photo_url, photo_date }
 */
function upsertMemberFreeFields(db, records) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_member_free_fields (
      knvb_id,
      freescout_id,
      vog_datum,
      has_financial_block,
      photo_url,
      photo_date,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @knvb_id,
      @freescout_id,
      @vog_datum,
      @has_financial_block,
      @photo_url,
      @photo_date,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(knvb_id) DO UPDATE SET
      freescout_id = excluded.freescout_id,
      vog_datum = excluded.vog_datum,
      has_financial_block = excluded.has_financial_block,
      photo_url = excluded.photo_url,
      photo_date = excluded.photo_date,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = records.map((record) => ({
    knvb_id: record.knvb_id,
    freescout_id: record.freescout_id || null,
    vog_datum: record.vog_datum || null,
    has_financial_block: record.has_financial_block !== undefined ? record.has_financial_block : 0,
    photo_url: record.photo_url || null,
    photo_date: record.photo_date || null,
    source_hash: computeMemberFreeFieldsHash(
      record.knvb_id,
      record.freescout_id,
      record.vog_datum,
      record.has_financial_block !== undefined ? record.has_financial_block : 0,
      record.photo_url,
      record.photo_date
    ),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get free fields for a specific member by KNVB ID.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {{freescout_id: number|null, vog_datum: string|null, has_financial_block: number, photo_url: string|null, photo_date: string|null}|null}
 */
function getMemberFreeFieldsByKnvbId(db, knvbId) {
  const stmt = db.prepare(`
    SELECT freescout_id, vog_datum, has_financial_block, photo_url, photo_date
    FROM sportlink_member_free_fields
    WHERE knvb_id = ?
  `);
  return stmt.get(knvbId) || null;
}

/**
 * Get all member free fields.
 * @param {Object} db - Database connection
 * @returns {Array<{knvb_id: string, freescout_id: number|null, vog_datum: string|null, has_financial_block: number, photo_url: string|null, photo_date: string|null}>}
 */
function getAllMemberFreeFields(db) {
  const stmt = db.prepare(`
    SELECT knvb_id, freescout_id, vog_datum, has_financial_block, photo_url, photo_date
    FROM sportlink_member_free_fields
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
}

/**
 * Clear all member free fields for fresh import.
 * @param {Object} db - Database connection
 */
function clearMemberFreeFields(db) {
  db.exec('DELETE FROM sportlink_member_free_fields');
}

// ============================================================================
// MEMBER INVOICE DATA (Sportlink financial tab)
// ============================================================================

/**
 * Compute hash for member invoice data record.
 */
function computeMemberInvoiceDataHash(record) {
  const payload = stableStringify({
    knvb_id: record.knvb_id,
    invoice_street: record.invoice_street,
    invoice_house_number: record.invoice_house_number,
    invoice_house_number_addition: record.invoice_house_number_addition,
    invoice_postal_code: record.invoice_postal_code,
    invoice_city: record.invoice_city,
    invoice_country: record.invoice_country,
    invoice_address_is_default: record.invoice_address_is_default,
    invoice_last_name: record.invoice_last_name,
    invoice_infix: record.invoice_infix,
    invoice_initials: record.invoice_initials,
    invoice_email: record.invoice_email,
    invoice_external_code: record.invoice_external_code
  });
  return computeHash(payload);
}

/**
 * Insert or update member invoice data records in bulk.
 * Each record: { knvb_id, invoice_street, invoice_house_number, ... }
 * @param {Object} db - Database connection
 * @param {Array} records - Array of invoice data records
 */
function upsertMemberInvoiceData(db, records) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sportlink_member_invoice_data (
      knvb_id,
      invoice_street,
      invoice_house_number,
      invoice_house_number_addition,
      invoice_postal_code,
      invoice_city,
      invoice_country,
      invoice_address_is_default,
      invoice_last_name,
      invoice_infix,
      invoice_initials,
      invoice_email,
      invoice_external_code,
      source_hash,
      last_seen_at,
      created_at
    )
    VALUES (
      @knvb_id,
      @invoice_street,
      @invoice_house_number,
      @invoice_house_number_addition,
      @invoice_postal_code,
      @invoice_city,
      @invoice_country,
      @invoice_address_is_default,
      @invoice_last_name,
      @invoice_infix,
      @invoice_initials,
      @invoice_email,
      @invoice_external_code,
      @source_hash,
      @last_seen_at,
      @created_at
    )
    ON CONFLICT(knvb_id) DO UPDATE SET
      invoice_street = excluded.invoice_street,
      invoice_house_number = excluded.invoice_house_number,
      invoice_house_number_addition = excluded.invoice_house_number_addition,
      invoice_postal_code = excluded.invoice_postal_code,
      invoice_city = excluded.invoice_city,
      invoice_country = excluded.invoice_country,
      invoice_address_is_default = excluded.invoice_address_is_default,
      invoice_last_name = excluded.invoice_last_name,
      invoice_infix = excluded.invoice_infix,
      invoice_initials = excluded.invoice_initials,
      invoice_email = excluded.invoice_email,
      invoice_external_code = excluded.invoice_external_code,
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = records.map((record) => ({
    knvb_id: record.knvb_id,
    invoice_street: record.invoice_street || null,
    invoice_house_number: record.invoice_house_number || null,
    invoice_house_number_addition: record.invoice_house_number_addition || null,
    invoice_postal_code: record.invoice_postal_code || null,
    invoice_city: record.invoice_city || null,
    invoice_country: record.invoice_country || null,
    invoice_address_is_default: record.invoice_address_is_default !== undefined ? record.invoice_address_is_default : 1,
    invoice_last_name: record.invoice_last_name || null,
    invoice_infix: record.invoice_infix || null,
    invoice_initials: record.invoice_initials || null,
    invoice_email: record.invoice_email || null,
    invoice_external_code: record.invoice_external_code || null,
    source_hash: computeMemberInvoiceDataHash(record),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}

/**
 * Get invoice data for a specific member by KNVB ID.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @returns {Object|null} - Invoice data record or null
 */
function getMemberInvoiceDataByKnvbId(db, knvbId) {
  const stmt = db.prepare(`
    SELECT
      invoice_street,
      invoice_house_number,
      invoice_house_number_addition,
      invoice_postal_code,
      invoice_city,
      invoice_country,
      invoice_address_is_default,
      invoice_last_name,
      invoice_infix,
      invoice_initials,
      invoice_email,
      invoice_external_code
    FROM sportlink_member_invoice_data
    WHERE knvb_id = ?
  `);
  return stmt.get(knvbId) || null;
}

/**
 * Get all member invoice data.
 * @param {Object} db - Database connection
 * @returns {Array} - Array of invoice data records
 */
function getAllMemberInvoiceData(db) {
  const stmt = db.prepare(`
    SELECT
      knvb_id,
      invoice_street,
      invoice_house_number,
      invoice_house_number_addition,
      invoice_postal_code,
      invoice_city,
      invoice_country,
      invoice_address_is_default,
      invoice_last_name,
      invoice_infix,
      invoice_initials,
      invoice_email,
      invoice_external_code
    FROM sportlink_member_invoice_data
    ORDER BY knvb_id ASC
  `);
  return stmt.all();
}

/**
 * Clear all member invoice data for fresh import.
 * @param {Object} db - Database connection
 */
function clearMemberInvoiceData(db) {
  db.exec('DELETE FROM sportlink_member_invoice_data');
}

// ============================================================================
// CONFLICT RESOLUTION FUNCTIONS (Phase 21)
// ============================================================================

/**
 * Log a conflict resolution to the audit table.
 * @param {Object} db - Database connection
 * @param {Object} resolution - Resolution object
 * @param {string} resolution.knvb_id - Member KNVB ID
 * @param {string} resolution.field_name - Field name that had conflict
 * @param {string} resolution.sportlink_value - Value from Sportlink
 * @param {string} resolution.stadion_value - Value from Rondo Club
 * @param {string} resolution.sportlink_modified - Sportlink timestamp
 * @param {string} resolution.stadion_modified - Rondo Club timestamp
 * @param {string} resolution.winning_system - 'sportlink' or 'stadion'
 * @param {string} resolution.resolution_reason - Reason for resolution
 */
function logConflictResolution(db, resolution) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO conflict_resolutions (
      knvb_id,
      field_name,
      sportlink_value,
      stadion_value,
      sportlink_modified,
      stadion_modified,
      winning_system,
      resolution_reason,
      resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    resolution.knvb_id,
    resolution.field_name,
    resolution.sportlink_value,
    resolution.stadion_value,
    resolution.sportlink_modified,
    resolution.stadion_modified,
    resolution.winning_system,
    resolution.resolution_reason,
    now
  );
}

/**
 * Get conflict resolutions since a timestamp.
 * @param {Object} db - Database connection
 * @param {string|null} since - ISO timestamp or null for all
 * @returns {Array<Object>} - Array of resolution records
 */
function getConflictResolutions(db, since = null) {
  if (since) {
    const stmt = db.prepare(`
      SELECT *
      FROM conflict_resolutions
      WHERE resolved_at >= ?
      ORDER BY resolved_at DESC
    `);
    return stmt.all(since);
  } else {
    const stmt = db.prepare(`
      SELECT *
      FROM conflict_resolutions
      ORDER BY resolved_at DESC
    `);
    return stmt.all();
  }
}

/**
 * Get count of conflict resolutions since a timestamp.
 * @param {Object} db - Database connection
 * @param {string|null} since - ISO timestamp or null for total
 * @returns {number} - Count of resolutions
 */
function getConflictResolutionCount(db, since = null) {
  if (since) {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM conflict_resolutions
      WHERE resolved_at >= ?
    `);
    return stmt.get(since).count;
  } else {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM conflict_resolutions
    `);
    return stmt.get().count;
  }
}

// ============================================================================
// CHANGE DETECTION FUNCTIONS (Phase 22)
// ============================================================================

/**
 * Log a change detection to the audit table.
 * @param {Object} db - Database connection
 * @param {Object} detection - Detection object
 * @param {string} detection.knvb_id - Member KNVB ID
 * @param {string} detection.field_name - Field name that changed
 * @param {string} detection.old_value - Old field value
 * @param {string} detection.new_value - New field value
 * @param {string} detection.stadion_modified_gmt - Rondo Club modification timestamp
 * @param {string} detection.detection_run_id - Detection run ID
 */
function logChangeDetection(db, detection) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_change_detections (
      knvb_id,
      field_name,
      old_value,
      new_value,
      detected_at,
      stadion_modified_gmt,
      detection_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    detection.knvb_id,
    detection.field_name,
    detection.old_value,
    detection.new_value,
    now,
    detection.stadion_modified_gmt,
    detection.detection_run_id
  );
}

/**
 * Get change detections since a timestamp.
 * @param {Object} db - Database connection
 * @param {string|null} since - ISO timestamp or null for all
 * @returns {Array<Object>} - Array of detection records
 */
function getChangeDetections(db, since = null) {
  if (since) {
    const stmt = db.prepare(`
      SELECT *
      FROM stadion_change_detections
      WHERE detected_at >= ?
      ORDER BY detected_at DESC
    `);
    return stmt.all(since);
  } else {
    const stmt = db.prepare(`
      SELECT *
      FROM stadion_change_detections
      ORDER BY detected_at DESC
    `);
    return stmt.all();
  }
}

/**
 * Get last detection time from reverse_sync_state.
 * @param {Object} db - Database connection
 * @returns {string|null} - ISO timestamp or null if never run
 */
function getLastDetectionTime(db) {
  const stmt = db.prepare(`
    SELECT last_detection_at
    FROM reverse_sync_state
    WHERE id = 1
  `);
  const row = stmt.get();
  return row ? row.last_detection_at : null;
}

/**
 * Update last detection time in reverse_sync_state.
 * @param {Object} db - Database connection
 * @param {string} timestamp - ISO timestamp
 */
function updateLastDetectionTime(db, timestamp) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO reverse_sync_state (id, last_detection_at, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_detection_at = excluded.last_detection_at,
      updated_at = excluded.updated_at
  `);
  stmt.run(timestamp, now);
}

/**
 * Get unsynced contact field changes for reverse sync.
 * Returns changes detected in Rondo Club that haven't been pushed to Sportlink yet.
 * @param {Object} db - Database connection
 * @returns {Array<Object>} - Array of unsynced change records
 */
function getUnsyncedContactChanges(db) {
  const stmt = db.prepare(`
    SELECT *
    FROM stadion_change_detections
    WHERE field_name IN ('email', 'email2', 'mobile', 'phone')
      AND synced_at IS NULL
    ORDER BY detected_at ASC
  `);
  return stmt.all();
}

/**
 * Get all unsynced field changes (all 7 tracked fields).
 * Used by multi-page reverse sync to process all field types.
 * @param {Object} db - Database connection
 * @returns {Array<Object>} - Array of unsynced change records
 */
function getUnsyncedChanges(db) {
  const stmt = db.prepare(`
    SELECT *
    FROM stadion_change_detections
    WHERE field_name IN ('email', 'email2', 'mobile', 'phone', 'datum-vog', 'freescout-id', 'financiele-blokkade')
      AND synced_at IS NULL
    ORDER BY knvb_id, detected_at ASC
  `);
  return stmt.all();
}

/**
 * Mark specific field changes as synced for a member.
 * Used after successfully pushing changes to Sportlink.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {Array<string>} fieldNames - Array of field names to mark as synced
 */
function markChangesSynced(db, knvbId, fieldNames) {
  const now = new Date().toISOString();
  const placeholders = fieldNames.map(() => '?').join(',');
  const stmt = db.prepare(`
    UPDATE stadion_change_detections
    SET synced_at = ?
    WHERE knvb_id = ?
      AND field_name IN (${placeholders})
      AND synced_at IS NULL
  `);
  stmt.run(now, knvbId, ...fieldNames);
}

/**
 * Update Sportlink modification timestamps for fields after reverse sync.
 * This prevents the same values from being detected as changes again.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {string[]} fieldNames - Array of field names that were synced
 */
function updateSportlinkTimestamps(db, knvbId, fieldNames) {
  const now = new Date().toISOString();
  const { SYNC_ORIGIN } = require('./sync-origin');

  // Build dynamic SET clause for specified fields
  const setClauses = fieldNames.map(field => `${field}_sportlink_modified = ?`).join(', ');
  const values = fieldNames.map(() => now);

  const sql = `
    UPDATE stadion_members
    SET ${setClauses}, sync_origin = ?
    WHERE knvb_id = ?
  `;

  const stmt = db.prepare(sql);
  stmt.run(...values, SYNC_ORIGIN.SYNC_REVERSE, knvbId);
}

/**
 * Update volunteer status for a member.
 * @param {Object} db - Database connection
 * @param {string} knvbId - Member KNVB ID
 * @param {boolean|number} status - Volunteer status (truthy = 1, falsy = 0)
 */
function updateVolunteerStatus(db, knvbId, status) {
  db.prepare('UPDATE stadion_members SET huidig_vrijwilliger = ? WHERE knvb_id = ?').run(status ? 1 : 0, knvbId);
}

/**
 * Get volunteer status map for all members.
 * @param {Object} db - Database connection
 * @returns {Map<string, number>} Map of knvb_id -> volunteer status (1 or 0)
 */
function getVolunteerStatusMap(db) {
  const rows = db.prepare('SELECT knvb_id, huidig_vrijwilliger FROM stadion_members').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.knvb_id, row.huidig_vrijwilliger || 0);
  }
  return map;
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initDb,
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
  getMembersNeedingPhotoDownload,
  updatePhotoState,
  clearPhotoState,
  clearExpiredPhotoUrl,
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
  getOrphanTeams,
  getOrphanTeamsBySportlinkId,
  deleteTeam,
  deleteTeamBySportlinkId,
  getAllTeamsForSync,
  computeWorkHistoryHash,
  upsertWorkHistory,
  getWorkHistoryNeedingSync,
  getMemberWorkHistory,
  getWorkHistoryByMember,
  updateWorkHistorySyncState,
  deleteWorkHistory,
  deleteAllMemberWorkHistory,
  // Commissie functions
  computeCommissieHash,
  upsertCommissies,
  getCommissiesNeedingSync,
  updateCommissieSyncState,
  getAllCommissies,
  getCommissieByName,
  deleteCommissie,
  getOrphanCommissies,
  // Member functions (club-level)
  computeMemberFunctionHash,
  upsertMemberFunctions,
  getMemberFunctions,
  getAllActiveMemberFunctions,
  clearMemberFunctions,
  // Member committees
  computeMemberCommitteeHash,
  upsertMemberCommittees,
  getMemberCommittees,
  getAllActiveMemberCommittees,
  clearMemberCommittees,
  getUniqueCommitteeNames,
  // Commissie work history
  computeCommissieWorkHistoryHash,
  upsertCommissieWorkHistory,
  getCommissieWorkHistoryNeedingSync,
  getMemberCommissieWorkHistory,
  updateCommissieWorkHistorySyncState,
  deleteCommissieWorkHistory,
  deleteAllMemberCommissieWorkHistory,
  // Member free fields (FreeScout ID, VOG datum)
  computeMemberFreeFieldsHash,
  upsertMemberFreeFields,
  getMemberFreeFieldsByKnvbId,
  getAllMemberFreeFields,
  clearMemberFreeFields,
  // Member invoice data (Sportlink financial tab)
  computeMemberInvoiceDataHash,
  upsertMemberInvoiceData,
  getMemberInvoiceDataByKnvbId,
  getAllMemberInvoiceData,
  clearMemberInvoiceData,
  // Conflict resolution (Phase 21)
  logConflictResolution,
  getConflictResolutions,
  getConflictResolutionCount,
  // Change detection (Phase 22)
  logChangeDetection,
  getChangeDetections,
  getLastDetectionTime,
  updateLastDetectionTime,
  // Reverse sync tracking (Phase 23)
  getUnsyncedContactChanges,
  markChangesSynced,
  updateSportlinkTimestamps,
  // Multi-page reverse sync (Phase 24)
  getUnsyncedChanges,
  // Volunteer status (Quick 016)
  updateVolunteerStatus,
  getVolunteerStatusMap
};
