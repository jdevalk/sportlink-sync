require('dotenv').config();

const https = require('https');

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

const ENV_KEYS = ['LAPOSTA_LIST', 'LAPOSTA_LIST2', 'LAPOSTA_LIST3', 'LAPOSTA_LIST4'];

function getListConfig(listIndex) {
  const envKey = ENV_KEYS[listIndex - 1];
  if (!envKey) {
    throw new Error(`Invalid list index ${listIndex}. Use 1-4.`);
  }
  return {
    envKey,
    listId: readEnv(envKey)
  };
}

function normalizeEmail(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function extractMembers(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.members)) return payload.members;
  if (Array.isArray(payload.data)) {
    return payload.data.map((item) => item.member || item);
  }
  if (payload.member) return [payload.member];
  return [];
}

function getLastName(member) {
  if (!member) return '';
  if (member.last_name) return String(member.last_name).trim();
  if (member.lastname) return String(member.lastname).trim();
  if (member.LastName) return String(member.LastName).trim();
  const custom = member.custom_fields || member.customFields || {};
  if (custom.achternaam) return String(custom.achternaam).trim();
  if (custom.last_name) return String(custom.last_name).trim();
  if (custom.lastname) return String(custom.lastname).trim();
  return '';
}

function isParentMember(member) {
  return getLastName(member) === '';
}

function parseTimestamp(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getMemberTimestamp(member) {
  return Math.max(
    parseTimestamp(member.modified),
    parseTimestamp(member.signup_date),
    parseTimestamp(member.created_at)
  );
}

function lapostaRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const apiKey = readEnv('LAPOSTA_API_KEY');
    if (!apiKey) {
      reject(new Error('LAPOSTA_API_KEY not found in .env file'));
      return;
    }

    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

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
    if (body) {
      req.write(payload);
    }
    req.end();
  });
}

async function fetchMembers(listId, state) {
  const baseUrl = 'https://api.laposta.nl';
  const url = new URL('/v2/member', baseUrl);
  url.searchParams.set('list_id', listId);
  if (state) {
    url.searchParams.set('state', state);
  }
  const response = await lapostaRequest('GET', url);
  return extractMembers(response.body);
}

async function deleteMember(listId, member) {
  const baseUrl = 'https://api.laposta.nl';
  const identifier = member.member_id || member.email || member.EmailAddress;
  if (!identifier) {
    throw new Error('Cannot delete member without member_id or email');
  }
  const url = new URL(`/v2/member/${encodeURIComponent(identifier)}`, baseUrl);
  url.searchParams.set('list_id', listId);
  return lapostaRequest('DELETE', url);
}

function parseArgs(argv) {
  const listIndex = Number.parseInt(argv[2] || '0', 10);
  const apply = argv.includes('--apply') || argv.includes('--delete');
  const stateArg = argv.find(arg => arg.startsWith('--state='));
  const state = stateArg ? stateArg.split('=')[1] : 'active';
  return { listIndex, apply, state };
}

async function fetchListMembers(listIndex, state) {
  const { envKey, listId } = getListConfig(listIndex);
  if (!listId) {
    console.log(`Skipping list ${listIndex}: ${envKey} not found in .env.`);
    return null;
  }

  const members = await fetchMembers(listId, state);
  return { listIndex, listId, members };
}

async function main() {
  const { listIndex, apply, state } = parseArgs(process.argv);
  const listIndexes = listIndex >= 1 && listIndex <= 4
    ? [listIndex]
    : [1, 2, 3, 4];

  const listResults = [];
  for (const index of listIndexes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchListMembers(index, state);
    if (result) {
      listResults.push(result);
    }
  }

  if (listResults.length === 0) {
    console.log('No lists available to check.');
    return;
  }

  const byEmail = new Map();
  listResults.forEach(({ listIndex: index, listId, members }) => {
    if (!members || members.length === 0) {
      console.log(`List ${index}: no members returned from Laposta.`);
      return;
    }
    members.forEach((member) => {
      const normalized = normalizeEmail(member.email || member.EmailAddress || '');
      if (!normalized) return;
      if (!byEmail.has(normalized)) {
        byEmail.set(normalized, []);
      }
      byEmail.get(normalized).push({ listIndex: index, listId, member });
    });
  });

  const duplicates = Array.from(byEmail.entries())
    .filter(([, items]) => items.length > 1)
    .map(([email, items]) => {
      const parentItems = items.filter(item => isParentMember(item.member));
      if (parentItems.length <= 1) {
        return null;
      }
      const sorted = [...parentItems].sort((a, b) => a.listIndex - b.listIndex);
      const keep = sorted[0];
      const remove = sorted.slice(1);
      return { email, keep, remove };
    })
    .filter(Boolean)
    .filter(entry => entry.remove.length > 0);

  if (duplicates.length === 0) {
    console.log('No duplicate parent emails found across lists.');
    return;
  }

  const totalRemovals = duplicates.reduce((sum, entry) => sum + entry.remove.length, 0);
  console.log(`Found ${duplicates.length} duplicate parent emails across lists (${totalRemovals} entries to remove).`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to delete.');
    duplicates.slice(0, 10).forEach((entry) => {
      const ids = entry.remove
        .map(item => `${item.listIndex}:${item.member.member_id || item.member.email || item.member.EmailAddress}`)
        .join(', ');
      console.log(`Duplicate ${entry.email}: remove ${ids}`);
    });
    if (duplicates.length > 10) {
      console.log(`(Showing first 10 duplicates of ${duplicates.length}.)`);
    }
    return;
  }

  for (const entry of duplicates) {
    for (const item of entry.remove) {
      // eslint-disable-next-line no-await-in-loop
      await deleteMember(item.listId, item.member);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log(`Deleted duplicate ${entry.email} from list ${item.listIndex} (${item.member.member_id || item.member.email || item.member.EmailAddress})`);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.details) {
    console.error('Details:', JSON.stringify(err.details, null, 2));
  }
  process.exitCode = 1;
});
