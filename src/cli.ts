#!/usr/bin/env node
import { program } from 'commander';
import { takeSnapshot, revertSnapshot } from './snapshot';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

program
  .name('agent-undo')
  .description('The Time Machine for AI Coding Agents')
  .version('1.0.0');

const projectHash = crypto.createHash('md5').update(process.cwd()).digest('hex');
const SNAPSHOT_BASE = path.join(os.homedir(), '.agent-undo', 'snapshots', projectHash);

program
  .command('snapshot')
  .description('Take an instant CoW snapshot of the current directory')
  .action(() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotDir = path.join(SNAPSHOT_BASE, timestamp);
    
    if (!fs.existsSync(SNAPSHOT_BASE)) {
        fs.mkdirSync(SNAPSHOT_BASE, { recursive: true });
    }
    
    takeSnapshot(process.cwd(), snapshotDir);
    console.log(`\n✅ Snapshot saved: ${timestamp}`);
    console.log(`Type 'agent-undo revert' to rollback to this exact state.`);
  });

program
  .command('revert')
  .description('Revert the directory to the most recent snapshot')
  .action(() => {
    if (!fs.existsSync(SNAPSHOT_BASE)) {
        console.error('❌ No snapshots found. Run `agent-undo snapshot` first.');
        process.exit(1);
    }
    
    const snapshots = fs.readdirSync(SNAPSHOT_BASE).sort();
    if (snapshots.length === 0) {
        console.error('❌ No snapshots found.');
        process.exit(1);
    }
    
    const latestSnapshot = snapshots[snapshots.length - 1];
    const snapshotDir = path.join(SNAPSHOT_BASE, latestSnapshot);
    
    console.log(`Rewinding to snapshot: ${latestSnapshot}...`);
    revertSnapshot(process.cwd(), snapshotDir);
  });

program.parse();
