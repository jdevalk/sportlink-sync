#!/usr/bin/env node
/**
 * Reset photo states for members that should have photos.
 *
 * This script is used to recover from situations where photo states were
 * incorrectly set (e.g., due to race conditions that marked photos as deleted).
 *
 * It checks both:
 * - sportlink_member_free_fields.photo_url (from MemberHeader API)
 * - stadion_members.person_image_date (from Sportlink download)
 *
 * Members with either value will have their photo_state reset to 'pending_download'.
 *
 * Usage:
 *   node scripts/reset-photo-states.js [--dry-run]
 */

require('varlock/auto-load');

const { openDb } = require('../lib/stadion-db');

const dryRun = process.argv.includes('--dry-run');

function main() {
  const db = openDb();

  try {
    // Count current states
    const currentStates = db.prepare(`
      SELECT photo_state, COUNT(*) as count
      FROM stadion_members
      GROUP BY photo_state
      ORDER BY photo_state
    `).all();

    console.log('Current photo states:');
    currentStates.forEach(row => {
      console.log(`  ${row.photo_state}: ${row.count}`);
    });
    console.log('');

    // Find members that should have photos but are marked as no_photo
    // Check both free fields table (photo_url) and members table (person_image_date)
    const membersToReset = db.prepare(`
      SELECT
        m.knvb_id,
        m.photo_state,
        m.person_image_date,
        f.photo_url,
        f.photo_date
      FROM stadion_members m
      LEFT JOIN sportlink_member_free_fields f ON m.knvb_id = f.knvb_id
      WHERE m.photo_state IN ('no_photo', 'pending_delete')
        AND (f.photo_url IS NOT NULL OR m.person_image_date IS NOT NULL)
    `).all();

    console.log(`Found ${membersToReset.length} members to reset`);

    if (membersToReset.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // Show sample
    console.log('');
    console.log('Sample (first 5):');
    membersToReset.slice(0, 5).forEach(m => {
      console.log(`  ${m.knvb_id}: state=${m.photo_state}, photo_url=${m.photo_url ? 'yes' : 'no'}, person_image_date=${m.person_image_date || 'none'}`);
    });
    console.log('');

    if (dryRun) {
      console.log('DRY RUN - no changes made');
      console.log(`Would reset ${membersToReset.length} members to 'pending_download'`);
      return;
    }

    // Reset photo states
    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE stadion_members
      SET
        photo_state = 'pending_download',
        photo_state_updated_at = ?
      WHERE knvb_id = ?
    `);

    const updateMany = db.transaction((members) => {
      members.forEach(m => updateStmt.run(now, m.knvb_id));
    });

    updateMany(membersToReset);

    console.log(`Reset ${membersToReset.length} members to 'pending_download'`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run photo download: node download-photos-from-api.js');
    console.log('  2. Run photo upload: node upload-photos-to-stadion.js');
    console.log('  (Or run the full people sync: scripts/sync.sh people)');

  } finally {
    db.close();
  }
}

main();
