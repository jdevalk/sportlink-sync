/**
 * Conflict resolution infrastructure for bidirectional sync.
 * Detects field-level conflicts and resolves using last-write-wins (LWW) logic.
 */

const { TRACKED_FIELDS, getTimestampColumnNames, compareTimestamps } = require('./sync-origin');
const { logConflictResolution } = require('./rondo-club-db');

/**
 * Resolve field-level conflicts between Sportlink and Rondo Club data.
 * Uses last-write-wins (LWW) logic with 5-second grace period.
 *
 * @param {Object} member - Member row from rondo_club_members (includes timestamp columns)
 * @param {Object} sportlinkData - Current data from Sportlink
 * @param {Object} rondoClubData - Current data from Rondo Club
 * @param {Object} db - Database connection for audit logging
 * @param {Object} logger - Optional logger instance
 * @returns {Object} - { resolutions: Map<field, {value, winner, reason}>, conflicts: Array<ConflictRecord> }
 */
function resolveFieldConflicts(member, sportlinkData, rondoClubData, db, logger = null) {
  const resolutions = new Map();
  const conflicts = [];

  for (const field of TRACKED_FIELDS) {
    const cols = getTimestampColumnNames(field);
    const sportlinkTs = member[cols.sportlink];
    const rondoClubTs = member[cols.rondo_club];

    // Get current values
    const sportlinkValue = sportlinkData[field];
    const rondoClubValue = rondoClubData[field];

    // NULL timestamp handling per 21-CONTEXT.md
    // Case 1: Both NULL - use Sportlink value (forward sync default)
    if (!sportlinkTs && !rondoClubTs) {
      resolutions.set(field, {
        value: sportlinkValue,
        winner: 'sportlink',
        reason: 'both_null_sportlink_default'
      });
      continue;
    }

    // Case 2: Only Sportlink has timestamp
    if (sportlinkTs && !rondoClubTs) {
      resolutions.set(field, {
        value: sportlinkValue,
        winner: 'sportlink',
        reason: 'only_sportlink_has_history'
      });
      continue;
    }

    // Case 3: Only Rondo Club has timestamp
    if (!sportlinkTs && rondoClubTs) {
      resolutions.set(field, {
        value: rondoClubValue,
        winner: 'rondo_club',
        reason: 'only_rondo_club_has_history'
      });
      continue;
    }

    // Case 4: Both have timestamps - compare them
    const comparison = compareTimestamps(rondoClubTs, sportlinkTs, 5000);

    if (comparison === 0) {
      // Within grace period (5 seconds) - Sportlink wins per 21-CONTEXT.md
      resolutions.set(field, {
        value: sportlinkValue,
        winner: 'sportlink',
        reason: 'grace_period_sportlink_wins'
      });
      continue;
    }

    // Check if values actually differ
    if (sportlinkValue === rondoClubValue) {
      // Timestamps differ but values match - no conflict
      resolutions.set(field, {
        value: sportlinkValue,
        winner: 'both',
        reason: 'values_match_no_conflict'
      });
      continue;
    }

    // Real conflict: both have timestamps, values differ, timestamps differ by >5s
    const winner = comparison > 0 ? 'rondo_club' : 'sportlink';
    const winningValue = winner === 'rondo_club' ? rondoClubValue : sportlinkValue;
    const reason = comparison > 0 ? 'rondo_club_newer' : 'sportlink_newer';

    // Log to audit table
    const conflictRecord = {
      knvb_id: member.knvb_id,
      field_name: field,
      sportlink_value: String(sportlinkValue || ''),
      rondo_club_value: String(rondoClubValue || ''),
      sportlink_modified: sportlinkTs,
      rondo_club_modified: rondoClubTs,
      winning_system: winner,
      resolution_reason: reason
    };

    logConflictResolution(db, conflictRecord);
    conflicts.push(conflictRecord);

    resolutions.set(field, {
      value: winningValue,
      winner: winner,
      reason: reason
    });

    if (logger) {
      logger.verbose(`Conflict resolved for ${member.knvb_id}.${field}: ${winner} won (${reason})`);
    }
  }

  return { resolutions, conflicts };
}

/**
 * Generate a plain text summary of conflict resolutions.
 * Format is compatible with existing email system (formatAsHtml in send-email.js).
 *
 * @param {Array<Object>} conflicts - Array of conflict records
 * @returns {string|null} - Plain text summary or null if no conflicts
 */
function generateConflictSummary(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return null;
  }

  const lines = [];
  lines.push('CONFLICTS DETECTED AND RESOLVED');
  lines.push('');

  // Group by knvb_id
  const byMember = {};
  for (const conflict of conflicts) {
    const knvbId = conflict.knvb_id;
    if (!byMember[knvbId]) {
      byMember[knvbId] = [];
    }
    byMember[knvbId].push(conflict);
  }

  const memberCount = Object.keys(byMember).length;
  lines.push(`Total conflicts: ${conflicts.length}`);
  lines.push(`Members affected: ${memberCount}`);
  lines.push('');
  lines.push('RESOLUTION DETAILS');
  lines.push('');

  // List each member's conflicts
  for (const [knvbId, memberConflicts] of Object.entries(byMember)) {
    const fieldList = memberConflicts.map(c => {
      const winner = c.winning_system;
      const reason = c.resolution_reason.replace(/_/g, ' ');
      return `  ${c.field_name}: ${winner} won (${reason})`;
    }).join('\n');

    lines.push(`- ${knvbId}: ${memberConflicts.length} field(s)`);
    lines.push(fieldList);
  }

  return lines.join('\n');
}

