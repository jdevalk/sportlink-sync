require('varlock/auto-load');

const { stadionRequest } = require('../lib/stadion-client');
const { openDb, getAllTrackedMembers, getAllActiveMemberFunctions, getAllActiveMemberCommittees } = require('../lib/stadion-db');

async function clearWorkHistory() {
  const db = openDb();

  // Get members who have functions or committees
  const functions = getAllActiveMemberFunctions(db);
  const committees = getAllActiveMemberCommittees(db);
  const knvbIds = new Set([...functions.map(f => f.knvb_id), ...committees.map(c => c.knvb_id)]);

  // Get their stadion_ids
  const members = getAllTrackedMembers(db);
  const memberMap = new Map(members.map(m => [m.knvb_id, m.stadion_id]));

  console.log('Clearing work_history for', knvbIds.size, 'members...');

  let count = 0;
  for (const knvbId of knvbIds) {
    const stadionId = memberMap.get(knvbId);
    if (!stadionId) continue;

    try {
      // Get existing data
      const resp = await stadionRequest(`wp/v2/people/${stadionId}`, 'GET', null, {});
      const firstName = resp.body.acf?.first_name || '';
      const lastName = resp.body.acf?.last_name || '';

      // Clear work_history
      await stadionRequest(`wp/v2/people/${stadionId}`, 'PUT', {
        acf: { first_name: firstName, last_name: lastName, work_history: [] }
      }, {});
      count++;
      if (count % 50 === 0) console.log('Cleared', count, 'members...');
    } catch (e) {
      console.log('Error for', knvbId + ':', e.message);
    }
  }

  console.log('Done. Cleared work_history for', count, 'members');
  db.close();
}

clearWorkHistory();
