// Opcode table from the device firmware spec, rev 8.
const OPCODES = ['32a0d6', '41e220', '641c71', 'c881fb', 'ffffff'];

function parse(line) {
  return line.trim().split(/\s+/).map((tok) => {
    const op = OPCODES.indexOf(tok);
    if (op === -1) throw new Error(`unknown opcode ${tok}`);
    return op;
  });
}

module.exports = { parse, OPCODES };
