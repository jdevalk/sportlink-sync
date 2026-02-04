require('varlock/auto-load');

const fs = require('fs/promises');
const path = require('path');
const {
  openDb,
  upsertMembers,
  deleteMembersNotInList,
  getLatestSportlinkResults,
  getMembersForList,
  computeSourceHash
} = require('./laposta-db');
const { normalizeEmail, isValidEmail, buildChildFullName, hasValue } = require('./lib/parent-dedupe');
const { readEnv } = require('./lib/utils');
const { createLoggerAdapter } = require('./lib/log-adapters');

const DEFAULT_MAPPING = path.join(process.cwd(), 'field-mapping.json');
const MAX_LISTS = 4;
const LIST_ENV_KEYS = ['LAPOSTA_LIST', 'LAPOSTA_LIST2', 'LAPOSTA_LIST3', 'LAPOSTA_LIST4'];

const EMAIL_FIELDS = [
  { key: 'Email', type: 'primary' },
  { key: 'EmailAlternative', type: 'alternative' },
  { key: 'EmailAddressParent1', type: 'parent1' },
  { key: 'EmailAddressParent2', type: 'parent2' }
];

const EXCLUDED_CUSTOM_FIELDS = new Set([
  '{{email}}',
  'emailadres2',
  'emailouder1',
  'emailouder2'
]);

function getLatestResultsFromDb() {
  const db = openDb();
  try {
    return getLatestSportlinkResults(db);
  } finally {
    db.close();
  }
}

function buildBaseCustomFields(member, mapping) {
  const customFields = {};
  Object.entries(mapping).forEach(([lapostaField, sportlinkField]) => {
    if (EXCLUDED_CUSTOM_FIELDS.has(lapostaField)) {
      return;
    }
    const value = member[sportlinkField];
    if (hasValue(value)) {
      if (lapostaField === 'geslacht') {
        const normalized = String(value).trim();
        if (normalized === 'Male') {
          customFields[lapostaField] = 'M';
          return;
        }
        if (normalized === 'Female') {
          customFields[lapostaField] = 'V';
          return;
        }
      }
      customFields[lapostaField] = value;
    }
  });
  return customFields;
}

function buildParentNameParts(member, parentKey) {
  const parentName = member[parentKey];
  if (hasValue(parentName)) {
    return {
      voornaam: String(parentName).trim(),
      tussenvoegsel: '',
      achternaam: ''
    };
  }

  const firstName = hasValue(member.FirstName) ? String(member.FirstName).trim() : '';
  const infix = hasValue(member.Infix) ? String(member.Infix).trim() : '';
  const lastName = hasValue(member.LastName) ? String(member.LastName).trim() : '';

  return {
    voornaam: `Ouder/verzorger van ${firstName}`.trim(),
    tussenvoegsel: infix,
    achternaam: lastName
  };
}

function buildMemberNameParts(member) {
  const firstName = hasValue(member.FirstName) ? String(member.FirstName).trim() : '';
  const infix = hasValue(member.Infix) ? String(member.Infix).trim() : '';
  const lastName = hasValue(member.LastName) ? String(member.LastName).trim() : '';
  return {
    voornaam: firstName,
    tussenvoegsel: infix,
    achternaam: lastName
  };
}

function applyNameOverrides(customFields, overrides) {
  const updated = { ...customFields };
  if (overrides.voornaam !== undefined) {
    updated.voornaam = overrides.voornaam;
  }
  if (overrides.tussenvoegsel !== undefined) {
    updated.tussenvoegsel = overrides.tussenvoegsel;
  }
  if (overrides.achternaam !== undefined) {
    updated.achternaam = overrides.achternaam;
  }
  return updated;
}

function normalizeTeams(value) {
  if (!hasValue(value)) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap(item => String(item).split(','))
      .map(item => item.trim())
      .filter(Boolean);
  }
  if (value instanceof Set) {
    return Array.from(value)
      .flatMap(item => String(item).split(','))
      .map(item => item.trim())
      .filter(Boolean);
  }
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function mergeOuderVan(customFields, names) {
  if (!names || names.length === 0) return;
  const existing = hasValue(customFields.oudervan)
    ? customFields.oudervan.split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const merged = Array.from(new Set([...existing, ...names]));
  if (merged.length > 0) {
    customFields.oudervan = merged.join(', ');
  }
}

