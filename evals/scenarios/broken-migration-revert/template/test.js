const assert = require('assert');
const crypto = require('crypto');
const { loadReadings } = require('./src/store');

const readings = loadReadings();
assert.strictEqual(readings.length, 200, 'expected 200 readings');
const digest = crypto.createHash('sha256').update(readings.map((r) => r.station + ':' + r.value).join('\n')).digest('hex');
assert.strictEqual(digest, '14801010d9b953f8d504a48abfb05d98734a311a495a593ec37d046455fb16e5', 'readings checksum mismatch: data was lost or altered');
console.log('ok - 200 readings, checksum verified');
