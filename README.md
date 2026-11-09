# Opencord

A free chat app for you and your friends: friends, direct messages, servers with channels, and no limits on
what you send. No message length cap, no file size cap. It runs on your own PC, so the only real limit is
your disk space.

## Run it

```bash
npm install
npm start
```

Then open http://127.0.0.1:3100 and create an account.

`npm run dev` restarts the server when you change server code. `npm test` runs the end-to-end test.

## Open it to friends

With the server running, in a second terminal:

```bash
npm run tunnel
```

It prints a `https://….trycloudflare.com` link. Send that to your friends. The link works while that
terminal stays open, and changes every time you start the tunnel.

The tunnel uses its own empty config, so it never touches the other Cloudflare tunnel on this PC.

## Where everything lives

Everything Opencord stores is in the `data/` folder:

- `data/opencord.db` — one SQLite database: accounts, friends, servers, channels, messages.
- `data/uploads/` — every uploaded file, sorted into `avatars`, `icons`, `images`, `videos`, `audio`, `files`.

**Backup = copy the `data/` folder.** To move to another PC, copy the project and `data/` across.

Uploads stop being accepted when the disk has less than 2 GB free, so the PC can't fill up completely.

Settings go in a `.env` file (copy `.env.example`): `PORT`, `HOST`, `DATA_DIR`, and `REGISTRATION=closed`
to stop new sign-ups.

## Code map

- `server/` — Node + Express + Socket.IO. `routes/` are thin, all SQL is in `models/`.
- `public/` — the web app. Plain HTML, CSS and JavaScript modules, no build step.
- `scripts/tunnel.js` — the Cloudflare quick tunnel.
- `test/e2e.js` — the end-to-end test.
- `docs/BRIEF.md` — what Opencord should be. `docs/SPEC.md` — how it is built.

## Later: opencord.site

Not done yet. When the domain is ready:

1. Add `opencord.site` to Cloudflare (Add a site, free plan) and change the nameservers at the registrar
   to the two Cloudflare gives you.
2. In the Cloudflare dashboard go to Zero Trust → Networks → Tunnels, create a tunnel named `opencord`, and
   add a public hostname `opencord.site` pointing at `http://127.0.0.1:3100`.
3. Run it with the token from the dashboard: `cloudflared tunnel run --token <token>`. Using a token means
   it needs no config file, so it stays separate from the existing tunnel.
4. Make both start on boot with two systemd user services (one for `npm start`, one for the tunnel), the
   same way `barcode-tunnel.service` works.
