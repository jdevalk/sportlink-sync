require('varlock/auto-load');

const { openDb, getMembersByEmail } = require('../lib/laposta-db');

/**
 * Parse CLI arguments.
 * @param {string[]} argv - Command line arguments
 * @returns {{email: string, listIndex: number|null}}
 */
function parseArgs(argv) {
  const email = argv[2];
  const listIndex = argv[3] ? Number.parseInt(argv[3], 10) : null;
  return { email, listIndex };
}

/**
 * Show Laposta member data by email.
 */
async function main() {
  const { email, listIndex } = parseArgs(process.argv);

  if (!email) {
    throw new Error('Usage: node show-laposta-member.js <email> [listIndex]');
  }

  const db = openDb();
  try {
    const members = getMembersByEmail(db, email, listIndex);

    if (members.length === 0) {
      console.log('No matching members found in laposta-sync.sqlite.');
      return;
    }

    const output = members.map(member => ({
      list_index: member.list_index,
      list_id: member.list_id,
      email: member.email,
      custom_fields: member.custom_fields
    }));

    console.log(JSON.stringify(output, null, 2));
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
