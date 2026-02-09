require('varlock/auto-load');

const { openDb } = require('../lib/rondo-club-db');

const RONDO_URL = process.env.RONDO_URL;
const RONDO_USERNAME = process.env.RONDO_USERNAME;
const RONDO_APP_PASSWORD = process.env.RONDO_APP_PASSWORD;

async function rondoClubRequest(endpoint, method = 'GET', body = null) {
  const url = `${RONDO_URL}/wp-json/${endpoint}`;
  const auth = Buffer.from(`${RONDO_USERNAME}:${RONDO_APP_PASSWORD}`).toString('base64');

  const options = {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    let errorDetails = '';
    try {
      errorDetails = JSON.stringify(await response.json());
    } catch (e) {
      errorDetails = `status ${response.status}`;
    }
    throw new Error(`${method} ${endpoint} failed: ${response.status} - ${errorDetails}`);
  }
  return response.json();
}

/**
 * Un-merge parents that were incorrectly merged into their own children.
 *
 * When a parent shares an email with their child (common in youth clubs),
 * the parent sync mistakenly merged the parent into the child's post.
 * This script:
 * 1. Finds all parents whose stadion_id points to one of their own children
 * 2. Resets the parent's stadion_id to NULL so the next sync creates them fresh
 * 3. Removes any self-referential "parent" relationships on the child's post
 */
async function runUnmerge(options = {}) {
  const { dryRun = true, verbose = false } = options;

  console.log(dryRun ? '=== DRY RUN ===' : '=== UNMERGING PARENTS FROM CHILDREN ===');
  console.log('');

  const db = openDb();

  try {
    // Find all parents whose stadion_id matches one of their children
    const parents = db.prepare('SELECT email, stadion_id, data_json FROM stadion_parents WHERE stadion_id IS NOT NULL').all();

    const toFix = [];
    for (const p of parents) {
      const data = JSON.parse(p.data_json);
      const childKnvbIds = data.childKnvbIds || [];

      for (const childKnvb of childKnvbIds) {
        const child = db.prepare('SELECT stadion_id FROM stadion_members WHERE knvb_id = ?').get(childKnvb);
        if (child && child.stadion_id === p.stadion_id) {
          toFix.push({
            email: p.email,
            parentName: [data.data?.acf?.first_name, data.data?.acf?.last_name].filter(Boolean).join(' ') || p.email,
            childStadionId: p.stadion_id,
            childKnvbId: childKnvb
          });
          break; // One match is enough
        }
      }
    }

    console.log(`Found ${toFix.length} parents incorrectly merged into their own child`);
    console.log('');

    let reset = 0;
    let cleaned = 0;
    let errors = 0;

    for (const fix of toFix) {
      if (verbose) {
        console.log(`${fix.parentName} (${fix.email}) → merged into child post ${fix.childStadionId}`);
      }

      if (dryRun) {
        reset++;
        continue;
      }

      try {
        // Reset parent's stadion_id so next sync creates a fresh post
        db.prepare('UPDATE stadion_parents SET stadion_id = NULL, last_synced_hash = NULL WHERE email = ?').run(fix.email);
        reset++;

        // Clean up the child's post: remove self-referential parent relationships
        // (the child pointing to itself as its own parent)
        try {
          const childPost = await rondoClubRequest(`wp/v2/people/${fix.childStadionId}`);
          const relationships = childPost.acf?.relationships || [];

          // Remove relationships where the child points to itself
          const cleanedRels = relationships.filter(r => r.related_person !== fix.childStadionId);

          if (cleanedRels.length < relationships.length) {
            await rondoClubRequest(`wp/v2/people/${fix.childStadionId}`, 'PUT', {
              acf: {
                first_name: childPost.acf?.first_name || '',
                last_name: childPost.acf?.last_name || '',
                relationships: cleanedRels
              }
            });
            cleaned++;
            if (verbose) console.log(`  Cleaned ${relationships.length - cleanedRels.length} self-referential relationship(s) from post ${fix.childStadionId}`);
          }
        } catch (e) {
          if (verbose) console.log(`  Warning: could not clean child post ${fix.childStadionId}: ${e.message}`);
        }

        if (reset % 25 === 0) {
          console.log(`  Progress: ${reset}/${toFix.length}...`);
        }
      } catch (error) {
        errors++;
        console.error(`  ERROR for ${fix.email}: ${error.message}`);
      }
    }

    console.log('');
    console.log('=== RESULTS ===');
    console.log(`Parents merged into own child:  ${toFix.length}`);
    if (dryRun) {
      console.log(`Would reset:                   ${reset}`);
      console.log('');
      console.log('Run with --fix to reset parent tracking.');
      console.log('After running, do a people sync to create the parent posts:');
      console.log('  ssh root@46.202.155.16 "cd /home/rondo && scripts/sync.sh people"');
    } else {
      console.log(`Parent tracking reset:         ${reset}`);
      console.log(`Child self-refs cleaned:       ${cleaned}`);
      console.log(`Errors:                        ${errors}`);
    }
  } finally {
    db.close();
  }
}

// CLI entry point
if (require.main === module) {
  const dryRun = !process.argv.includes('--fix');
  const verbose = process.argv.includes('--verbose');

  runUnmerge({ dryRun, verbose })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { runUnmerge };
