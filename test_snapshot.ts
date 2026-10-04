import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { takeSnapshot, revertSnapshot, diffSnapshot, listSnapshots } from './src/snapshot';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-undo-'));
const f = (p: string) => path.join(dir, p);
fs.mkdirSync(f('.git')); fs.writeFileSync(f('.git/HEAD'), 'ref');
fs.mkdirSync(f('node_modules/x/.git'), { recursive: true }); fs.writeFileSync(f('node_modules/x/.git/HEAD'), 'nested');
fs.writeFileSync(f('important.txt'), 'Original');

const snap = takeSnapshot(dir, { name: 'base' });
fs.writeFileSync(f('important.txt'), 'RUINED');
fs.writeFileSync(f('garbage.js'), 'slop');
fs.rmSync(f('node_modules'), { recursive: true });

const d = diffSnapshot(dir);
assert.deepStrictEqual([d.added, d.modified, d.deleted], [['garbage.js'], ['important.txt'], [path.join('node_modules', 'x', '.git', 'HEAD')]]);

const { backup } = revertSnapshot(dir, 'base');
assert.strictEqual(fs.readFileSync(f('important.txt'), 'utf8'), 'Original');
assert(!fs.existsSync(f('garbage.js')));
assert.strictEqual(fs.readFileSync(f('node_modules/x/.git/HEAD'), 'utf8'), 'nested');
assert.strictEqual(fs.readFileSync(f('.git/HEAD'), 'utf8'), 'ref');

revertSnapshot(dir, backup.id); // a revert can be undone
assert.strictEqual(fs.readFileSync(f('important.txt'), 'utf8'), 'RUINED');
assert(fs.existsSync(f('garbage.js')));

assert.throws(() => takeSnapshot(os.homedir()), /Refusing/);
console.log(`🚀 SUCCESS (clone mode: ${snap.mode}, ${listSnapshots(dir).length} snapshots)`);
fs.rmSync(path.join(os.homedir(), '.agent-undo', 'snapshots', require('crypto').createHash('md5').update(fs.realpathSync(dir) === dir ? dir : dir).digest('hex')), { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
