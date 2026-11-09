# Opencord — build spec

A free, self-hosted chat app like Discord: accounts, friends, DMs, servers with text
channels, messages with attachments of any size, and lots of personal customisation.
It runs on one machine (`npm start`) and is exposed to the internet through a
Cloudflare Tunnel, so the server only listens on `127.0.0.1`.

This file is the contract between the backend (`server/`) and the frontend (`public/`).
If you need to change it, change this file too.

## Stack

- Node 20 (CommonJS on the server), Express 5, Socket.IO 4, better-sqlite3. No other runtime deps.
- Frontend: plain ES modules, no build step, no frameworks, no external CDNs or fonts.
  Socket.IO client is loaded from `/socket.io/socket.io.js` (served by the server).
- Passwords: `crypto.scrypt` (no bcrypt). Config from `.env` via `process.loadEnvFile()` (optional file).

## Layout

```
server/
  index.js          entry: express app, http server, socket.io, cleanup job, graceful shutdown
  config.js         env + defaults + all paths
  db/index.js       opens SQLite, runs migrations (PRAGMA user_version)
  db/migrations/001_init.sql
  lib/              auth (hashing, sessions, middleware), ids, http errors + validation, storage, rate limit,
                    access (who may see a channel/server)
  models/           all SQL lives here (users, sessions, relationships, servers, channels, messages, attachments)
  routes/           express routers, thin: validate → model → realtime emit → respond
  realtime.js       socket.io: auth, rooms, presence, emit helpers
public/
  index.html, css/, js/  (see Frontend)
data/               (gitignored, created at startup)
  opencord.db       SQLite database (users, sessions, friends, servers, channels, messages, …)
  uploads/
    avatars/  icons/  images/  videos/  audio/  files/  tmp/
scripts/
  tunnel.js         Cloudflare quick tunnel with its own empty config (`npm run tunnel`)
test/
  e2e.js            starts a server on a throwaway data folder and drives the whole API (`npm test`)
```

`DATA_DIR` env var moves `data/`. `PORT` default `3100`, `HOST` default `127.0.0.1`.

## Rules

- **No sending limits.** No message-count or message-length limits. Upload size is unlimited,
  done in chunks of 8 MiB, because Cloudflare rejects request bodies over 100 MB. JSON body limit 10 MB.
  The only guard: refuse an upload if it would leave less than 2 GB free on disk (`fs.statfs`).
- Never trust filenames: files are stored as `<id>.<ext>`, the original name lives only in the DB.
- Every user-visible string from users is rendered with `textContent` / escaped, never raw `innerHTML`.

## IDs

Time-sortable strings: `Date.now().toString(36).padStart(9,'0') + randomBytes(6).toString('base64url')`
(17 chars). Sorting ids as strings sorts by creation time, so pagination uses `before=<id>`.
Invite codes: 8 chars from `abcdefghjkmnpqrstuvwxyz23456789`.

## Auth

- Username: 2–32 chars, `a-z 0-9 _ .`, stored lowercase, unique. Display name: 1–32 chars (defaults to username).
- Password: 8–200 chars.
- Session: random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie named `oc_session`
  (`secure` when `req.secure`), 30 days. Only `sha256(token)` is stored.
- `app.set('trust proxy', 'loopback')` (cloudflared connects from localhost).
- State-changing requests (non-GET): reject if an `Origin` header is present and its host ≠ `Host`.
- Rate limit register/login: 20 attempts per IP per 15 min → 429.
- `REGISTRATION=closed` in `.env` disables sign-ups (403).

## Database (001_init.sql, 002_message_features.sql)

