require('varlock/auto-load');

const { openDb, getLatestSportlinkResults } = require('./laposta-db');
const { normalizeEmail, isValidEmail, buildChildFullName, hasValue } = require('./lib/parent-dedupe');

/**
 * Build parent name with fallback to "Ouder/verzorger van {child}"
 * @param {Object} member - Sportlink member record
 * @param {number} parentIndex - 1 or 2
 * @returns {{first_name: string, last_name: string}}
 */
function buildParentName(member, parentIndex) {
  const nameField = parentIndex === 1 ? 'NameParent1' : 'NameParent2';
  const parentName = member[nameField];

  if (hasValue(parentName)) {
    return { first_name: String(parentName).trim(), last_name: '' };
  }

  // Fallback: "Ouder/verzorger van {child first name}"
  const childFirstName = hasValue(member.FirstName) ? String(member.FirstName).trim() : '';
  const childInfix = hasValue(member.Infix) ? String(member.Infix).trim() : '';
  const childLastName = hasValue(member.LastName) ? String(member.LastName).trim() : '';
  const fullChildLastName = [childInfix, childLastName].filter(Boolean).join(' ');

  return {
    first_name: `Ouder/verzorger van ${childFirstName}`.trim(),
    last_name: fullChildLastName
  };
}

/**
 * Build address from child's Sportlink record
 * @param {Object} member - Sportlink member record
 * @returns {Object|null} - Address object or null if no address
 */
function buildParentAddress(member) {
  const street = (member.StreetName || '').trim();
  const city = (member.City || '').trim();
  if (!street && !city) return null;
  return {
    street: street,
    number: (member.AddressNumber || '').toString().trim(),
    addition: (member.AddressNumberAppendix || '').trim(),
    postal_code: (member.ZipCode || '').trim(),
    city: city
  };
}

/**
 * Build contact info array for parent
 * @param {string} email - Parent email
 * @param {Set} phones - Set of phone numbers
 * @returns {Array<{type: string, value: string}>}
 */
function buildParentContactInfo(email, phones) {
  const contacts = [];
  if (email) contacts.push({ type: 'email', value: email });
  phones.forEach(phone => {
    if (phone) contacts.push({ type: 'phone', value: phone });
  });
  return contacts;
}

/**
 * Transform parent data to Stadion person format
 * @param {string} email - Parent email
 * @param {Object} data - Parent data (name, phones, address, childKnvbIds)
 * @returns {{email: string, childKnvbIds: Array, data: Object}}
 */
function prepareParent(email, data) {
  const title = [data.name.first_name, data.name.last_name].filter(Boolean).join(' ');

  return {
    email: email,
    childKnvbIds: data.childKnvbIds,  // For relationship linking in sync phase
    data: {
      title: title || 'Parent',
      status: 'publish',
      meta: {
        knvb_id: '',  // Empty - parents are not members
        first_name: data.name.first_name,
        last_name: data.name.last_name,
        gender: '',   // Not available for parents
        is_parent: true  // Custom field to identify parents
      },
      acf: {
        contact_info: buildParentContactInfo(email, data.phones),
        addresses: data.address ? [data.address] : []
      }
    }
  };
}

/**
 * Prepare Stadion parents from Sportlink data
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, parents: Array, skipped: number, error?: string}>}
 */
async function runPrepare(options = {}) {
  const { logger, verbose = false } = options;

  // Use provided logger or create simple fallback
  const log = logger ? logger.log.bind(logger) : console.log;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});
  const logError = logger ? logger.error.bind(logger) : console.error;

  try {
    // Load Sportlink data from SQLite
    const db = openDb();
    let sportlinkData;
    try {
      const resultsJson = getLatestSportlinkResults(db);
      if (!resultsJson) {
        const errorMsg = 'No Sportlink results found in SQLite. Run the download first.';
        logError(errorMsg);
        return { success: false, parents: [], skipped: 0, error: errorMsg };
      }
      sportlinkData = JSON.parse(resultsJson);
    } finally {
      db.close();
    }

    const members = Array.isArray(sportlinkData.Members) ? sportlinkData.Members : [];
    logVerbose(`Found ${members.length} Sportlink members in database`);

    // Map to collect parent data: email -> { name, phones: Set, address, childKnvbIds: [] }
    const parentDataMap = new Map();

    members.forEach((member) => {
      [1, 2].forEach((parentIndex) => {
        const emailField = `EmailAddressParent${parentIndex}`;
        const phoneField = `TelephoneParent${parentIndex}`;
        const emailValue = member[emailField];

        // Skip if no email (can't dedupe without email)
        if (!isValidEmail(emailValue)) return;

        const normalized = normalizeEmail(emailValue);
        const phone = member[phoneField];

        // Skip if no email AND no phone
        if (!normalized && !hasValue(phone)) return;

        if (!parentDataMap.has(normalized)) {
          // First time seeing this parent - capture name and address
          parentDataMap.set(normalized, {
            name: buildParentName(member, parentIndex),
            phones: new Set(),
            address: buildParentAddress(member), // Copy from child
            childKnvbIds: []
          });
        }

        const parentData = parentDataMap.get(normalized);

        // Collect phone numbers (may have multiple from different children)
        if (hasValue(phone)) {
          parentData.phones.add(String(phone).trim());
        }

        // Track child KNVB ID for relationship linking
        if (member.PublicPersonId) {
          parentData.childKnvbIds.push(member.PublicPersonId);
        }
      });
    });

    // Convert Map to parent records
    const parents = [];
    parentDataMap.forEach((data, email) => {
      parents.push(prepareParent(email, data));
    });

    logVerbose(`Prepared ${parents.length} parents for Stadion sync (deduplicated by email)`);

    if (verbose && parents.length > 0) {
      logVerbose('Sample prepared parent:');
      logVerbose(JSON.stringify(parents[0], null, 2));
    }

    return {
      success: true,
      parents: parents,
      skipped: 0
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error preparing Stadion parents:', errorMsg);
    return { success: false, parents: [], skipped: 0, error: errorMsg };
  }
}

module.exports = { runPrepare };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');

  runPrepare({ verbose })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      } else if (!verbose) {
        // In default mode, print summary
        console.log(`Prepared ${result.parents.length} parents for Stadion sync`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
