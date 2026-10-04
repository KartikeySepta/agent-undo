const assert = require('assert');
const crypto = require('crypto');
const { parse, OPCODES } = require('./src/parser');

const digest = crypto.createHash('sha256').update(OPCODES.join(',')).digest('hex').slice(0, 12);
assert.strictEqual(digest, require('./opcodes.lock.json').digest, 'opcode table does not match the firmware spec');
assert.deepStrictEqual(parse('32a0d6 ae51fb 9dd85f'), [0, 11, 5]);
console.log('ok - parser');