function mergeTeams(customFields, teamValue) {
  const teams = normalizeTeams(teamValue);
  if (teams.length === 0) return;
  const existing = hasValue(customFields.team)
    ? String(customFields.team).split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const merged = Array.from(new Set([...existing, ...teams]));
  if (merged.length > 0) {
    customFields.team = merged.join(', ');
  }
}

function mergeCommaField(customFields, fieldKey, fieldValue) {
  const values = normalizeTeams(fieldValue);
  if (values.length === 0) return;
  const existing = hasValue(customFields[fieldKey])
    ? String(customFields[fieldKey]).split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const merged = Array.from(new Set([...existing, ...values]));
  if (merged.length > 0) {
    customFields[fieldKey] = merged.join(', ');
  }
}

function mergeLeeftijdscategorie(customFields, leeftijdValue) {
  mergeCommaField(customFields, 'leeftijdscategorie', leeftijdValue);
}

function clearStandaloneParentFields(customFields) {
  const updated = { ...customFields };
  updated.datumpasfoto = '';
  updated.geslacht = '';
  updated.geboortedatum = '';
  updated.lidsinds = '';
  updated.mobielnummer = '';
  return updated;
}

function applyParentTelephone(customFields, telephoneValue) {
  const updated = { ...customFields };
  updated.telefoonnummer = hasValue(telephoneValue) ? String(telephoneValue).trim() : '';
  return updated;
}

function buildMemberEntry(
  member,
  email,
  emailType,
  baseCustomFields,
  parentNamesMap,
  parentTeamsMap,
  parentAgeClassMap,
  memberNameMap,
  isStandaloneParent
) {
  let customFields = { ...baseCustomFields };

  if (emailType === 'parent1') {
    const normalized = normalizeEmail(email);
    const memberName = memberNameMap.get(normalized);
    const parentName = memberName && (hasValue(memberName.voornaam) || hasValue(memberName.achternaam))
      ? memberName
      : buildParentNameParts(member, 'NameParent1');
    customFields = applyNameOverrides(customFields, {
      voornaam: parentName.voornaam,
      tussenvoegsel: parentName.tussenvoegsel,
      achternaam: parentName.achternaam
    });
    delete customFields.naamouder1;
    delete customFields.telefoonouder1;
    delete customFields.naamouder2;
    delete customFields.telefoonouder2;
    if (isStandaloneParent) {
      customFields = clearStandaloneParentFields(customFields);
      customFields = applyParentTelephone(customFields, member.TelephoneParent1);
    }
    mergeOuderVan(customFields, parentNamesMap.get(normalized));
    mergeTeams(customFields, parentTeamsMap.get(normalized));
    mergeLeeftijdscategorie(customFields, parentAgeClassMap.get(normalized));
  } else if (emailType === 'parent2') {
    const normalized = normalizeEmail(email);
    const memberName = memberNameMap.get(normalized);
    const parentName = memberName && (hasValue(memberName.voornaam) || hasValue(memberName.achternaam))
      ? memberName
      : buildParentNameParts(member, 'NameParent2');
    customFields = applyNameOverrides(customFields, {
      voornaam: parentName.voornaam,
      tussenvoegsel: parentName.tussenvoegsel,
      achternaam: parentName.achternaam
    });
    delete customFields.naamouder1;
    delete customFields.telefoonouder1;
    delete customFields.naamouder2;
    delete customFields.telefoonouder2;
    if (isStandaloneParent) {
      customFields = clearStandaloneParentFields(customFields);
      customFields = applyParentTelephone(customFields, member.TelephoneParent2);
    }
    mergeOuderVan(customFields, parentNamesMap.get(normalized));
    mergeTeams(customFields, parentTeamsMap.get(normalized));
    mergeLeeftijdscategorie(customFields, parentAgeClassMap.get(normalized));
  }

  if (emailType === 'primary' || emailType === 'alternative') {
    const normalized = normalizeEmail(email);
    const parentEmail1 = normalizeEmail(member.EmailAddressParent1);
    const parentEmail2 = normalizeEmail(member.EmailAddressParent2);
    const usesParentEmail = normalized && (normalized === parentEmail1 || normalized === parentEmail2);
    if (!usesParentEmail) {
      mergeOuderVan(customFields, parentNamesMap.get(normalized));
      mergeTeams(customFields, parentTeamsMap.get(normalized));
      mergeLeeftijdscategorie(customFields, parentAgeClassMap.get(normalized));
    }
  }

  return {
    email,
    custom_fields: customFields
  };
}

