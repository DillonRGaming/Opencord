# Opencord: brief for the next build

Read this whole file first, then `docs/SPEC.md` (the detailed technical contract: database, API,
realtime events, JSON shapes). This brief covers what the owner wants, how they want it, and what
needs doing. Where the two disagree, this brief wins; update SPEC.md to match.

---

## 1. What Opencord is

A free chat app like Discord, built and hosted by the owner (Dillon) on his own Linux PC.

- **No sending limits.** This is the main selling point. Nothing is paywalled or capped: no message
  length cap, no upload size cap, no "Nitro" features. Things Discord charges for (big uploads,
  animated avatars, profile banners/colours, themes) are free and on by default.
- **Loads of customising.** Themes, accent colours, font size, density, avatar shape, custom CSS,
  profile banner colour, bio, status.
- **Works like Discord.** Make an account, add friends, DM friends, create servers, join servers by
  invite link, text channels, real-time messages, images/videos/audio/files, online status.
- **Everything stored on this PC.** One SQLite database for all the data (users, friends, servers,
  messages…) and clean folders for uploaded media, sorted by type.
- **Reached through Cloudflare Tunnel.** The Node server runs on this PC; cloudflared exposes it to
  the internet. The server itself only listens on `127.0.0.1`.
- **Domain later.** The owner is buying `opencord.site` from Vercel. Setting that up is a later step
  (see section 8). Until then a Cloudflare quick tunnel (random `*.trycloudflare.com` URL) is fine.

---

## 2. How the owner wants it built

These matter to him as much as the features.

1. **Cleanly. He asked for this several times.** Clear folder structure, small focused files, no dead
   code, no leftover copies, no `- Copy (2)` folders, no mystery files in the root.
2. **One folder, one source of truth.** He has a long history of losing track of which copy of a
   project is newest. This repo (`/home/dillon/Documents/Opencord`) is the only copy. Use git for
   history and experiments, never duplicated folders.
3. **Git from the start, pushed to GitHub.** Repo: `github.com/DillonRGaming/Opencord` (private).
   Commit in sensible steps with clear messages. Push when a working milestone is reached.
4. **Keep `NOW.md` up to date.** Three lines: what works, what's next, what's broken. He reads it
   when he comes back to the project after a break. Update it at the end of every session.
5. **Actually finish things.** He tends to start big and abandon. Prefer a smaller feature set that
   fully works over a huge half-working one. Every feature that ships must work end to end.
6. **Test it for real.** Run the server, hit the API, open it in a browser, upload a big file through
   the tunnel. Don't report something as working without having seen it work.
7. **Its own look.** Discord-like layout and behaviour, but its own colours and identity. Not a
   pixel copy of Discord, and none of Discord's branding or assets.
8. **Plain language when explaining to him.** He's a capable self-taught developer (he has built
   voxel games, a Scratch-style block editor, Electron apps, chat apps), but keep explanations short
   and concrete.

---

## 3. Current state of the repo (as of 2026-11-09)

- The repo was started from an old project (GraniteChatter). **The owner and Claude decided to throw
  that code away and rebuild from scratch.** The old `server/`, `public/`, `rules.txt` and
  `node_modules/` have been deleted from the working tree (`git rm`, staged, not yet committed).
- `docs/SPEC.md`: the full technical spec for the rebuild. Use it.
- `package.json` and `package-lock.json` are still the OLD ones (name `opencord`, but old deps:
  bcrypt, cors, jsonwebtoken). Replace them: the new deps are only `express@5`, `socket.io@4`,
  `better-sqlite3`.
- `.gitignore` needs updating to:
  ```
  node_modules/
  data/
  .env
  *.log
  run-html/
  ```
  (`run-html/` is an unrelated VS Code extension folder that got copied in by accident. Leave it
  alone, just keep it ignored. Or move it out of the repo if the owner agrees.)
- `README.md` and `NOW.md` exist but describe the old code. Rewrite both at the end.
- Git history: 2 commits on `main`, already pushed.

---

## 4. Environment facts (important, verified)

- OS: CachyOS (Arch-based Linux), shell `fish`. Node **v20.18.0**, npm 10.8.2.
  `process.loadEnvFile()` exists in this Node version, so no `dotenv` is needed.
- `cloudflared` **2026.10.2 is already installed** at `/usr/bin/cloudflared`.
- **The owner already has a Cloudflare account and a live tunnel for a different project. Do not
  touch it:**
  - `~/.cloudflared/config.yml` belongs to the tunnel `barcode` (api.barcodegames.fun → 127.0.0.1:8787).
  - It runs as the system service `barcode-tunnel.service`.
  - `~/.cloudflared/cert.pem` is the account login for the `barcodegames.fun` zone.
  - Another tunnel named `Website` also exists in the account.
  - **Never edit `~/.cloudflared/config.yml`, never stop or restart that service, never overwrite
    `cert.pem`.**
  - A quick tunnel picks up `~/.cloudflared/config.yml` by default, so Opencord's tunnel must be run
    with its own (empty) config, e.g. `cloudflared tunnel --config <path-to-empty-file> --url http://127.0.0.1:3100`.
    Verify this actually works and doesn't touch the barcode tunnel.
