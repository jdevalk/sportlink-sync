require('dotenv/config');

const { openDb, getMembersNeedingSyncWithPrevious } = require('../lib/laposta-db');
const { stableStringify, parseCliArgs } = require('../lib/utils');

/**
 * Parse CLI arguments.
 * @param {string[]} argv - Command line arguments
 * @returns {{listIndex: number|null, force: boolean}}
 */
function parseArgs(argv) {
  const { force } = parseCliArgs(argv);
  const listIndex = argv[2] ? Number.parseInt(argv[2], 10) : null;
  return { listIndex, force };
}

/**
 * Compute field-level diff between previous and current custom fields.
 * @param {Object} previous - Previous custom fields
 * @param {Object} current - Current custom fields
 * @returns {Object} Diff object with from/to for changed fields
 */
function computeFieldDiff(previous, current) {
  const diff = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  keys.forEach(key => {
    const before = previous[key];
    const after = current[key];
    if (stableStringify(before) !== stableStringify(after)) {
      diff[key] = { from: before ?? null, to: after ?? null };
    }
  });

  return diff;
}

/**
 * Show pending Laposta sync changes.
 */
async function main() {
  const { listIndex, force } = parseArgs(process.argv);

  const isValidListIndex = listIndex && listIndex >= 1 && listIndex <= 4;
  const listIndexes = isValidListIndex ? [listIndex] : [1, 2, 3, 4];

  const db = openDb();
  try {
    const output = [];

    listIndexes.forEach(index => {
      const members = getMembersNeedingSyncWithPrevious(db, index, force);
      if (members.length === 0) return;

      members.forEach(member => {
        const previous = member.last_synced_custom_fields || {};
        const current = member.custom_fields || {};
        const diff = computeFieldDiff(previous, current);

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

main().catch(err => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
