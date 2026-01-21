require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { openDb, upsertMembers, deleteMembersForList, getLatestSportlinkResults } = require('./laposta-db');

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

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function getLatestResultsFromDb() {
  const db = openDb();
  try {
    return getLatestSportlinkResults(db);
  } finally {
    db.close();
  }
}

function normalizeEmail(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.includes('@');
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

function buildChildFullName(member) {
  const firstName = hasValue(member.FirstName) ? String(member.FirstName).trim() : '';
  const infix = hasValue(member.Infix) ? String(member.Infix).trim() : '';
  const lastName = hasValue(member.LastName) ? String(member.LastName).trim() : '';
  return [firstName, infix, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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

async function main() {
  const inputPath = process.argv[2] || null;
  const mappingPath = process.argv[3] || DEFAULT_MAPPING;

  const [inputContent, mappingContent] = await Promise.all([
    inputPath ? fs.readFile(inputPath, 'utf8') : Promise.resolve(getLatestResultsFromDb()),
    fs.readFile(mappingPath, 'utf8')
  ]);

  if (!inputContent) {
    throw new Error('No Sportlink results found in SQLite. Run the download first.');
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
  try {
    listMembers.forEach((membersForList, index) => {
      const listId = readEnv(LIST_ENV_KEYS[index]) || null;
      deleteMembersForList(db, index + 1);
      upsertMembers(db, index + 1, listId, membersForList);
    });
  } finally {
    db.close();
  }
  listMembers.forEach((membersForList, index) => {
    console.log(`Prepared ${membersForList.length} Laposta members for list ${index + 1}.`);
  });
  if (excludedDueToDuplication > 0) {
    console.error(`Members excluded due to duplicate Email (all lists full): ${excludedDueToDuplication}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
