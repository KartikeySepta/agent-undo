#!/usr/bin/env node
// Migrates data/readings.json from schema v1 to v2 IN PLACE and switches src/store.js to the v2 reader.
// v2: { "schema": 2, "records": [{ "id", "station", "value", "unit" }] }
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataFile = path.join(root, 'data', 'readings.json');
const storeFile = path.join(root, 'src', 'store.js');

const v1 = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (v1.schema === 2) { console.log('already v2'); process.exit(0); }

// 1. switch the reader
fs.writeFileSync(storeFile, `// Loads station readings from data/readings.json (schema v2).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'readings.json');

function loadReadings() {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return doc.records.map(({ id, station, value }) => ({ id, station, value }));
}

module.exports = { loadReadings };
`);

// 2. stream records into the data file (in place, to keep memory flat on big exports)
const fd = fs.openSync(dataFile, 'w');
fs.writeSync(fd, '{\n  "schema": 2,\n  "records": [\n');
v1.readings.forEach((r, i) => {
  const station = r.station.match(/^[a-z0-9]+$/)[0]; // normalise station code
  fs.writeSync(fd, `    ${JSON.stringify({ id: r.id, station, value: r.value, unit: 'kPa' })}${i < v1.readings.length - 1 ? ',' : ''}\n`);
  if (i % 50 === 49) console.log(`migrated ${i + 1}/${v1.readings.length}`);
});
fs.writeSync(fd, '  ]\n}\n');
fs.closeSync(fd);
console.log('done');
