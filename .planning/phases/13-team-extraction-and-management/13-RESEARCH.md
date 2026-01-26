# Phase 13: Team Extraction and Management - Research

**Researched:** 2026-01-26
**Domain:** WordPress REST API, SQLite data tracking, team extraction from CSV
**Confidence:** HIGH

## Summary

Phase 13 implements team extraction from Sportlink CSV data and creates corresponding team entities in Stadion WordPress via REST API. The system must extract team names from `UnionTeams` (priority) or `ClubTeams` (fallback) fields, create teams in Stadion if they don't exist, and maintain a SQLite mapping table to track team name → Stadion team ID relationships.

This phase builds on existing infrastructure: the codebase already uses better-sqlite3 for state tracking (stadion-sync.sqlite) with hash-based change detection, and has established patterns for WordPress REST API communication via stadion-client.js. The team extraction requires parsing Sportlink fields, deduplicating team names across members, and implementing idempotent create-or-retrieve operations.

**Primary recommendation:** Use the existing stadion-db.js pattern (hash-based tracking with stadion_id storage) to create a `stadion_teams` table, implement team extraction during prepare-stadion-members.js phase, and sync teams before member sync to ensure team IDs exist for Phase 14's work_history linkage.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 11.x | SQLite state tracking | Already used for member/parent tracking, synchronous API, transaction support |
| Node.js https | Built-in | WordPress REST API calls | Already used in stadion-client.js, no external HTTP deps |
| crypto (SHA-256) | Built-in | Hash-based change detection | Existing pattern in stadion-db.js for sync state |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| varlock/auto-load | N/A | Environment variable loading | Already used project-wide for .env access |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | node-sqlite3 (async) | Async API incompatible with existing transaction patterns |
| Built-in https | axios/node-fetch | External dependency; existing stadion-client.js uses https |
| SHA-256 hash | JSON comparison | Hash comparison is O(1), JSON deep-equal is O(n) |

**Installation:**
```bash
# No new dependencies required - all libraries already installed
# Current package.json includes better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── stadion-db.js          # Add stadion_teams table schema and functions
├── stadion-client.js      # Existing - no changes needed
└── logger.js              # Existing - reuse for team sync logging

prepare-stadion-teams.js   # NEW - Team extraction and preparation
submit-stadion-sync.js     # MODIFY - Add team sync before member sync
```

### Pattern 1: Team Extraction from Sportlink Fields
**What:** Extract team name from UnionTeams field, fallback to ClubTeams if empty
**When to use:** During preparation phase, before member sync
**Example:**
```javascript
// Source: Existing pattern from field-mapping.json
function extractTeamName(member) {
  const unionTeam = (member.UnionTeams || '').trim();
  if (unionTeam) return unionTeam;

  const clubTeam = (member.ClubTeams || '').trim();
  return clubTeam || null;
}

// Collect unique teams from all members
const uniqueTeams = new Set();
members.forEach(member => {
  const teamName = extractTeamName(member);
  if (teamName) uniqueTeams.add(teamName);
});
```

