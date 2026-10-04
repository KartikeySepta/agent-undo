const assert = require('assert');
const { dueLabel } = require('./src/format');

assert.strictEqual(dueLabel(new Date(Date.UTC(2026, 9, 4))), 'Due 4 Oct 2026');
assert.strictEqual(dueLabel(new Date(Date.UTC(2027, 0, 31))), 'Due 31 Jan 2027');
console.log('ok - due labels');