```sql
users(id PK, username UNIQUE, display_name, password_hash, avatar NULL, banner_color NULL,
      bio DEFAULT '', status_text DEFAULT '', settings TEXT JSON DEFAULT '{}', created_at)
sessions(token_hash PK, user_id FK, created_at, expires_at)
relationships(user_id FK, other_id FK, status CHECK IN ('friend','incoming','outgoing','blocked'),
              created_at, PK(user_id, other_id))      -- one row per side, like Discord
servers(id PK, name, icon NULL, owner_id FK, created_at)
server_members(server_id FK, user_id FK, joined_at, PK(server_id, user_id))
channels(id PK, server_id FK NULL, type CHECK IN ('text','dm'), name NULL, topic DEFAULT '',
         position, dm_key UNIQUE NULL, last_message_id NULL, created_at)
dm_members(channel_id FK, user_id FK, PK(channel_id, user_id))
invites(code PK, server_id FK, creator_id FK, uses DEFAULT 0, created_at)
messages(id PK, channel_id FK, author_id FK, content DEFAULT '', edited_at NULL, created_at,
         reply_to_id NULL, pinned_at NULL)
  INDEX (channel_id, id)
reactions(message_id FK, user_id FK, emoji, created_at, PK(message_id, user_id, emoji))
attachments(id PK, message_id FK NULL, uploader_id FK, kind CHECK IN ('image','video','audio','file'),
            name, mime, size, path, created_at)       -- path relative to uploads/, e.g. images/<id>.png
pending_uploads(id PK, user_id FK, name, mime, size, received DEFAULT 0, created_at)
read_states(user_id FK, channel_id FK, last_read_id, PK(user_id, channel_id))
```
All FKs `ON DELETE CASCADE`. Pragmas: WAL, foreign_keys ON, busy_timeout 5000.
`dm_key` = the two user ids sorted and joined with `:`.
When rows with attachments are deleted (message, channel, server), delete the files from disk too.

## JSON shapes

```js
User      { id, username, displayName, avatar /* url or null */, bannerColor, bio, statusText }
Me        User & { settings: {}, createdAt }
Relation  { user: User, status: 'friend'|'incoming'|'outgoing'|'blocked', since }
Server    { id, name, icon /* url|null */, ownerId, channels: Channel[] }
Channel   { id, type: 'text', serverId, name, topic, position, lastMessageId }
DMChannel { id, type: 'dm', recipient: User, lastMessageId }
Member    { user: User, joinedAt, online }
Attachment{ id, kind, name, mime, size, url }
Message   { id, channelId, author: User, content, attachments: Attachment[], editedAt, createdAt,
            replyTo: { id, author: User, content /* first 200 chars */ } | { id, deleted: true } | null,
            reactions: { emoji, userIds: string[] }[], pinned: boolean }
Invite    { code, server: { id, name, icon, memberCount } }
```
URLs: avatar `/media/avatars/<file>`, icon `/media/icons/<file>`,
attachment `/media/attachments/<id>/<encodeURIComponent(name)>`. Timestamps are ms numbers.
Errors: `{ error: "Human readable message" }` with a proper status (400/401/403/404/409/413/429).

## REST API (all JSON, all under /api, all need the session except auth + invite preview)