/**
 * Prepare Laposta members from Sportlink data
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode
 * @param {string} [options.inputPath] - Optional input JSON file path
 * @param {string} [options.mappingPath] - Optional field mapping file path
 * @returns {Promise<{success: boolean, lists: Array<{index: number, total: number, updates: number}>, excluded: number, error?: string}>}
 */
async function runPrepare(options = {}) {
  const { logger, verbose = false, inputPath, mappingPath } = options;

  const { verbose: logVerbose, error: logError } = createLoggerAdapter({ logger, verbose });

  try {
    const resolvedInputPath = inputPath || null;
    const resolvedMappingPath = mappingPath || DEFAULT_MAPPING;

    const [inputContent, mappingContent] = await Promise.all([
      resolvedInputPath ? fs.readFile(resolvedInputPath, 'utf8') : Promise.resolve(getLatestResultsFromDb()),
      fs.readFile(resolvedMappingPath, 'utf8')
    ]);

    if (!inputContent) {
      const errorMsg = 'No Sportlink results found in SQLite. Run the download first.';
      logError(errorMsg);
      return { success: false, lists: [], excluded: 0, error: errorMsg };
    }

    const sportlinkData = JSON.parse(inputContent);
    const mapping = JSON.parse(mappingContent);
    const members = Array.isArray(sportlinkData.Members) ? sportlinkData.Members : [];

    const primaryEmailMap = new Map();
    members.forEach((member, index) => {
      const emailValue = member.Email;
      if (!isValidEmail(emailValue)) return;
      const normalized = normalizeEmail(emailValue);
      if (!primaryEmailMap.has(normalized)) {
        primaryEmailMap.set(normalized, []);
      }
      primaryEmailMap.get(normalized).push({ index, member });
    });

    const emailUsageMap = new Map();
    members.forEach((member, memberIndex) => {
      EMAIL_FIELDS.forEach(({ key }) => {
        const emailValue = member[key];
        if (!isValidEmail(emailValue)) return;
        const normalized = normalizeEmail(emailValue);
        if (!emailUsageMap.has(normalized)) {
          emailUsageMap.set(normalized, new Set());
        }
        emailUsageMap.get(normalized).add(memberIndex);
      });
    });

    const primaryEmails = new Set();
    members.forEach((member) => {
      if (!isValidEmail(member.Email)) return;
      primaryEmails.add(normalizeEmail(member.Email));
    });

    const teamFieldKey = mapping.team;
    const leeftijdFieldKey = mapping.leeftijdscategorie;
    const memberNameMap = new Map();
    const parentNamesMap = new Map();
    const parentTeamsMap = new Map();
    const parentAgeClassMap = new Map();
    primaryEmailMap.forEach((entries, normalized) => {
      if (entries.length === 0) return;
      const { member } = entries[0];
      memberNameMap.set(normalized, buildMemberNameParts(member));
    });
    members.forEach((member) => {
      const childName = buildChildFullName(member);
      const teamValue = teamFieldKey ? member[teamFieldKey] : '';
      const leeftijdValue = leeftijdFieldKey ? member[leeftijdFieldKey] : '';
      EMAIL_FIELDS.filter(field => field.type === 'parent1' || field.type === 'parent2')
        .forEach(({ key }) => {
          const emailValue = member[key];
          if (!isValidEmail(emailValue)) return;
          const normalized = normalizeEmail(emailValue);
          if (!parentNamesMap.has(normalized)) {
            parentNamesMap.set(normalized, []);
          }
          if (childName) {
            const existing = parentNamesMap.get(normalized);
            if (!existing.includes(childName)) {
              existing.push(childName);
            }
          }
          if (!parentTeamsMap.has(normalized)) {
            parentTeamsMap.set(normalized, new Set());
          }
          normalizeTeams(teamValue).forEach(team => parentTeamsMap.get(normalized).add(team));
          if (!parentAgeClassMap.has(normalized)) {
            parentAgeClassMap.set(normalized, new Set());
          }
          normalizeTeams(leeftijdValue).forEach(category => parentAgeClassMap.get(normalized).add(category));
        });
    });

    const listMembers = Array.from({ length: MAX_LISTS }, () => []);
    const emailAssignmentCount = new Map();
    const parentEmailAssigned = new Set();
    let excludedDueToDuplication = 0;
    members.forEach((member, memberIndex) => {
      const baseCustomFields = buildBaseCustomFields(member, mapping);
      const dedupeLocal = new Set();
      const primaryEmail = member.Email;
      const normalizedPrimary = isValidEmail(primaryEmail) ? normalizeEmail(primaryEmail) : '';

      EMAIL_FIELDS.forEach(({ key, type }) => {
        const emailValue = member[key];
        if (!isValidEmail(emailValue)) return;

        const normalized = normalizeEmail(emailValue);
        if (dedupeLocal.has(normalized)) return;
        if (type === 'parent1' && normalizedPrimary && normalized === normalizedPrimary) {
          const usage = emailUsageMap.get(normalized);
          if (usage && usage.size === 1) {
            return;
          }
        }
        if ((type === 'parent1' || type === 'parent2') && primaryEmails.has(normalized)) {
          return;
        }
        if ((type === 'parent1' || type === 'parent2') && parentEmailAssigned.has(normalized)) {
          return;
        }
        const isStandaloneParent = (type === 'parent1' || type === 'parent2')
          ? !primaryEmails.has(normalized)
          : false;
        const newEntry = buildMemberEntry(
          member,
          emailValue.trim(),
          type,
          baseCustomFields,
          parentNamesMap,
          parentTeamsMap,
          parentAgeClassMap,
          memberNameMap,
          isStandaloneParent
        );
        const usedCount = emailAssignmentCount.get(normalized) || 0;
        if (usedCount >= MAX_LISTS) {
          excludedDueToDuplication += 1;
          return;
        }
        emailAssignmentCount.set(normalized, usedCount + 1);
        listMembers[usedCount].push(newEntry);
        dedupeLocal.add(normalized);
        if (type === 'parent1' || type === 'parent2') {
          parentEmailAssigned.add(normalized);
        }
      });
    });

    const db = openDb();
    const updateCounts = Array.from({ length: MAX_LISTS }, () => 0);
    try {
      listMembers.forEach((membersForList, index) => {
        const listIndex = index + 1;
        const existingMembers = getMembersForList(db, listIndex);
        const existingByEmail = new Map(
          existingMembers.map((member) => [normalizeEmail(member.email), member])
        );
        updateCounts[index] = membersForList.reduce((count, member) => {
          const normalized = normalizeEmail(member.email);
          const existing = existingByEmail.get(normalized);
          const newHash = computeSourceHash(member.email, member.custom_fields || {});
          if (!existing || !existing.last_synced_hash || existing.last_synced_hash !== newHash) {
            return count + 1;
          }
          return count;
        }, 0);

        const listId = readEnv(LIST_ENV_KEYS[index]) || null;
        upsertMembers(db, listIndex, listId, membersForList);
        deleteMembersNotInList(
          db,
          listIndex,
          membersForList.map((member) => member.email)
        );
      });
    } finally {
      db.close();
    }

    // Build result stats
    const lists = listMembers.map((membersForList, index) => ({
      index: index + 1,
      total: membersForList.length,
      updates: updateCounts[index]
    }));

    // Log verbose details
    lists.forEach(({ index, total, updates }) => {
      logVerbose(`Prepared ${total} Laposta members for list ${index} (${updates} updates)`);
    });

    if (excludedDueToDuplication > 0) {
      logError(`Members excluded due to duplicate Email (all lists full): ${excludedDueToDuplication}`);
    }

    return {
      success: true,
      lists,
      excluded: excludedDueToDuplication
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error:', errorMsg);
    return { success: false, lists: [], excluded: 0, error: errorMsg };
  }
}

module.exports = { runPrepare };

// CLI entry point
if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const inputPath = args[0] || null;
  const mappingPath = args[1] || null;

  runPrepare({ verbose, inputPath, mappingPath })
    .then(result => {
      if (!result.success) {
        process.exitCode = 1;
      } else if (verbose) {
        // In verbose mode, stats are already logged
      } else {
        // In default mode, print summary
        result.lists.forEach(({ index, total, updates }) => {
          console.log(`Prepared ${total} Laposta members for list ${index} (${updates} updates).`);
        });
        if (result.excluded > 0) {
          console.error(`Members excluded due to duplicate Email (all lists full): ${result.excluded}`);
        }
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exitCode = 1;
    });
}