- **Ports:** other projects of his use 3001, 8000 and 8787. Opencord uses **3100**.
- **Disk:** `/home` has about **29 GB free** (86% used). Since uploads are unlimited, the server must
  refuse an upload that would leave less than 2 GB free, and the owner should be told disk space is
  the real limit.
- GitHub CLI `gh` is logged in as `DillonRGaming`.
- Cloudflare limits request bodies to **100 MB** on the free plan. That's why uploads must be chunked
  (8 MiB chunks). A single big POST would fail through the tunnel.

---

## 5. Features: the full list

### Accounts
- [ ] Register: username (2–32 chars, `a-z 0-9 _ .`, unique, stored lowercase), optional display
      name, password (8+ chars).
- [ ] Log in, log out. Session cookie (httpOnly, SameSite=Lax, 30 days); only a hash is stored.
- [ ] Change password (logs out other sessions).
- [ ] Rate limit login/register per IP.
- [ ] Option in `.env` to close sign-ups (`REGISTRATION=closed`).

### Profile & customisation (all free)
- [ ] Avatar upload, including animated GIF. Remove avatar.
- [ ] Display name, status text, bio, banner colour.
- [ ] Profile popout when clicking any name or avatar (banner, avatar, names, status, bio, buttons:
      Message, Add Friend, Kick if you own the server).
- [ ] Appearance settings, applied instantly and saved to the account so they follow you between
      devices:
  - Theme: Dark, Midnight, OLED, Light
  - Accent colour: presets plus a free colour picker (text on accent auto black/white for contrast)
  - Font size slider
  - Message density: cozy / compact
  - Avatar shape: round / rounded-square
  - Custom CSS box

### Friends
- [ ] Send a friend request by username.
- [ ] Accept, decline, cancel requests. If both people request each other, they become friends.
- [ ] Remove friend. Block / unblock (blocking removes the friendship and stops DMs and requests).
- [ ] Friends page with tabs: Online / All / Pending / Blocked / Add Friend.
- [ ] Live online/offline status dots everywhere.

### Direct messages
- [ ] Open a DM with a friend or anyone you share a server with (unless blocked).
- [ ] DM list in the sidebar, newest first, unread shown in bold.
- [ ] A DM appears for the other person as soon as the first message arrives.

