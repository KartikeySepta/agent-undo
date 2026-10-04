// Loads station readings from data/readings.json (schema v1).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'readings.json');

function loadReadings() {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return doc.readings;
}

module.exports = { loadReadings };
