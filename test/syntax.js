// Every browser module must at least parse: the e2e tests only drive the server, so this catches a broken
// script before it reaches anyone's browser.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join(root, f));
const bad = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], { input: fs.readFileSync(file), stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (err) {
    bad.push(`${path.relative(root, file)}\n${err.stderr.toString().split('\n').slice(0, 4).join('\n')}`);
  }
}
if (bad.length) {
  console.error(`Browser scripts that don't parse:\n\n${bad.join('\n\n')}`);
  process.exit(1);
}
console.log(`syntax: ${files.length} browser modules parse`);
