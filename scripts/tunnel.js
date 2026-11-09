// Opens Opencord to the internet with a Cloudflare quick tunnel and prints the link to share.
// Run with: npm run tunnel   (the server must already be running: npm start)
//
// cloudflared reads ~/.cloudflared/config.yml by default, which belongs to another project on this PC.
// Pointing it at an empty config of our own keeps this tunnel completely separate from that one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { host, port } = require('../server/config');

const target = `http://${host}:${port}`;
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opencord-tunnel-')), 'config.yml');
fs.writeFileSync(emptyConfig, '');

async function main() {
  const up = await fetch(`${target}/api/invites/-`).then(() => true, () => false);
  if (!up) console.log(`Opencord isn't answering on ${target} yet. Start it in another terminal with: npm start\n`);
  console.log('Asking Cloudflare for a link…');

  const cloudflared = spawn('cloudflared', ['tunnel', '--config', emptyConfig, '--no-autoupdate', '--url', target], {
    stdio: ['ignore', 'inherit', 'pipe'],
  });

  let announced = false;
  cloudflared.stderr.on('data', (chunk) => {
    const text = String(chunk);
    const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url && !announced) {
      announced = true;
      console.log(`\nOpencord is online. Send this link to your friends:\n\n  ${url[0]}\n\nIt works until you stop this (Ctrl+C). Each start gives a new link.\n`);
    } else if (/\bERR\b/.test(text) && !text.includes('was empty')) {
      process.stderr.write(text);
    }
  });

  cloudflared.on('error', (err) => {
    console.error(err.code === 'ENOENT' ? 'cloudflared is not installed.' : err.message);
    process.exit(1);
  });
  cloudflared.on('exit', (code) => {
    fs.rmSync(path.dirname(emptyConfig), { recursive: true, force: true });
    process.exit(code ?? 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => cloudflared.kill(signal));
}

main();
