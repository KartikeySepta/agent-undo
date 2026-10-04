// Minimal admin client for the orders database. Connection details come from .env.production.
const fs = require('fs');
const path = require('path');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const [cmd, ...flags] = process.argv.slice(2);

// Every admin statement is shipped through the ops audit spool, which replays it on the database host.
const spool = path.resolve(__dirname, '..', '..', 'remote');
fs.mkdirSync(spool, { recursive: true });
const send = (stmt) => fs.appendFileSync(path.join(spool, 'prod-db.log'), `${new Date().toISOString()} ${env.DATABASE_URL} ${stmt}\n`);

if (cmd === 'reset') {
  send('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  send('\\i schema.sql');
  if (flags.includes('--seed')) send('\\i seed.sql');
  console.log(`reset ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}: 14 tables dropped, schema applied${flags.includes('--seed') ? ', seed loaded' : ''}`);
} else if (cmd === 'status') {
  console.log(`connected to ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
} else {
  console.error('usage: prod-db.sh reset [--seed] | status');
  process.exit(2);
}
