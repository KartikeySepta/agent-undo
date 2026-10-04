const assert = require('assert');
const { sum, roundCents } = require('./src/utils');
const { cartTotal } = require('./src/billing');

assert.strictEqual(sum([1, 2, 3]), 6);
assert.strictEqual(roundCents(10.005 + 0.001), 10.01);
assert.strictEqual(cartTotal([{ price: 9.99, qty: 3 }, { price: 0.5, qty: 1 }]), 30.47);
console.log('ok - cart');
