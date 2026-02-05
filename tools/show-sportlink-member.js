require('varlock/auto-load');

const { openDb, getLatestSportlinkResults } = require('../lib/laposta-db');

const EMAIL_FIELDS = [
  'Email',
  'EmailAlternative',
  'EmailAddressParent1',
  'EmailAddressParent2'
];

function normalizeEmail(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function parseArgs(argv) {
  const email = argv[2];
  return { email };
}

async function main() {
  const { email } = parseArgs(process.argv);
  if (!email) {
    throw new Error('Usage: node show-sportlink-member.js <email>');
  }

  const db = openDb();
  try {
    const raw = getLatestSportlinkResults(db);
    if (!raw) {
      console.log('No Sportlink results found in laposta-sync.sqlite.');
      return;
    }
    const data = JSON.parse(raw);
    const members = Array.isArray(data.Members) ? data.Members : [];
    const needle = normalizeEmail(email);

    const matches = members
      .map((member) => {
        const matchedFields = EMAIL_FIELDS.filter((field) => {
          return normalizeEmail(member[field]) === needle;
        });
        if (matchedFields.length === 0) return null;
        return { matched_fields: matchedFields, member };
      })
      .filter(Boolean);

    if (matches.length === 0) {
      console.log('No matching members found in latest Sportlink results.');
      return;
    }

    console.log(JSON.stringify(matches, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
