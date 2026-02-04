require('varlock/auto-load');

const { openDb, getMembersNeedingSyncWithPrevious } = require('./laposta-db');
const { stableStringify } = require('./lib/utils');

function parseArgs(argv) {
  const listIndex = argv[2] ? Number.parseInt(argv[2], 10) : null;
  const force = argv.includes('--force') || argv.includes('--all');
  return { listIndex, force };
}

async function main() {
  const { listIndex, force } = parseArgs(process.argv);
  const listIndexes = listIndex && listIndex >= 1 && listIndex <= 4
    ? [listIndex]
    : [1, 2, 3, 4];

  const db = openDb();
  try {
    const output = [];
    listIndexes.forEach((index) => {
      const members = getMembersNeedingSyncWithPrevious(db, index, force);
      if (members.length === 0) {
        return;
      }
      members.forEach((member) => {
        const previous = member.last_synced_custom_fields || {};
        const current = member.custom_fields || {};
        const diff = {};
        const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
        keys.forEach((key) => {
          const before = previous[key];
          const after = current[key];
          if (stableStringify(before) !== stableStringify(after)) {
            diff[key] = { from: before ?? null, to: after ?? null };
          }
        });
        output.push({
          list_index: index,
          email: member.email,
          custom_fields: current,
          diff
        });
      });
    });

    if (output.length === 0) {
      console.log('No members pending sync.');
      return;
    }
    console.log(JSON.stringify(output, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
