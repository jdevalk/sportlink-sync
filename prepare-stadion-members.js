require('varlock/auto-load');

const { openDb, getLatestSportlinkResults } = require('./laposta-db');

/**
 * Map Sportlink gender codes to Stadion format
 * @param {string} sportlinkGender - Gender code from Sportlink (Male/Female)
 * @returns {string} - 'male', 'female', or empty string for unknown
 */
function mapGender(sportlinkGender) {
  const mapping = { 'Male': 'male', 'Female': 'female' };
  return mapping[sportlinkGender] || '';
}

/**
 * Extract birth year from date string
 * @param {string} dateOfBirth - Date in YYYY-MM-DD format
 * @returns {number|null} - Year as integer or null
 */
function extractBirthYear(dateOfBirth) {
  if (!dateOfBirth) return null;
  const year = parseInt(dateOfBirth.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

/**
 * Build name fields, merging Dutch tussenvoegsel into last name
 * @param {Object} member - Sportlink member record
 * @returns {{first_name: string, last_name: string}}
 */
function buildName(member) {
  const firstName = (member.FirstName || '').trim();
  const infix = (member.Infix || '').trim();
  const lastName = (member.LastName || '').trim();
  const fullLastName = [infix, lastName].filter(Boolean).join(' ');

  return {
    first_name: firstName,
    last_name: fullLastName
  };
}

/**
 * Build contact info array for ACF repeater
 * Only includes items where value is non-empty
 * @param {Object} member - Sportlink member record
 * @returns {Array<{contact_type: string, contact_label: string, contact_value: string}>}
 */
function buildContactInfo(member) {
  const contacts = [];
  const email = (member.Email || '').trim();
  const mobile = (member.Mobile || '').trim();
  const phone = (member.Telephone || '').trim();

  if (email) contacts.push({ contact_type: 'email', contact_label: '', contact_value: email });
  if (mobile) contacts.push({ contact_type: 'mobile', contact_label: '', contact_value: mobile });
  if (phone) contacts.push({ contact_type: 'phone', contact_label: '', contact_value: phone });

  return contacts;
}

/**
 * Build addresses array for ACF repeater
 * Only includes address if at least street or city present
 * @param {Object} member - Sportlink member record
 * @returns {Array<{address_label: string, street: string, postal_code: string, city: string, country: string}>}
 */
function buildAddresses(member) {
  const streetName = (member.StreetName || '').trim();
  const houseNumber = (member.AddressNumber || '').toString().trim();
  const houseNumberAppendix = (member.AddressNumberAppendix || '').trim();
  const city = (member.City || '').trim();

  // Omit empty address entirely
  if (!streetName && !city) return [];

  // Combine street name with house number and appendix
  const streetParts = [streetName, houseNumber].filter(Boolean);
  if (houseNumberAppendix) streetParts.push(houseNumberAppendix);
  const street = streetParts.join(' ');

  return [{
    address_label: '',
    street: street,
    postal_code: (member.ZipCode || '').trim(),
    city: city,
    country: 'Nederland'
  }];
}

/**
 * Transform a Sportlink member to Stadion person format
 * @param {Object} sportlinkMember - Raw Sportlink member record
 * @returns {{knvb_id: string, email: string|null, data: Object}}
 */
function preparePerson(sportlinkMember) {
  const name = buildName(sportlinkMember);
  const gender = mapGender(sportlinkMember.GenderCode);
  const birthYear = extractBirthYear(sportlinkMember.DateOfBirth);

  const acf = {
    first_name: name.first_name,
    last_name: name.last_name,
    'knvb-id': sportlinkMember.PublicPersonId,
    contact_info: buildContactInfo(sportlinkMember),
    addresses: buildAddresses(sportlinkMember)
  };

  // Only add optional fields if they have values
  if (gender) acf.gender = gender;
  if (birthYear) acf.birth_year = birthYear;

  // Extract PersonImageDate for photo state tracking
  // Normalize to null if empty string or whitespace
  const personImageDate = (sportlinkMember.PersonImageDate || '').trim() || null;

  return {
    knvb_id: sportlinkMember.PublicPersonId,
    email: (sportlinkMember.Email || '').trim().toLowerCase() || null,
    person_image_date: personImageDate,
    data: {
      status: 'publish',
      acf: acf
    }
  };
}

/**
 * Validate member has required fields for Stadion sync
 * @param {Object} member - Sportlink member record
 * @returns {boolean}
 */
function isValidMember(member) {
  // PublicPersonId (KNVB ID) is required for matching
  if (!member.PublicPersonId) return false;
  // Must have at least a first name (required by Stadion API)
  if (!member.FirstName) return false;
  return true;
}

/**
 * Prepare Stadion members from Sportlink data
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @returns {Promise<{success: boolean, members: Array, skipped: number, error?: string}>}
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
        return { success: false, members: [], skipped: 0, error: errorMsg };
      }
      sportlinkData = JSON.parse(resultsJson);
    } finally {
      db.close();
    }

    const members = Array.isArray(sportlinkData.Members) ? sportlinkData.Members : [];
    logVerbose(`Found ${members.length} Sportlink members in database`);

    // Filter out invalid members and transform valid ones
    const validMembers = [];
    let skippedCount = 0;

    members.forEach((member, index) => {
      if (!isValidMember(member)) {
        skippedCount++;
        const reason = !member.PublicPersonId
          ? 'missing KNVB ID'
          : 'missing first name';
        logVerbose(`Skipping member at index ${index}: ${reason}`);
        return;
      }

      const prepared = preparePerson(member);
      validMembers.push(prepared);
    });

    logVerbose(`Prepared ${validMembers.length} members for Stadion sync (${skippedCount} skipped)`);

    if (verbose && validMembers.length > 0) {
      logVerbose('Sample prepared member:');
      logVerbose(JSON.stringify(validMembers[0], null, 2));
    }

    return {
      success: true,
      members: validMembers,
      skipped: skippedCount
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error preparing Stadion members:', errorMsg);
    return { success: false, members: [], skipped: 0, error: errorMsg };
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
        console.log(`Prepared ${result.members.length} members for Stadion sync (${result.skipped} skipped - missing KNVB ID or first name)`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
