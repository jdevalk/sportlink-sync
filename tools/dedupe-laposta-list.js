require('varlock/auto-load');

const {
  fetchMembers,
  deleteMember,
  waitForRateLimit,
  getListConfig
} = require('../lib/laposta-client');
const { normalizeEmail } = require('../lib/parent-dedupe');

const RATE_LIMIT_DELAY_DELETE = 1500; // Slightly shorter for delete operations

/**
 * Get last name from member object, checking various possible field locations.
 * @param {Object} member - Member object from Laposta
 * @returns {string} Last name or empty string
 */
function getLastName(member) {
  if (!member) return '';

  // Check standard fields
  if (member.last_name) return String(member.last_name).trim();
  if (member.lastname) return String(member.lastname).trim();
  if (member.LastName) return String(member.LastName).trim();

  // Check custom fields
  const custom = member.custom_fields || member.customFields || {};
  if (custom.achternaam) return String(custom.achternaam).trim();
  if (custom.last_name) return String(custom.last_name).trim();
  if (custom.lastname) return String(custom.lastname).trim();

  return '';
}

/**
 * Check if member is a parent (has no last name).
 * @param {Object} member - Member object
 * @returns {boolean}
 */
function isParentMember(member) {
  return getLastName(member) === '';
}

/**
 * Parse CLI arguments.
 * @param {string[]} argv - Command line arguments
 * @returns {{listIndex: number, apply: boolean, state: string}}
 */
function parseArgs(argv) {
  const listIndex = Number.parseInt(argv[2] || '0', 10);
  const apply = argv.includes('--apply') || argv.includes('--delete');
  const stateArg = argv.find(arg => arg.startsWith('--state='));
  const state = stateArg ? stateArg.split('=')[1] : 'active';
  return { listIndex, apply, state };
}

/**
 * Fetch members from a list with configuration validation.
 * @param {number} listIndex - List index (1-4)
 * @param {string} state - Member state filter
 * @returns {Promise<{listIndex: number, listId: string, members: Array}|null>}
 */
async function fetchListMembers(listIndex, state) {
  const { envKey, listId } = getListConfig(listIndex);

  if (!listId) {
    console.log(`Skipping list ${listIndex}: ${envKey} not found in .env.`);
    return null;
  }

  const members = await fetchMembers(listId, state);
  return { listIndex, listId, members };
}

/**
 * Build email-to-members mapping across all lists.
 * @param {Array} listResults - Array of {listIndex, listId, members}
 * @returns {Map<string, Array>} Map of normalized email to member entries
 */
function buildEmailMap(listResults) {
  const byEmail = new Map();

  listResults.forEach(({ listIndex, listId, members }) => {
    if (!members || members.length === 0) {
      console.log(`List ${listIndex}: no members returned from Laposta.`);
      return;
    }

    members.forEach(member => {
      const normalized = normalizeEmail(member.email || member.EmailAddress || '');
      if (!normalized) return;

      if (!byEmail.has(normalized)) {
        byEmail.set(normalized, []);
      }
      byEmail.get(normalized).push({ listIndex, listId, member });
    });
  });

  return byEmail;
}

/**
 * Find duplicate parent entries across lists.
 * Keeps the entry in the lowest-numbered list.
 * @param {Map<string, Array>} emailMap - Email to member entries mapping
 * @returns {Array<{email: string, keep: Object, remove: Array}>}
 */
function findDuplicateParents(emailMap) {
  const duplicates = [];

  emailMap.forEach((items, email) => {
    if (items.length <= 1) return;

    // Only consider parent members
    const parentItems = items.filter(item => isParentMember(item.member));
    if (parentItems.length <= 1) return;

    // Sort by list index, keep the lowest
    const sorted = [...parentItems].sort((a, b) => a.listIndex - b.listIndex);
    const keep = sorted[0];
    const remove = sorted.slice(1);

    if (remove.length > 0) {
      duplicates.push({ email, keep, remove });
    }
  });

  return duplicates;
}

/**
 * Get member identifier for display.
 * @param {Object} item - {listIndex, member} object
 * @returns {string}
 */
function getMemberDisplayId(item) {
  const id = item.member.member_id || item.member.email || item.member.EmailAddress;
  return `${item.listIndex}:${id}`;
}

/**
 * Print dry run summary of duplicates to remove.
 * @param {Array} duplicates - Duplicate entries
 */
function printDryRunSummary(duplicates) {
  console.log('Dry run only. Re-run with --apply to delete.');

  const maxDisplay = 10;
  duplicates.slice(0, maxDisplay).forEach(entry => {
    const ids = entry.remove.map(getMemberDisplayId).join(', ');
    console.log(`Duplicate ${entry.email}: remove ${ids}`);
  });

  if (duplicates.length > maxDisplay) {
    console.log(`(Showing first ${maxDisplay} duplicates of ${duplicates.length}.)`);
  }
}

/**
 * Delete duplicate members.
 * @param {Array} duplicates - Duplicate entries to process
 */
async function deleteDuplicates(duplicates) {
  for (const entry of duplicates) {
    for (const item of entry.remove) {
      await deleteMember(item.listId, item.member);
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_DELETE));

      const id = item.member.member_id || item.member.email || item.member.EmailAddress;
      console.log(`Deleted duplicate ${entry.email} from list ${item.listIndex} (${id})`);
    }
  }
}

async function main() {
  const { listIndex, apply, state } = parseArgs(process.argv);

  // Determine which lists to check
  const isValidListIndex = listIndex >= 1 && listIndex <= 4;
  const listIndexes = isValidListIndex ? [listIndex] : [1, 2, 3, 4];

  // Fetch members from all lists
  const listResults = [];
  for (const index of listIndexes) {
    const result = await fetchListMembers(index, state);
    if (result) {
      listResults.push(result);
    }
  }

  if (listResults.length === 0) {
    console.log('No lists available to check.');
    return;
  }

  // Build email mapping and find duplicates
  const emailMap = buildEmailMap(listResults);
  const duplicates = findDuplicateParents(emailMap);

  if (duplicates.length === 0) {
    console.log('No duplicate parent emails found across lists.');
    return;
  }

  const totalRemovals = duplicates.reduce((sum, entry) => sum + entry.remove.length, 0);
  console.log(`Found ${duplicates.length} duplicate parent emails across lists (${totalRemovals} entries to remove).`);

  if (!apply) {
    printDryRunSummary(duplicates);
    return;
  }

  await deleteDuplicates(duplicates);
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.details) {
    console.error('Details:', JSON.stringify(err.details, null, 2));
  }
  process.exitCode = 1;
});