module.exports = {
  resolveFieldConflicts,
  generateConflictSummary
};

// CLI self-test
if (require.main === module) {
  console.log('Running conflict-resolver self-test...\n');

  const { openDb } = require('./rondo-club-db');
  const db = openDb(':memory:');

  // Test 1: NULL handling
  console.log('Test 1: NULL timestamp handling');
  const member1 = {
    knvb_id: 'TEST001',
    email_sportlink_modified: null,
    email_rondo_club_modified: null,
    email2_sportlink_modified: null,
    email2_rondo_club_modified: '2026-01-29T10:00:00.000Z',
    mobile_sportlink_modified: '2026-01-29T10:00:00.000Z',
    mobile_rondo_club_modified: null,
    phone_sportlink_modified: null,
    phone_rondo_club_modified: null,
    datum_vog_sportlink_modified: null,
    datum_vog_rondo_club_modified: null,
    freescout_id_sportlink_modified: null,
    freescout_id_rondo_club_modified: null,
    financiele_blokkade_sportlink_modified: null,
    financiele_blokkade_rondo_club_modified: null
  };
  const sportlink1 = { email: 'sportlink@example.com', email2: 'sportlink2@example.com', mobile: '0612345678' };
  const rondoClub1 = { email: 'rondoclub@example.com', email2: 'rondoclub2@example.com', mobile: '0687654321' };

  const result1 = resolveFieldConflicts(member1, sportlink1, rondoClub1, db);
  console.log('  email (both NULL):', result1.resolutions.get('email').winner, '=', result1.resolutions.get('email').value);
  console.log('  email2 (only Rondo Club has timestamp):', result1.resolutions.get('email2').winner, '=', result1.resolutions.get('email2').value);
  console.log('  mobile (only Sportlink has timestamp):', result1.resolutions.get('mobile').winner, '=', result1.resolutions.get('mobile').value);
  console.log('  Conflicts detected:', result1.conflicts.length);
  console.log('  ✓ NULL handling test passed\n');

  // Test 2: Grace period
  console.log('Test 2: Grace period handling');
  const member2 = {
    knvb_id: 'TEST002',
    email_sportlink_modified: '2026-01-29T10:00:00.000Z',
    email_rondo_club_modified: '2026-01-29T10:00:03.000Z', // 3 seconds apart (within tolerance)
    email2_sportlink_modified: null,
    email2_rondo_club_modified: null,
    mobile_sportlink_modified: null,
    mobile_rondo_club_modified: null,
    phone_sportlink_modified: null,
    phone_rondo_club_modified: null,
    datum_vog_sportlink_modified: null,
    datum_vog_rondo_club_modified: null,
    freescout_id_sportlink_modified: null,
    freescout_id_rondo_club_modified: null,
    financiele_blokkade_sportlink_modified: null,
    financiele_blokkade_rondo_club_modified: null
  };
  const sportlink2 = { email: 'sportlink@example.com' };
  const rondoClub2 = { email: 'rondoclub@example.com' };

  const result2 = resolveFieldConflicts(member2, sportlink2, rondoClub2, db);
  console.log('  email (within grace period):', result2.resolutions.get('email').winner, '=', result2.resolutions.get('email').value);
  console.log('  Reason:', result2.resolutions.get('email').reason);
  console.log('  Conflicts detected:', result2.conflicts.length);
  console.log('  ✓ Grace period test passed\n');

  // Test 3: Real conflict
  console.log('Test 3: Real conflict detection');
  const member3 = {
    knvb_id: 'TEST003',
    email_sportlink_modified: '2026-01-29T10:00:00.000Z',
    email_rondo_club_modified: '2026-01-29T10:10:00.000Z', // 10 minutes apart
    email2_sportlink_modified: null,
    email2_rondo_club_modified: null,
    mobile_sportlink_modified: null,
    mobile_rondo_club_modified: null,
    phone_sportlink_modified: null,
    phone_rondo_club_modified: null,
    datum_vog_sportlink_modified: null,
    datum_vog_rondo_club_modified: null,
    freescout_id_sportlink_modified: null,
    freescout_id_rondo_club_modified: null,
    financiele_blokkade_sportlink_modified: null,
    financiele_blokkade_rondo_club_modified: null
  };
  const sportlink3 = { email: 'sportlink@example.com' };
  const rondoClub3 = { email: 'rondoclub@example.com' };

  const result3 = resolveFieldConflicts(member3, sportlink3, rondoClub3, db);
  console.log('  email (Rondo Club 10min newer):', result3.resolutions.get('email').winner, '=', result3.resolutions.get('email').value);
  console.log('  Reason:', result3.resolutions.get('email').reason);
  console.log('  Conflicts detected:', result3.conflicts.length);
  console.log('  ✓ Conflict detection test passed\n');

  // Test 4: Summary generation
  console.log('Test 4: Summary generation');
  const summary = generateConflictSummary(result3.conflicts);
  console.log(summary);
  console.log('  ✓ Summary generation test passed\n');

  console.log('All self-tests passed! ✓');
}
