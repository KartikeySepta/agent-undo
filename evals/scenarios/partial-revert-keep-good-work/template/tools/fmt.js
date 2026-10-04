#!/usr/bin/env node
// House formatter for src/*.js: trims trailing whitespace, ends files with one newline,
// and compacts multi-line array literals onto a single line.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src');
const MAX_INLINE = 8;

for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const file = path.join(dir, name);
  const before = fs.readFileSync(file, 'utf8');
  let out = before.replace(/[ \t]+$/gm, '');
  out = out.replace(/\[\n([\s\S]*?)\n\s*\]/g, (_, inner) => {
    const items = inner.split(',').map((s) => s.trim()).filter(Boolean);
    return '[' + items.slice(0, MAX_INLINE).join(', ') + ']';
  });
  out = out.replace(/\n*$/, '\n');
  if (out !== before) {
    fs.writeFileSync(file, out);
    console.log('formatted', path.join('src', name));
  }
}
