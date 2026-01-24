require('dotenv').config();

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
  const args = argv.slice(2).filter(arg => !arg.startsWith('--'));
  const listIndex = args[0] ? Number.parseInt(args[0], 10) : null;
  const force = argv.includes('--force') || argv.includes('--all');
  const verbose = argv.includes('--verbose');
  return { listIndex, force, verbose };
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

/**
 * Sync a single list to Laposta
 * @param {number} listIndex - List index (1-4)
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance
 * @param {boolean} [options.verbose] - Verbose mode
 * @param {boolean} [options.force] - Force sync all members
 * @returns {Promise<{index: number, listId: string|null, total: number, synced: number, added: number, updated: number, errors: Array}>}
 */
async function syncList(listIndex, options = {}) {
  const { logger, verbose = false, force = false } = options;
  const logVerbose = logger ? logger.verbose.bind(logger) : (verbose ? console.log : () => {});

  const { envKey, listId } = getListConfig(listIndex);

  // Return empty stats if list not configured
  if (!listId) {
    return {
      index: listIndex,
      listId: null,
      total: 0,
      synced: 0,
      added: 0,
      updated: 0,
      errors: []
    };
  }

  const actions = ['add', 'update'];
  const db = openDb();
  const result = {
    index: listIndex,
    listId,
    total: 0,
    synced: 0,
    added: 0,
    updated: 0,
    errors: []
  };

  try {
    // Fetch and cache Laposta fields
    try {
      const fields = await fetchLapostaFields(listId);
      if (fields.length > 0) {
        upsertLapostaFields(db, listId, fields);
      }
    } catch (error) {
      // Non-fatal: continue without field caching
      logVerbose(`Warning: could not fetch Laposta fields: ${error.message}`);
    }

    const members = getMembersNeedingSync(db, listIndex, force);
    result.total = members.length;

    if (members.length === 0) {
      return result;
    }

    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      logVerbose(`Syncing ${i + 1}/${members.length}: ${member.email}`);

      try {
        const response = await lapostaMemberRequest(listId, member, actions);
        updateSyncState(db, listIndex, member.email, member.source_hash, member.custom_fields);
        result.synced += 1;

        // Determine if this was an add or update based on API response
        // Laposta returns member data; if it has a created_at that matches modified_at, it's new
        const memberData = response.body?.member;
        if (memberData) {
          const createdAt = memberData.created;
          const modifiedAt = memberData.modified;
          if (createdAt === modifiedAt) {
            result.added += 1;
          } else {
            result.updated += 1;
          }
        } else {
          // Fallback: count as update if we can't determine
          result.updated += 1;
        }
      } catch (error) {
        const errorMessage = error.details?.error?.message || error.message || String(error);
        result.errors.push({
          email: member.email,
          message: errorMessage
        });
      }

      // Rate limit: wait 2 seconds between requests (except after last)
      if (i < members.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return result;
  } finally {
    db.close();
  }
}

/**
 * Run Laposta submission
 * @param {Object} options
 * @param {Object} [options.logger] - Logger instance with log(), verbose(), error() methods
 * @param {boolean} [options.verbose=false] - Verbose mode (show per-member progress)
 * @param {boolean} [options.force=false] - Sync all members, not just changed
 * @param {number|null} [options.listIndex=null] - Specific list (1-4) or null for all
 * @returns {Promise<{success: boolean, lists: Array, error?: string}>}
 */
async function runSubmit(options = {}) {
  const { logger, verbose = false, force = false, listIndex = null } = options;

  const logError = logger ? logger.error.bind(logger) : console.error;

  try {
    const listIndexes = listIndex && listIndex >= 1 && listIndex <= 4
      ? [listIndex]
      : [1, 2, 3, 4];

    const lists = [];
    for (const index of listIndexes) {
      // eslint-disable-next-line no-await-in-loop
      const result = await syncList(index, { logger, verbose, force });
      lists.push(result);
    }

    // Check if any list had errors
    const totalErrors = lists.reduce((sum, list) => sum + list.errors.length, 0);

    return {
      success: totalErrors === 0,
      lists
    };
  } catch (err) {
    const errorMsg = err.message || String(err);
    logError('Error:', errorMsg);
    return {
      success: false,
      lists: [],
      error: errorMsg
    };
  }
}

module.exports = { runSubmit };

// CLI entry point
if (require.main === module) {
  const { listIndex, force, verbose } = parseArgs(process.argv);

  runSubmit({ verbose, force, listIndex })
    .then(result => {
      if (!result.success) {
        // Print summary of what happened
        result.lists.forEach(list => {
          if (list.listId) {
            const label = force ? 'members' : 'changed members';
            if (list.total === 0) {
              console.log(`No changes to sync for list ${list.index}.`);
            } else {
              console.log(`List ${list.index}: ${list.synced}/${list.total} ${label} synced (${list.added} added, ${list.updated} updated)`);
              if (list.errors.length > 0) {
                console.error(`  ${list.errors.length} errors occurred`);
              }
            }
          } else {
            console.log(`Skipping list ${list.index}: not configured in .env`);
          }
        });
        process.exitCode = 1;
      } else {
        // Print summary
        result.lists.forEach(list => {
          if (list.listId) {
            const label = force ? 'members' : 'changed members';
            if (list.total === 0) {
              console.log(`No changes to sync for list ${list.index}.`);
            } else {
              console.log(`List ${list.index}: ${list.synced}/${list.total} ${label} synced (${list.added} added, ${list.updated} updated)`);
            }
          } else {
            console.log(`Skipping list ${list.index}: not configured in .env`);
          }
        });
      }
    })
    .catch((err) => {
      console.error('Error:', err.message);
      if (err.details) {
        console.error('Details:', JSON.stringify(err.details, null, 2));
      }
      process.exitCode = 1;
    });
}
