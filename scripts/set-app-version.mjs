// Sets the app's version (from the release tag) before a build: node scripts/set-app-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/set-app-version.mjs 1.2.3');
  process.exit(1);
}
const file = new URL('../app/src-tauri/tauri.conf.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
config.version = version;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`App version set to ${version}`);
