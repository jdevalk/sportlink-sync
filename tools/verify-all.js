const db = require('../lib/stadion-db');
const detectModule = require('../lib/detect-stadion-changes');
const fs = require('fs');

console.log('=== Overall Verification ===\n');

// 1. Schema verification
console.log('1. Schema verification');
const d = db.openDb(':memory:');
const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
const hasRequiredTables = ['stadion_change_detections', 'reverse_sync_state'].every(t => tables.includes(t));
console.log(`   Required tables: ${hasRequiredTables ? 'PASS' : 'FAIL'}`);
d.close();

// 2. Module exports verification
console.log('\n2. Module exports verification');
const exports = Object.keys(detectModule);
console.log(`   Exports: ${exports.join(', ')}`);
const hasRequiredExports = ['detectChanges', 'extractFieldValue', 'computeTrackedFieldsHash'].every(e => exports.includes(e));
console.log(`   Has required exports: ${hasRequiredExports ? 'PASS' : 'FAIL'}`);

// 3. CLI entry point verification
console.log('\n3. CLI entry point verification');
const cliExists = fs.existsSync('../steps/detect-stadion-changes.js');
console.log(`   CLI exists: ${cliExists ? 'PASS' : 'FAIL'}`);

// Overall result
console.log('\n=== Overall Result ===');
if (hasRequiredTables && hasRequiredExports && cliExists) {
  console.log('ALL CHECKS PASSED');
  process.exit(0);
} else {
  console.log('SOME CHECKS FAILED');
  process.exit(1);
}
