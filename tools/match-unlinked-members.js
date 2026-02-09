require('varlock/auto-load');

const { rondoClubRequest } = require('../lib/rondo-club-client');
const { openDb, updateSyncState } = require('../lib/rondo-club-db');

/**
 * Match unlinked members to Rondo Club posts.
 *
 * Phase 1: Match by KNVB ID (members in Rondo Club that already have a KNVB ID)
 * Phase 2: Match remaining by email (members whose email matches a Rondo Club person
 *          who is a parent — has child relationships)
 *
 * Dry run by default. Use --fix to apply changes.
 * Use --verbose for detailed output.
 */
async function run() {
  const verbose = process.argv.includes('--verbose');
  const fix = process.argv.includes('--fix');
  const log = verbose ? console.log : () => {};

  const db = openDb();

  try {
    // Get all unlinked members
    const unlinked = db.prepare(
      "SELECT knvb_id, email, stadion_id, last_synced_hash FROM stadion_members WHERE stadion_id IS NULL OR stadion_id = ''"
    ).all();
    console.log(`Unlinked members in sync DB: ${unlinked.length}`);

    if (unlinked.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // Build lookup maps
    const unlinkedByKnvb = new Map(unlinked.map(m => [m.knvb_id, m]));
    const unlinkedByEmail = new Map();
    for (const m of unlinked) {
      if (m.email) {
        unlinkedByEmail.set(m.email.toLowerCase(), m);
      }
    }

    // Phase 1: Fetch all Rondo Club people with KNVB IDs
    console.log('\n--- Phase 1: Match by KNVB ID ---');
    const knvbMatches = [];
    const emailCandidates = []; // People without KNVB ID for phase 2

    let page = 1;
    let totalPeople = 0;
    while (true) {
      let response;
      try {
        response = await rondoClubRequest(
          `wp/v2/people?_fields=id,title,acf.knvb-id,acf.contact_info,acf.relationships,acf.first_name,acf.last_name&per_page=100&page=${page}`,
          'GET', null, { verbose: false }
        );
      } catch (error) {
        if (error.message.includes('400')) break;
        throw error;
      }
      if (!Array.isArray(response.body) || response.body.length === 0) break;

      for (const person of response.body) {
        totalPeople++;
        const knvbId = person.acf?.['knvb-id'];

        if (knvbId && unlinkedByKnvb.has(knvbId)) {
          knvbMatches.push({
            knvb_id: knvbId,
            post_id: person.id,
            title: person.title?.rendered,
            member: unlinkedByKnvb.get(knvbId)
          });
          unlinkedByKnvb.delete(knvbId);
          if (unlinkedByEmail.has(unlinkedByKnvb.get(knvbId)?.email?.toLowerCase())) {
            unlinkedByEmail.delete(unlinkedByKnvb.get(knvbId)?.email?.toLowerCase());
          }
        } else if (!knvbId) {
          // Collect for phase 2
          const contacts = person.acf?.contact_info || [];
          const emails = contacts
            .filter(c => c.contact_type === 'email' && c.contact_value)
            .map(c => c.contact_value.toLowerCase());
          const relationships = person.acf?.relationships || [];
          const hasChildren = relationships.some(r => {
            const type = r.relationship_type;
            return type === 9 || (Array.isArray(type) && type.includes(9));
          });

          emailCandidates.push({
            id: person.id,
            title: person.title?.rendered,
            firstName: person.acf?.first_name,
            lastName: person.acf?.last_name,
            emails,
            hasChildren
          });
        }
      }

      log(`  Page ${page}: ${response.body.length} people`);
      page++;
      if (page > 50) break;
    }

    console.log(`Total Rondo Club people: ${totalPeople}`);
    console.log(`Phase 1 matches (by KNVB ID): ${knvbMatches.length}`);

    for (const match of knvbMatches) {
      log(`  ${match.knvb_id} -> post ${match.post_id} "${match.title}"`);
      if (fix) {
        updateSyncState(db, match.knvb_id, match.member.last_synced_hash, match.post_id);
        console.log(`  FIXED: ${match.knvb_id} -> ${match.post_id}`);
      }
    }

    // Remove phase 1 matches from unlinked sets
    for (const match of knvbMatches) {
      const email = match.member.email?.toLowerCase();
      if (email) unlinkedByEmail.delete(email);
    }

    // Phase 2: Match remaining by email against parent people
    console.log(`\n--- Phase 2: Match by email (parent people) ---`);
    console.log(`Remaining unlinked with email: ${unlinkedByEmail.size}`);
    console.log(`Rondo Club people without KNVB ID: ${emailCandidates.length}`);

    const parentCandidates = emailCandidates.filter(c => c.hasChildren);
    console.log(`  Of which are parents (have children): ${parentCandidates.length}`);

    const emailMatches = [];
    for (const candidate of parentCandidates) {
      for (const email of candidate.emails) {
        const member = unlinkedByEmail.get(email);
        if (member) {
          emailMatches.push({
            knvb_id: member.knvb_id,
            email,
            post_id: candidate.id,
            title: candidate.title,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            member
          });
          unlinkedByEmail.delete(email);
        }
      }
    }

    console.log(`Phase 2 matches (by email): ${emailMatches.length}`);

    for (const match of emailMatches) {
      console.log(`  ${match.knvb_id} (${match.email}) -> post ${match.post_id} "${match.title}"`);
      if (fix) {
        // Update sync DB
        updateSyncState(db, match.knvb_id, match.member.last_synced_hash, match.post_id);
        // Set KNVB ID on Rondo Club post
        try {
          await rondoClubRequest(`wp/v2/people/${match.post_id}`, 'PUT', {
            first_name: match.firstName,
            last_name: match.lastName,
            acf: {
              first_name: match.firstName,
              last_name: match.lastName,
              'knvb-id': match.knvb_id
            }
          }, { verbose: false });
          console.log(`  FIXED: ${match.knvb_id} -> ${match.post_id} + set KNVB ID`);
        } catch (err) {
          console.error(`  ERROR setting KNVB ID on post ${match.post_id}: ${err.message}`);
        }
      }
    }

    // Summary
    console.log('\n--- Summary ---');
    console.log(`Phase 1 (KNVB ID): ${knvbMatches.length} matches`);
    console.log(`Phase 2 (email/parent): ${emailMatches.length} matches`);
    console.log(`Still unlinked: ${unlinkedByEmail.size + (unlinked.length - knvbMatches.length - emailMatches.length - unlinkedByEmail.size)}`);

    if (unlinkedByEmail.size > 0) {
      console.log('\nRemaining unlinked members:');
      for (const [email, member] of unlinkedByEmail) {
        console.log(`  ${member.knvb_id} (${email})`);
      }
    }

    if (!fix) {
      console.log('\nDry run. Use --fix to apply changes.');
    }
  } finally {
    db.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  });
}
