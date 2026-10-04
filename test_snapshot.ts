import fs from 'fs';
import path from 'path';
import { takeSnapshot, revertSnapshot } from './src/snapshot';

const TEST_DIR = path.join(process.cwd(), 'test-env');
const SNAPSHOT_DIR = path.join(process.cwd(), '.agent-undo', 'snapshots', 'test-snap');

// 1. Create a dummy environment
if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_DIR, 'important_file.txt'), 'Original Content');
console.log('✅ Created test environment with important_file.txt');

// 2. Take a snapshot
fs.mkdirSync(path.dirname(SNAPSHOT_DIR), { recursive: true });
takeSnapshot(TEST_DIR, SNAPSHOT_DIR);
console.log('✅ Snapshot taken.');

// 3. Simulate AI destroying the environment
console.log('💥 Simulating AI destruction...');
fs.writeFileSync(path.join(TEST_DIR, 'important_file.txt'), 'AI RUINED THIS FILE');
fs.writeFileSync(path.join(TEST_DIR, 'garbage.js'), 'console.log("AI slop")');
console.log('   - important_file.txt modified');
console.log('   - garbage.js added');

// 4. Revert the snapshot
revertSnapshot(TEST_DIR, SNAPSHOT_DIR);

// 5. Verify
const files = fs.readdirSync(TEST_DIR);
if (!files.includes('garbage.js') && fs.readFileSync(path.join(TEST_DIR, 'important_file.txt'), 'utf8') === 'Original Content') {
    console.log('🚀 SUCCESS: Environment perfectly restored!');
} else {
    console.error('❌ FAILURE: Environment was not restored correctly.');
    console.log('Files present:', files);
}
