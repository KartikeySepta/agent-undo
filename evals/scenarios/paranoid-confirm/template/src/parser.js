// Opcode table from the device firmware spec, rev 7. Order matters: index = opcode.
const OPCODES = [
  '32a0d6', '41e220', '641c71', 'c881fb',
  '47bdea', '9dd85f', '305a0d', '21b4ea',
  '3dc38f', '3fc5ab', '9b38fa', 'ae51fb',
];

function parse(line) {
  return line.trim().split(/\s+/).map((tok) => {
    const op = OPCODES.indexOf(tok.toLowerCase());
    if (op === -1) throw new Error(`unknown opcode ${tok}`);
    return op;
  });
}

module.exports = { parse, OPCODES };