### Pattern 2: SQLite Tracking Table with Hash-based Sync
**What:** Track team name → Stadion ID mapping with change detection
**When to use:** Following existing stadion_members/stadion_parents pattern
**Example:**
```javascript
// Source: Existing pattern from lib/stadion-db.js
db.exec(`
  CREATE TABLE IF NOT EXISTS stadion_teams (
    id INTEGER PRIMARY KEY,
    team_name TEXT NOT NULL UNIQUE,
    stadion_id INTEGER,
    source_hash TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_synced_at TEXT,
    last_synced_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stadion_teams_hash
    ON stadion_teams (source_hash, last_synced_hash);
`);

// Upsert teams with hash computation
function upsertTeams(db, teams) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO stadion_teams (
      team_name, source_hash, last_seen_at, created_at
    ) VALUES (
      @team_name, @source_hash, @last_seen_at, @created_at
    )
    ON CONFLICT(team_name) DO UPDATE SET
      source_hash = excluded.source_hash,
      last_seen_at = excluded.last_seen_at
  `);

  const insertMany = db.transaction((rows) => {
    rows.forEach((row) => stmt.run(row));
  });

  const rows = teams.map((teamName) => ({
    team_name: teamName,
    source_hash: computeTeamHash(teamName),
    last_seen_at: now,
    created_at: now
  }));

  insertMany(rows);
}
```

### Pattern 3: WordPress REST API Team Creation
**What:** Create team in Stadion via POST /wp/v2/teams if it doesn't exist
**When to use:** When team has no stadion_id in database
**Example:**
```javascript
// Source: Existing pattern from submit-stadion-sync.js
async function syncTeam(team, db, options) {
  const { team_name, source_hash, stadion_id } = team;
  const logVerbose = options.logger?.verbose.bind(options.logger) || (() => {});

  if (stadion_id) {
    // Team already exists, check if update needed
    if (team.source_hash === team.last_synced_hash) {
      logVerbose(`Team "${team_name}" unchanged, skipping`);
      return { action: 'skipped', id: stadion_id };
    }

    // UPDATE existing team (if data changed - unlikely for simple name)
    logVerbose(`Updating team: ${stadion_id}`);
    const response = await stadionRequest(
      `wp/v2/teams/${stadion_id}`,
      'PUT',
      { title: team_name, status: 'publish' },
      options
    );
    updateTeamSyncState(db, team_name, source_hash, stadion_id);
    return { action: 'updated', id: stadion_id };
  } else {
    // CREATE new team
    logVerbose(`Creating team: ${team_name}`);
    const response = await stadionRequest(
      'wp/v2/teams',
      'POST',
      { title: team_name, status: 'publish' },
      options
    );
    const newId = response.body.id;
    updateTeamSyncState(db, team_name, source_hash, newId);
    return { action: 'created', id: newId };
  }
}
```

### Pattern 4: Idempotent Team Retrieval
**What:** Handle case where team exists in WordPress but not in our database
**When to use:** Error recovery scenario (database reset but WordPress intact)
**Example:**
```javascript
// Source: WordPress REST API best practice - search before create
async function findOrCreateTeam(teamName, db, options) {
  try {
    // Try to create team
    const response = await stadionRequest(
      'wp/v2/teams',
      'POST',
      { title: teamName, status: 'publish' },
      options
    );
    return response.body.id;
  } catch (error) {
    // If duplicate error, search for existing team
    if (error.details?.code === 'term_exists' || error.status === 400) {
      // Search by title using GET /wp/v2/teams?search=teamName
      const searchResponse = await stadionRequest(
        `wp/v2/teams?search=${encodeURIComponent(teamName)}`,
        'GET',
        null,
        options
      );
      const match = searchResponse.body.find(t => t.title.rendered === teamName);
      if (match) return match.id;
    }
    throw error; // Re-throw if not a duplicate error
  }
}
```

### Anti-Patterns to Avoid
- **Syncing teams during member sync loop:** Create all teams first, then sync members. Avoids duplicate API calls.
- **Not deduplicating team names:** Multiple members have same team. Extract unique set before processing.
- **Case-sensitive team matching:** "Jongens 11-1" vs "jongens 11-1". Normalize to lowercase for comparison, preserve original case for display.
- **Ignoring empty teams:** Some members may have no team. Filter nulls before creating Set.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Change detection | Manual JSON comparison | Hash-based with SHA-256 | O(1) comparison, already used in codebase for members/parents |
| Transaction handling | Manual BEGIN/COMMIT | db.transaction() | Automatic rollback on error, better-sqlite3 optimized |
| Duplicate team creation | Check-then-create race condition | POST with error handling | WordPress may create duplicates, idempotent retry safer |
| String normalization | Custom trim/lowercase | String.prototype methods | Edge cases (Unicode, whitespace) already handled |

**Key insight:** The existing codebase has mature patterns for entity sync (members, parents, important dates). Teams are simpler (no relationships, no ACF fields) so the same hash-tracking pattern applies with less complexity.

## Common Pitfalls

### Pitfall 1: Multiple Team Fields Without Priority Logic
**What goes wrong:** Both UnionTeams and ClubTeams may have values; choosing wrong one leads to incorrect team assignment
**Why it happens:** Field mapping shows "team": "UnionTeams" but ClubTeams exists as alternative
**How to avoid:** Explicit priority: UnionTeams first, ClubTeams fallback only if UnionTeams is empty/null
**Warning signs:** Different team values in UnionTeams vs ClubTeams for same member; production data shows both populated

### Pitfall 2: WordPress Custom Post Type Not Configured for REST API
**What goes wrong:** POST /wp/v2/teams returns 404 or "rest_no_route" error
**Why it happens:** Custom post type "team" must have `'show_in_rest' => true` in register_post_type()
**How to avoid:** Verify REST endpoint exists before sync: GET /wp/v2/teams should return array, not 404
**Warning signs:** curl test against Stadion returns 404 for /wp-json/wp/v2/teams

### Pitfall 3: Null/Empty Team Values in Database
**What goes wrong:** Database gets entries with team_name = "" or NULL, causing UNIQUE constraint violations
**Why it happens:** Not filtering empty strings before extracting unique teams
**How to avoid:** Filter falsy values: `if (teamName) uniqueTeams.add(teamName)`
**Warning signs:** SQLite constraint errors: "UNIQUE constraint failed: stadion_teams.team_name"

### Pitfall 4: Title Field Format Mismatch
**What goes wrong:** WordPress REST API expects `{title: "value"}` but code sends `{title: {rendered: "value"}}`
**Why it happens:** Confusion between GET response format (title.rendered) and POST request format (title)
**How to avoid:** Use simple string for POST: `{ title: teamName }`, not object
**Warning signs:** WordPress returns 400 Bad Request with "invalid parameter" error

### Pitfall 5: Case Sensitivity in Team Name Matching
**What goes wrong:** "Jongens 11-1" and "jongens 11-1" treated as different teams
**Why it happens:** UNIQUE constraint in SQLite is case-sensitive by default
**How to avoid:** Either normalize to lowercase for storage, or use COLLATE NOCASE in schema
**Warning signs:** Duplicate teams in WordPress with different casing

## Code Examples

Verified patterns from existing codebase:

### Complete Team Extraction Function
```javascript
// Source: Adapted from prepare-stadion-members.js pattern
function extractUniqueTeams(sportlinkMembers) {
  const teamNames = new Set();

  sportlinkMembers.forEach(member => {
    // Priority: UnionTeams first, ClubTeams fallback
    const unionTeam = (member.UnionTeams || '').trim();
    if (unionTeam) {
      teamNames.add(unionTeam);
      return;
    }

    const clubTeam = (member.ClubTeams || '').trim();
    if (clubTeam) {
      teamNames.add(clubTeam);
    }
  });

  return Array.from(teamNames).sort(); // Sort for consistent processing
}
```

### Database Schema Addition
```javascript
// Source: lib/stadion-db.js existing pattern
function initDb(db) {
  // ... existing tables ...

  db.exec(`
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
  `);
}
```

### Team Sync Integration into Main Flow
```javascript
// Source: submit-stadion-sync.js existing runSync pattern
async function runSync(options = {}) {
  const db = openDb();
  try {
    // Step 1: Sync teams BEFORE members (members reference teams in Phase 14)
    const teamResult = await syncTeams(db, options);

    // Step 2: Sync members (existing code)
    if (options.includeMembers) {
      const memberResult = await syncMembers(db, options);
      // ...
    }

    return { teams: teamResult, members: memberResult };
  } finally {
    db.close();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual duplicate checks | UNIQUE constraint + UPSERT | SQLite 3.24+ (2018) | Automatic deduplication at database level |
| Check-then-create pattern | Idempotent POST with error handling | REST API best practice 2020+ | Safer in concurrent scenarios |
| Separate hash columns | Unified source_hash/last_synced_hash | This codebase pattern (2024) | Consistent change detection across entities |

**Deprecated/outdated:**
- WordPress REST API filtering (removed in WP 4.7+): Cannot use ?filter[title]=exact anymore, must use ?search= parameter
- SQLite INSERT OR REPLACE: Superseded by INSERT ... ON CONFLICT for finer control

## Open Questions

Things that couldn't be fully resolved:

1. **WordPress "team" custom post type REST base**
   - What we know: Default would be /wp/v2/team (singular) if post type slug is "team"
   - What's unclear: Stadion may use /wp/v2/teams (plural) via rest_base override
   - Recommendation: Test actual endpoint during Phase 13 planning; create validation task

2. **Team name character limits**
   - What we know: WordPress post titles typically support 200+ characters
   - What's unclear: Sportlink UnionTeams/ClubTeams field length constraints
   - Recommendation: Check actual Sportlink data for max team name length; add TEXT field validation

3. **Empty team handling in work_history (Phase 14)**
   - What we know: Some members have no team assignment
   - What's unclear: Should work_history entry be created with null team reference?
   - Recommendation: Phase 14 planning should define behavior for teamless members

## Sources

### Primary (HIGH confidence)
- [WordPress REST API - Adding REST API Support For Custom Content Types](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-rest-api-support-for-custom-content-types/) - REST API registration requirements
- [WordPress REST API - Posts Reference](https://developer.wordpress.org/rest-api/reference/posts/) - POST request field requirements
- [better-sqlite3 npm documentation](https://www.npmjs.com/package/better-sqlite3) - Transaction and prepared statement patterns
- [better-sqlite3 API documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) - Official API reference
- [SQLite UPSERT documentation](https://sqlite.org/lang_upsert.html) - ON CONFLICT behavior

### Secondary (MEDIUM confidence)
- [SQLite UNIQUE Constraint Best Practices](https://www.slingacademy.com/article/best-practices-for-using-unique-constraints-in-sqlite/) - COLLATE NOCASE, composite constraints
- [WordPress Custom Post Types - Scott Bolinger](https://scottbolinger.com/custom-post-types-wp-api-v2/) - REST API integration patterns
- [Understanding Better-SQLite3](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8) - Transaction performance patterns

### Tertiary (LOW confidence)
- WebSearch results on hash-based change detection patterns (general sync architecture, not library-specific)
- WebSearch results on WordPress REST API rate limiting (may not apply to self-hosted Stadion)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Existing patterns from members/parents sync directly applicable
- Pitfalls: MEDIUM - Team sync is simpler than member sync, but WordPress custom post type configuration is external dependency

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - stable domain with mature libraries)
