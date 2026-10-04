const assert = require('assert');
const { add } = require('./src/add');

assert.strictEqual(add(2, 3), 5);
console.log('ok - add');