### Servers
- [ ] Create a server (you become owner; it gets a `#general` channel).
- [ ] Server icon upload. Rename. Delete (owner only, with confirmation).
- [ ] Invite links: any member can create one. `https://<host>/invite/<code>`, copy button.
- [ ] Join by pasting a link or code, with a preview (name, icon, member count) before joining.
- [ ] Opening an invite link while logged out shows the invite, then joins after login/sign-up.
- [ ] Leave server (owner can't leave, only delete). Owner can kick members.
- [ ] Member list on the right, split Online / Offline.
- [ ] Text channels: owner can create, rename, set topic, delete.

### Messages
- [ ] Real-time send/receive (Socket.IO).
- [ ] Edit and delete your own messages. Server owner can delete any message in their server.
- [ ] History: newest 50 on open, older ones load when scrolling up.
- [ ] Grouping like Discord (same author within a few minutes = no repeated header), day dividers.
- [ ] Light markdown: **bold**, *italic*, ~~strike~~, `inline code`, code blocks, clickable links.
      Always escape user text first. No raw HTML from users, ever.
- [ ] Very long messages collapse with "Show more".
- [ ] Typing indicator ("X is typing…").
- [ ] Unread: bold channels/DMs, a pill on the server icon, marked read when you view the channel.

### Attachments (no size limit)
- [ ] Attach button, drag and drop, paste.
- [ ] Chunked upload (8 MiB chunks), progress bar per file, resumes after a network hiccup. The
      message sends once uploads finish.
- [ ] Images shown inline (click to enlarge), video and audio players (with seeking, so Range
      requests are needed), other files as a download card with name and size.
- [ ] Files are stored as `<random id>.<ext>`, never under the user's filename. Only people who can
      see the channel can download them.
- [ ] Refuse uploads that would leave less than 2 GB free on disk, with a clear error.
- [ ] Clean up abandoned uploads (unsent after 24 h) and their files automatically.

### Works on phones
- [ ] Under 800 px wide: one panel at a time with a back button. Friends will open the tunnel link
      on their phones.

---

## 6. Storage layout (what "cleanly" means here)

```
data/                      gitignored, created on first start (DATA_DIR in .env can move it)
  opencord.db              SQLite: users, sessions, friends, servers, channels, messages, …
  uploads/
    avatars/
    icons/                 server icons
    images/
    videos/
    audio/
    files/                 everything else
    tmp/                   chunked uploads in progress
```

The owner said "a db, one for users, a folder for images, videos, audio files etc." One SQLite
database with a `users` table (plus the other tables) is the clean way to do that: relationships
between users, servers and messages need to live in the same database. Explain this to him in one
line. Deleting a message, channel or server must also delete its files from disk.

---

## 7. Code structure

See SPEC.md "Layout". In short:

```
server/
  index.js            app, http server, socket.io, cleanup job, graceful shutdown
  config.js           env + defaults + every path
  db/index.js         open SQLite (WAL, foreign keys), run migrations via PRAGMA user_version
  db/migrations/001_init.sql
  lib/                auth, ids, errors/validation, storage, rate limit
  models/             ALL SQL lives here
  routes/             thin express routers
  realtime.js         socket.io auth, rooms, presence, emit helpers
public/
  index.html
  css/                variables + themes, layout/components
  js/                 main, api, store, router, realtime, upload, format (markdown), theme, dom
                      helpers, icons, views/ (auth, rail, sidebar, chat, friends, members,
                      settings, serverSettings, modals)
scripts/
  tunnel.js           starts the Cloudflare quick tunnel with an isolated config, prints the URL
docs/
  SPEC.md, BRIEF.md
```

Rules: no build step, no frontend framework, no CDNs or external fonts (it must work offline on the
LAN too), no `innerHTML` with user content, CommonJS on the server, ES modules in the browser.

---

## 8. What needs doing, in order

1. **Reset the project files:** new `package.json` (scripts: `start`, `dev` with `node --watch`,
   `tunnel`), install `express@5 socket.io@4 better-sqlite3`, update `.gitignore`, add `.env.example`
   (`PORT=3100`, `HOST=127.0.0.1`, optional `DATA_DIR`, `REGISTRATION`). Check better-sqlite3 loads
   on Node 20.18. Commit.
2. **Backend** per SPEC.md. Commit.
3. **Frontend** per SPEC.md and section 5. Commit.
4. **Test end to end:**
   - API script: two users, friend request/accept, DM, create server, invite, join, send, edit,
     delete, a 20+ MB chunked upload, a Range request on a video, permission checks (non-member
     can't read a channel or download its files), blocking.
   - Realtime: two socket clients receive each other's messages, typing, presence.
   - Browser: sign up, create a server, chat, upload an image and a video, settings and themes,
     phone width. Take screenshots.
   - Fix everything found. Commit.
5. **Tunnel:** `npm run tunnel` starts a Cloudflare quick tunnel to `127.0.0.1:3100` using an
   isolated empty config (see section 4) and prints the `https://….trycloudflare.com` URL. Test the
   app through it from outside, including websockets and a chunked upload over 100 MB. Confirm
   `barcode-tunnel.service` is still running and untouched afterwards.
6. **Docs:** rewrite `README.md` (what it is, how to run, how to open it to friends, where data
   lives, how to back it up = copy `data/`). Rewrite `NOW.md`. Commit and push to GitHub.
7. **Later, when the owner has bought opencord.site (don't do yet, just document it in README):**
   - Add `opencord.site` to his Cloudflare account (free plan) and change the nameservers in Vercel
     to the two Cloudflare gives. DNS has to be on Cloudflare for a tunnel hostname.
   - Create a named tunnel `opencord` and route `opencord.site` (and maybe `www`) to
     `http://127.0.0.1:3100`. Easiest without touching his existing `cert.pem`: create it in the
     Cloudflare dashboard (Zero Trust → Networks → Tunnels) and run it with
     `cloudflared tunnel run --token <token>`.
   - Make Opencord and its tunnel start on boot (systemd services, like his existing
     `barcode-tunnel.service`), so it stays online without a terminal open.

---

## 9. Out of scope for v1 (good next steps, don't build now)

Voice/video calls, roles & permissions beyond owner/member, reactions, replies, mentions & pings,
notifications, group DMs, emoji/sticker uploads, search, message pinning, mobile app, bots,
end-to-end encryption, federation.

---

## 10. Definition of done

- `npm install && npm start` on a fresh clone works, and `http://127.0.0.1:3100` shows the app.
- Two people on different networks can sign up through the tunnel URL, become friends, DM, make a
  server, invite each other, chat live, and send a 200 MB video that plays with seeking.
- All data is in `data/` exactly as laid out in section 6.
- The barcode tunnel is untouched and still running.
- Code is clean and organised, committed, pushed, and `README.md` + `NOW.md` are current.
- A short plain-language summary for the owner: what works, the tunnel URL, how to start it again,
  and what's next.