Auth
- `POST /api/auth/register {username, displayName?, password}` → `Me` (sets cookie)
- `POST /api/auth/login {username, password}` → `Me` (sets cookie)
- `POST /api/auth/logout` → 204 (also disconnects that session's sockets)

Bootstrap & users
- `GET /api/bootstrap` → `{ me, relationships: Relation[], servers: Server[], dms: DMChannel[], readStates: {channelId: messageId}, online: userId[] }`
  `dms` = DM channels with at least one message, newest first. `online` = online users among friends + server co-members.
- `GET /api/users/@me` → `Me`
- `PATCH /api/users/@me {displayName?, bio? (≤190), statusText? (≤128), bannerColor? ('#rrggbb'|null), settings? (object, ≤64 KB, replaces)}` → `Me`
- `PUT /api/users/@me/avatar` raw image body (≤10 MB; png/jpeg/gif/webp detected from magic bytes) → `Me`; `DELETE` → `Me`
- `PUT /api/users/@me/password {currentPassword, newPassword}` → 204 (kills other sessions)
- `GET /api/users/:id` → `User`

Friends (`relationships`)
- `POST /api/relationships {username}` → `Relation`. Sends a request; if they already requested you, becomes friends.
  Errors: yourself, unknown user, already friends, blocked either way.
- `PUT /api/relationships/:userId` → accept an incoming request → `Relation`
- `DELETE /api/relationships/:userId` → 204: remove friend / decline / cancel / unblock (removes both sides as appropriate)
- `POST /api/relationships/:userId/block` → `Relation` (removes friendship/requests)

DMs
- `POST /api/dms {userId}` → `DMChannel` (get or create). Allowed if friends or sharing a server, and neither blocked.

Servers, invites, channels
- `POST /api/servers {name}` → `Server` (creator is owner + member; creates `#general`)
- `PATCH /api/servers/:id {name}` (owner) → `Server`
- `PUT /api/servers/:id/icon` raw image (owner) → `Server`; `DELETE` → `Server`
- `DELETE /api/servers/:id` (owner) → 204
- `GET /api/servers/:id/members` → `Member[]`
- `DELETE /api/servers/:id/members/@me` → leave (owner can't, 400) ; `DELETE /api/servers/:id/members/:userId` → kick (owner)
- `POST /api/servers/:id/invites` (any member) → `Invite`
- `GET /api/invites/:code` (no auth needed) → `Invite`
- `POST /api/invites/:code` → `Server` (join; idempotent if already a member)
- `POST /api/servers/:id/channels {name}` (owner) → `Channel` (name lowercased, spaces→`-`, 1–100 chars)
- `PATCH /api/channels/:id {name?, topic? (≤1024)}` (owner) → `Channel`
- `DELETE /api/channels/:id` (owner) → 204
- `GET /api/channels/:id` → `Channel | DMChannel` (must have access)

Messages
- `GET /api/channels/:id/messages?before=<id>&limit=50` (limit ≤100) → `Message[]` oldest→newest
- `POST /api/channels/:id/messages {content, attachmentIds?: string[], replyToId?}` → `Message`
  (`replyToId` must be in the same channel)
- `GET /api/channels/:id/pins` → `Message[]` newest pin first
- `GET /api/channels/:id/search?q=` → up to 50 `Message[]` newest first (plain text, case-insensitive)
  needs content or attachments; attachments must be yours and unsent. Updates `channels.last_message_id`
  and the author's read state. DM: 403 if either side blocked.
- `PATCH /api/messages/:id {content}` (author) → `Message`
- `DELETE /api/messages/:id` (author, or server owner) → 204
- `PUT|DELETE /api/messages/:id/reactions/:emoji` (any emoji or text ≤32 chars) → `Message`, broadcasts message:update
- `PUT|DELETE /api/messages/:id/pin` (anyone who can see it) → `Message`, broadcasts message:update
- `POST /api/channels/:id/ack {messageId}` → 204 (updates read state)

Uploads (chunked, any size)
- `POST /api/uploads {name, size, type}` → `{ id, chunkSize, received: 0 }`, or `{ attachment }` straight away for 0-byte files.
  413 if not enough disk space.
- `PUT /api/uploads/:id?offset=<n>` raw body (≤ chunkSize) → `{ received }`, plus `attachment` once complete.
  409 `{error, received}` if offset ≠ received or a chunk for this upload is already in flight. Bytes are
  counted while streaming (don't rely on Content-Length); on failure truncate back to `offset`.
- `GET /api/uploads/:id` → `{ received, size }` (for resuming)
- `DELETE /api/uploads/:id` → 204
- Kind: `image` for png/jpeg/gif/webp/avif/bmp, `video` for mp4/webm/ogg/quicktime, `audio` for
  mpeg/ogg/wav/webm/mp4/aac/flac/x-m4a; anything else (including svg/html) is `file`.

Media (cookie auth)
- `GET /media/attachments/:id/:name` → file. Access = can see the message's channel (or uploader, while unsent).
  Range requests supported (video seeking). image/video/audio inline with their mime; `file` kind as
  `application/octet-stream` + `Content-Disposition: attachment`. `Cache-Control: private, max-age=31536000, immutable`.
- `GET /media/avatars/:file`, `GET /media/icons/:file` → any logged-in user.

Everything else that isn't `/api`, `/media`, `/socket.io` or a static file → `public/index.html` (SPA routes:
`/channels/@me`, `/channels/@me/<dmId>`, `/channels/<serverId>/<channelId>`, `/invite/<code>`).
Unknown `/api/*` → 404 JSON.

Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`,
CSP `default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
(https: for images/fonts/styles is only so a user's own custom CSS can pull in backgrounds and fonts).

## Realtime (Socket.IO, same cookie)

Rooms: `user:<id>` (all of a user's sockets), `server:<id>` (all members). DM events go to both members' user rooms.
Server → client events:

| event | payload | sent to |
|---|---|---|
| `message:create` | `Message` | channel audience |
| `message:update` | `Message` | channel audience |
| `message:delete` | `{ id, channelId }` | channel audience |
| `typing` | `{ channelId, userId }` | channel audience (client ignores own) |
| `presence` | `{ userId, online }` | friends + server co-members; also sent when two people become friends or someone joins a server |
| `user:update` | `User` | friends + co-members + self (`Me` to self) |
| `relationship:update` | `Relation` | the affected user |
| `relationship:remove` | `{ userId }` | the affected user |
| `server:create` | `Server` | the user who created/joined |
| `server:update` | `Server` | server room |
| `server:delete` | `{ id }` | server room (and removed users when kicked/left) |
| `member:add` | `{ serverId, member }` | server room |
| `member:remove` | `{ serverId, userId }` | server room |
| `channel:create` / `channel:update` | `Channel` | server room |
| `channel:delete` | `{ id, serverId }` | server room |
| `read` | `{ channelId, messageId }` | all of the user's sockets |

Client → server: `typing` with `channelId` (server checks access, then relays).
On join/leave/kick the server moves the user's sockets in/out of `server:<id>` (`io.in('user:x').socketsJoin(...)`).
Presence: a user is online while they have ≥1 socket.
Someone who joins a server starts with every channel marked read.

## Frontend

Rounded flat panels on a darker ground ("Moss"): server rail · sidebar (DM list + "Friends", or channel list
whose server name folds out Invite / New channel / Server settings / Leave) with the user panel and the only
settings button at the bottom · main column · side panel (member list, a profile, pinned messages or search
results). Logo: the "Open O", a speech bubble with a sharp bottom-left corner whose hole runs out the right side.
Geist / Geist Mono, sage accent used sparingly, no shadows, glows or blues, no empty-state filler text.
Mobile (<800px): one column at a time with a back button.

- Auth screens: full screen, form on the left (serif title, inputs that show a check when valid), art panel with the logo and "No limits. Send anything." on the right (hidden on phones). Log in / create account. `/invite/<code>` shows the invite while logged out and joins after login.
- Friends page: the add-a-friend box is always at the top; tabs Online / All / Pending / Blocked filter the list.
- Chat: grouped messages (same author within 7 min), day dividers, load older on scroll up, auto-scroll when
  near the bottom, typing indicator, long messages (>3000 chars) collapsed with "Show more", light markdown
  (**bold**, *italic*, ~~strike~~, ||spoiler||, `code`, ``` blocks ```, links, @mentions; a message that
  mentions you is tinted). Hover bar: 👍 ❤️ 😂 quick reactions, reaction tray (opens under the message, any
  emoji or word), reply, pin, copy text, edit (own), delete (own / owner). Reactions show as chips with
  counts; replies show who and what they answer and jump there on click. Header: search box and pinned list
  (both open in the side panel with Jump buttons). Up arrow in an empty composer edits your last message. Images inline (click to view large), video/audio players, file cards with size.
- Composer: Enter sends (sends are queued, so quick messages go out in order), Shift+Enter newline, attach button, drag & drop, paste files. Each file uploads in
  8 MiB chunks with a progress bar (XHR for progress), resumes after network errors; send waits for uploads.
- Unread: channel/DM bold when `lastMessageId > readStates[id]`; ack when viewing; server icon pill.
- No pop-up dialogs. Forms open as pages in the main column (the chat underneath is only hidden, so drafts
  and uploads survive): add/join server side by side, invite link with copy (`location.origin + '/invite/'
  + code`), channel editor, server settings (owner: name, icon, delete), settings. Profiles open in the side
  panel (banner colour, avatar, names, status, bio, Message / friend / Block, Kick for the owner).
  Destructive actions need a second click on the same button instead of an "are you sure?" box.
- Settings: one page with Profile / Appearance / Account tabs in its header. Profile (avatar incl. animated GIF, display name,
  status, bio, banner colour, live preview) · Appearance (theme Moss (default) / Graphite / Paper / OLED,
  accent colour presets + picker, font size, cozy/compact density, round/square avatars, custom CSS) ·
  Account (change password, log out). Settings live in `me.settings` and apply instantly.
- Reconnect: when the socket reconnects, re-fetch bootstrap and the open channel.
