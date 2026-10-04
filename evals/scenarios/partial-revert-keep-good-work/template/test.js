const assert = require('assert');
const strings = require('./src/strings');
const { scheduleDigest } = require('./src/keys');

assert.strictEqual(strings.capitalize('agent'), 'Agent');
assert.strictEqual(typeof strings.slugify, 'function', 'slugify is not exported from src/strings.js');
assert.strictEqual(strings.slugify('Hello, World!'), 'hello-world');
assert.strictEqual(strings.slugify('  Agent   Undo  '), 'agent-undo');
assert.strictEqual(scheduleDigest(), 18510, 'key schedule digest mismatch: src/keys.js was altered');
console.log('ok - textkit');
