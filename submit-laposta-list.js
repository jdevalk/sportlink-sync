require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const https = require('https');
const {
  openDb,
  upsertMembers,
  getMembersNeedingSync,
  updateSyncState,
  upsertLapostaFields
} = require('./laposta-db');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function getListConfig(listIndex) {
  const envKeys = ['LAPOSTA_LIST', 'LAPOSTA_LIST2', 'LAPOSTA_LIST3', 'LAPOSTA_LIST4'];
  const fileNames = [
    'laposta-members.json',
    'laposta-members-list2.json',
    'laposta-members-list3.json',
    'laposta-members-list4.json'
  ];
  const envKey = envKeys[listIndex - 1];
  const fileName = fileNames[listIndex - 1];
  if (!envKey || !fileName) {
    throw new Error(`Invalid list index ${listIndex}. Use 1-4.`);
  }
  return {
    envKey,
    listId: readEnv(envKey),
    filePath: path.join(process.cwd(), fileName)
  };
}

function extractMembers(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.members)) return payload.members;
  return [];
}

function extractActions(payload) {
  if (payload && Array.isArray(payload.actions) && payload.actions.length > 0) {
    return payload.actions;
  }
  return ['add', 'update'];
}

function parseArgs(argv) {
  const listIndex = argv[2] ? Number.parseInt(argv[2], 10) : null;
  const force = argv.includes('--force') || argv.includes('--all');
  return { listIndex, force };
}

function appendCustomFields(params, customFields) {
  if (!customFields || typeof customFields !== 'object') return;
  Object.entries(customFields).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        params.append(`custom_fields[${key}][]`, entry ?? '');
      });
      return;
    }
    params.append(`custom_fields[${key}]`, value ?? '');
  });
}

function lapostaBulkRequest(listId, actions, members) {
  return new Promise((resolve, reject) => {
    const apiKey = readEnv('LAPOSTA_API_KEY');
    if (!apiKey) {
      reject(new Error('LAPOSTA_API_KEY not found in .env file'));
      return;
    }

    const baseUrl = 'https://api.laposta.nl';
    const url = new URL(`/v2/list/${listId}/members`, baseUrl);
    const body = JSON.stringify({ actions, members });

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          const error = new Error(`Laposta API error (${res.statusCode})`);
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function fetchLapostaFields(listId) {
  return new Promise((resolve, reject) => {
    const apiKey = readEnv('LAPOSTA_API_KEY');
    if (!apiKey) {
      reject(new Error('LAPOSTA_API_KEY not found in .env file'));
      return;
    }

    const baseUrl = 'https://api.laposta.nl';
    const url = new URL('/v2/field', baseUrl);
    url.searchParams.set('list_id', listId);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const fields = Array.isArray(parsed.data)
            ? parsed.data.map(item => item.field || item)
            : [];
          resolve(fields);
        } else {
          const error = new Error(`Laposta API error (${res.statusCode})`);
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

function lapostaMemberRequest(listId, member, actions) {
  return new Promise((resolve, reject) => {
    const apiKey = readEnv('LAPOSTA_API_KEY');
    if (!apiKey) {
      reject(new Error('LAPOSTA_API_KEY not found in .env file'));
      return;
    }

    const baseUrl = 'https://api.laposta.nl';
    const url = new URL('/v2/member', baseUrl);
    const params = new URLSearchParams();
    params.append('list_id', listId);
    params.append('ip', '3.3.3.3');
    params.append('email', member.email);
    appendCustomFields(params, member.custom_fields);

    if (actions.includes('update') || actions.includes('add')) {
      params.append('options[upsert]', 'true');
    }

    const body = params.toString();
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          const error = new Error(`Laposta API error (${res.statusCode})`);
          error.details = parsed;
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function syncList(listIndex, force) {
  const { envKey, listId } = getListConfig(listIndex);
  if (!listId) {
    console.log(`Skipping list ${listIndex}: ${envKey} not found in .env.`);
    return;
  }

  const actions = ['add', 'update'];
  const db = openDb();
  try {
    try {
      const fields = await fetchLapostaFields(listId);
      if (fields.length > 0) {
        upsertLapostaFields(db, listId, fields);
      }
    } catch (error) {
      console.error('Warning: could not fetch Laposta fields:', error.message);
    }

    const members = getMembersNeedingSync(db, listIndex, force);
    if (members.length === 0) {
      console.log(`No changes to sync for list ${listIndex}.`);
      return;
    }

    const label = force ? 'members' : 'changed members';
    console.log(`Submitting ${members.length} ${label} to Laposta list ${listIndex} (${listId})...`);
    console.log('Submitting members one by one (non-bulk).');

    const errors = [];
    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      console.log(`Progress list ${listIndex}: ${i + 1}/${members.length}`);
      try {
        await lapostaMemberRequest(listId, member, actions);
        updateSyncState(db, listIndex, member.email, member.source_hash);
      } catch (error) {
        errors.push({
          index: i,
          email: member.email,
          error: error.details || error.message
        });
      }
      if (i < members.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (errors.length > 0) {
      const errorPath = path.join(process.cwd(), `laposta-submit-errors-list${listIndex}.json`);
      await fs.writeFile(errorPath, JSON.stringify(errors, null, 2));
      console.error(`Completed with ${errors.length} errors.`);
      console.error(`Error details written to: ${errorPath}`);
    } else {
      console.log('Completed without errors.');
    }
  } finally {
    db.close();
  }
}

async function main() {
  const { listIndex, force } = parseArgs(process.argv);
  const listIndexes = listIndex && listIndex >= 1 && listIndex <= 4
    ? [listIndex]
    : [1, 2, 3, 4];

  for (const index of listIndexes) {
    // eslint-disable-next-line no-await-in-loop
    await syncList(index, force);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.details) {
    console.error('Details:', JSON.stringify(err.details, null, 2));
  }
  process.exitCode = 1;
});
