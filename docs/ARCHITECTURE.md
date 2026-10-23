# Boardo: architecture

Last updated: 22 October 2026

This document describes how Boardo is built and how it connects to Elastic. What Boardo does, and why, is in [PRD.md](PRD.md); requirement numbers like R8.15 refer to it.

## 1. Overview

```
 kaiserkhan.com/boardo (static PWA, Hostinger)     kaiserkhan.com/planner (Elastic)
          │  HTTPS + WebSocket                                │ HTTPS (OAuth token, scope "elastic")
          ▼                                                   ▼
 boardo-api.qaisarkhans.workers.dev  ── Worker "boardo-api" ──────────────────────
   ├─ D1 "boardo": users, sessions, email codes, boards, members, invites, OAuth codes, app tokens
   ├─ Durable Object Board (one per board, SQLite): columns, cards, fields, comments, files,
   │    time sessions, logs; per-board rev; hibernating WebSockets for live sync
   ├─ R2 "boardo-files": attachments and thumbnails
   └─ Resend HTTP API: sign-in codes, invites
```

- **The app** is a static Svelte 5 + TypeScript + Vite PWA, served from kaiserkhan.com/boardo (the same Hostinger site as Elastic, uploaded with rsync over SSH). It keeps every board the person belongs to in IndexedDB, works offline and syncs live.
- **Same origin as Elastic.** Both apps are on https://kaiserkhan.com, so everything stored in the browser is named apart: IndexedDB `boardo`, `localStorage` keys `boardo:*`, the `boardo-sync` lock, the `boardo` BroadcastChannel, the service worker scope `/boardo/` and caches `boardo-*`.
- **D1 is the directory.** It holds:
  - who exists;
  - who is in which board, with which role;
  - invites and tokens.

  The Worker checks membership in D1 before passing any request or socket to a board's Durable Object.
- **Each board's Durable Object holds that board's content.** A per-board `rev` sequence drives sync, and boards are fully independent of one another.
- **My cards is computed on the device** from the boards already synced there. There's no server-side join, and it works offline.
- **Elastic** gets the one cross-board server query. `POST /elastic/cards` fans out to the person's board DOs through an RPC, `myCards(userId)`.

### 1.1 Stack and versions

| Part | Choice |
|---|---|
| App | Svelte ^5.57, Vite ^8.3, TypeScript ^6.0 |
| Tests | Vitest ^4.1, fake-indexeddb ^6.2 |
| Server | Cloudflare Workers, D1, Durable Objects (SQLite storage, hibernation API), R2 |
| Tooling | Wrangler ^4.141, @cloudflare/workers-types (Wrangler needs Node 22) |
| Email | Resend HTTP API |
| Hosting | The app on Hostinger at kaiserkhan.com/boardo (`npm run deploy`: tests, build, rsync); the API on Cloudflare (`wrangler deploy`) |

### 1.2 Patterns carried over from Elastic

Boardo copies and adapts proven parts of Elastic ([github.com/qkonline/elastic](https://github.com/qkonline/elastic)). It doesn't share code with it at runtime.

| In Elastic | In Boardo |
|---|---|
| `worker/src/index.ts`: JSON-only POST routes, `Refusal` errors, CORS allow-list echo, Bearer tokens | `worker/src/index.ts` |
| `worker/src/auth.ts`: email codes (`sixDigits()`, `sha256(email\|code)`, 10 min life, 5 tries, 60 s resend wait), hashed session tokens | `worker/src/auth.ts`. Mail goes through one `sendMail(env, to, subject, text, html?)` that calls Resend. Since 22 Oct 2026 this went the other way too: Elastic's accounts are made by email code like Boardo's, and its `worker/src/mail.ts` and hourly `limits` are copied from here |
| `worker/src/account.ts`: a DO with SQLite `records(kind, key, rev, data)`, hibernating sockets, `sendSince` chunks, `put` → `ack{ok, conflicts}` inside `transactionSync`, broadcast, ping auto-response | `worker/src/board.ts` |
| `worker/src/checks.ts`: record validation and caps | `worker/src/checks.ts` |
| `src/lib/db.ts`: IndexedDB with `synced` and `outbox` stores, writes noted in the outbox in the same transaction | `src/lib/db.ts` |
| `src/lib/sync.ts`: leader tab lock, backoff 1, 2, 5, 10, 30 s, outbox batching, one put in flight, serial incoming queue | `src/lib/sync.ts`, with one connection per board |
| `src/lib/merge.ts`: `fields()` three-way merge | Card and column merges |
| `src/lib/sync.test.ts`: fake DO and fake WebSocket, several devices with `vi.resetModules` and separate fake IndexedDBs | Multi-user sync tests |
| Service worker build plugin, update check, keyboard-aware viewport, install prompt, sheet and collapsible components | The app shell |

## 2. Data model

### 2.1 D1 (`worker/migrations/0001_init.sql`)

| Table | Columns |
|---|---|
| `users` | id, email UNIQUE, name, hue, created |
| `sessions` | hash PK, user_id, device, created, used |
| `email_codes` | email PK, hash, tries, sent, expires (one code per address; signing in and signing up are the same step) |
| `boards` | id, name, hue, created_by, created (name and hue mirror the board's own record, for the board list) |
| `members` | board_id, user_id, role (`admin` or `member`), added_at; PK (board_id, user_id) |
| `invites` | id, board_id, email, role, token_hash, invited_by, created, expires, accepted_by |
| `oauth_codes` | code_hash, user_id, client_id, redirect_uri, challenge, scope, expires |
| `app_tokens` | hash PK, id (for listing and revoking), user_id, client_id, scope, label, created, used |
| `passkeys` | id PK (the credential id), user_id, public_key, counter, transports, label (the device), created, used (`0002_passkeys.sql`) |
| `challenges` | id, challenge, user_id, purpose (`add` or `login`), expires: each answered once, within 5 minutes |
| `limits` | key PK, count, start (an hour-long window; rate limiting per email and per IP) |

Sessions, codes, invite tokens, OAuth codes and app tokens are only ever stored as SHA-256 hashes.

### 2.2 Board Durable Object

Records are `(kind, key, rev, data)`. `data: null` means deleted.

| Kind | Fields | Written by |
|---|---|---|
| `board` | name, hue, maxUploadMB (default 30), background (`{hue}`, `{image: file id}` or none) | admins; a new image must be a background file already uploaded to the board |
| `member` | userId, name, hue, role (a mirror of D1, pushed by the Worker) | server |
| `column` | id, name, order | members |
| `field` | id, key (`start`, `end`, `status` for built-ins, null for custom), name, type, options `[{id, label, hue, role?}]`, order | admins |
| `card` | id, columnId, order, title, desc, values `{fieldId: value}`, assignees `[userId]`, done `{userId: ms}`, deps `[cardId]` (the cards it waits on; left out when none), archived, createdBy, created | members |
| `comment` | id, cardId, userId, text, at, editedAt, deleted | members (their own only) |
| `file` | id, cardId (`_board` for a background image), name, mime, size, by, at, thumb (a thumbnail was stored beside it); the bytes are at R2 `<board>/<id>` and `<board>/<id>.thumb` | server, after an upload |
| `session` | id, cardId, userId, start ms, end ms or null, source | server, from Elastic ops |
| `log` | id, cardId or null, userId, at, action, detail `{field, from, to, …}` | server only |

- **Field types:** `text`, `longtext`, `number`, `date`, `datetime`, `dropdown`, `checkbox`, `person`.
- **Status.** Status is a built-in dropdown field. Two of its options carry fixed roles, `in_progress` and `completed`, which automation relies on. Admins can rename those two options but not remove them (R4.3).
- **Order.** Card and column order are fractional numbers, so two people reordering at the same time don't collide.
- **Dates.** A `date` is a `YYYY-MM-DD` calendar date. A `datetime` is ISO 8601 with offset. Logs and sessions use UTC milliseconds.
- **Text.** All text is plain text. Links are detected on display, and no HTML is ever interpreted.

### 2.3 Rules enforced in the Durable Object

- **Permissions.** Every put is checked against the sender's role (PRD section 2.2):
  - members can't write `board`, `field` or `member`;
  - nobody writes `log`, `session` or `file` directly;
  - a comment can only be changed by its author.
- **Logs.** The DO writes log entries itself. It diffs each accepted change, so entries can't be forged (R6.4). Actions:
  - created, archived, restored, deleted (for good);
  - moved (column), renamed, description changed;
  - field changed (from, to);
  - assigned, unassigned;
  - part done, part undone;
  - status changed (by hand or automatic);
  - linked, unlinked (a card it waits on added or removed);
  - comment added;
  - file added, file removed;
  - worked (duration, from Elastic);
  - for the board: created, renamed, columns, fields, members and roles, background changed.
- **Completion** runs after each change (R5.1 to R5.5):
  - when every assignee has a `done` entry and Status isn't `completed`, it sets `completed` and logs it;
  - when a part is undone or an assignee is added to a Completed card, it sets `in_progress`;
  - a manual status change never touches `done`.
- **Time spent** is computed from `session` records, never stored on the card. A running session counts up to now. It's shown in total and per person.

## 3. Sync and offline

- **IndexedDB `boardo`:**
  - `records`, keyed `board:kind:key`;
  - `synced` (the last agreed version, used as the merge base);
  - `outbox`;
  - `meta` (session, board list, revs per board);
  - `uploads` (file blobs queued while offline).
- **One leader tab** (`navigator.locks` lock `boardo-sync`) holds one WebSocket per board: `GET /sync?board=<id>`, with the token as the second subprotocol. Other tabs follow over a BroadcastChannel. The tab in front takes the lead (it steals the lock on opening and on coming to the front), because a browser can put a background tab to sleep while it still holds the lock; the tab it was taken from closes its sockets and follows. On a network that lets requests through but not WebSockets (two that never open, or one held up for 8 s), boards sync over `POST /sync/http {board, m}` instead: the same `hello` and `put` messages, answered by `Board.httpSync` with the replies a socket would get, and a `hello` from the last point reached every 4 s while the app is in front (`src/lib/pollsocket.ts`).
- **Protocol:**
  - `hello{since}` → `changes{recs, more}` chunks, ending with `done`;
  - `put{id, recs:[{kind, key, base, data}]}` → `ack{id, ok, conflicts, rejected}`. An `ok` entry carries `data` when the board stored something other than what was sent (the completion rule moved the status, or someone else's part was kept as it was); `rejected` holds changes the sender wasn't allowed to make, with the board's version, which replaces the local copy;
  - the log entries a change produced go back to the sender as a `changes` message too;
  - accepted changes are broadcast to the board's other sockets.
- **Conflicts.** A put whose `base` rev is stale comes back in `conflicts`. The device then merges field by field with `fields()` against its `synced` base and sends again, so the latest change wins per field (R9.5). Comments, files, sessions and logs are separate records, so they never conflict.
- **Board list.** `POST /boards` returns the person's boards and pending invites. The app asks on open, when it becomes visible, and when a socket reports a membership change.
  - Joining a board opens its socket.
  - Removal closes the socket with code 4003, and the device deletes that board's local data (R9.7).
- **Reconnect.** Backoff steps are 1, 2, 5, 10 and 30 s. The app reconnects at once on `online` and when it becomes visible, and pings every 20 s while visible.
- **Offline attachments** wait in `uploads` and are sent once back online. Files already viewed are cached by the service worker.
- **Scale.** This approach is comfortable up to about 20 boards per person (R11.8). Beyond that, a per-user Durable Object could multiplex boards over one socket.

## 4. Worker API

Everything is POST with a JSON body, except the sync socket and file transfers. The token travels as `Authorization: Bearer`.

**Auth and profile**
- `/auth/code/send {email}`: rate-limited per email and per IP, and silent on unknown emails.
- `/auth/code/verify {email, code}` → `{token, user}`: creates the account on first use.
- `/auth/signout`
- `/me/email/send {email}`, `/me/email/verify {email, code}`: change one's email. A code goes to the new address (refused if another account has it) and only that changes it; every board's member record follows.
- `/me {name?, hue?}`
- `/me/delete`: refused while the person is the last admin of a board.

**Cards**
- `/cards/delete {board, card}`: deletes an archived card for good (an admin, or whoever made it), through the DO's `deleteCard()`: the card, its comments, files and sessions go, the files' bytes are removed from R2, and the log keeps its entries plus a `deleted` one. Devices never delete a card record themselves.

**Passkeys** (`worker/src/passkeys.ts`, `@simplewebauthn/server`, as in Elastic)
- `/auth/passkey/add/start`, `/auth/passkey/add/finish` (signed in): a passkey for this account on this device. The relying party is the page's host (`kaiserkhan.com`), which Elastic shares, so Boardo's passkeys are named `Boardo: <email>` to tell them apart in the device's list.
- `/auth/passkey/login/start`, `/auth/passkey/login/finish` → `{token, user}`: any passkey for the site may answer (discoverable credentials, also offered in the email field's suggestions); one Boardo doesn't know (Elastic's, or removed) gets a message saying so.
- `/me/passkeys`, `/me/passkeys/remove`.

**Boards and members**
- `/boards`, `/boards/create`, `/boards/delete` (admin)
- `/members/role`, `/members/remove` (admin; at least one admin always remains)
- `/invites/create {board, email, role}`: emails `https://kaiserkhan.com/boardo/?invite=<token>` through Resend. (A query string rather than a path, so the static host needs no rewrites.)
- `/invites {board}` (admin): the invites waiting in a board.
- `/invites/accept {token}` or `{id}` (from the invites on Home): the signed-in email must match the invite.
- `/invites/decline {id}`: the invitee turns it down.
- `/invites/revoke`, `/invites/resend`: invites expire after 14 days.

**Sync**
- `GET /sync?board=<id>`: WebSocket upgrade. A bad token or a non-member still gets an upgrade, followed by `{t:'signedout'}` or `{t:'removed'}` and a close, so the app can tell this apart from a network drop.

**Files**
- `PUT /files?board=&card=&name=`: streams the body to R2. It checks:
  - membership;
  - the board's size limit;
  - the type, by extension **and** by the file's first bytes (JPG, PNG, WebP, GIF, PDF, and Office zip and legacy formats).

  It then writes the `file` record and a log entry through the DO.
- `PUT /files?board=&thumb=<file id>`: an image's thumbnail (a JPEG made on the device, at most 480 px), stored next to the original as `<board>/<id>.thumb`; the `file` record gets `thumb: true`.
- `POST /files/links {board, files}` (members): links good for an hour, `{id: {url, thumb?, exp}}`.
- `GET /files/<board>/<id>[/thumb]?exp=&sig=`: a link, opened. Signed with HMAC (`FILE_SIGNING_KEY`), so `<img>` tags and downloads work without a token; this route is the one that skips the origin check, since they send no Origin. Responses send `X-Content-Type-Options: nosniff` and a sandboxing CSP, and non-images send `Content-Disposition: attachment`.
- `POST /files/delete {board, file}`: whoever added it, or an admin. The record goes, with a log entry, and so do the bytes in R2.
- Files added offline wait in IndexedDB (`uploads`) and go once there's a connection.

**Backgrounds and photos**
- `PUT /files?board=&background=1` (admins): a background image, made at most 2400 px on the device. It's stored as a `file` record with `cardId: '_board'` (so it's on no card) and returned, but the board doesn't change: like every other setting it waits for Save, when the device writes `board.background = {image: id}`. The DO accepts a new image id only if it's such a file. Background files no longer in use (replaced, taken away, or uploaded and never saved) are swept, record and bytes, on each board write and each new upload. Served by signed link like any file.
- `PUT /me/photo`: a profile photo, a 512 px square made on the device, at R2 `users/<user id>/<photo id>` (D1 `users.photo`, `0003_photos.sql`), mirrored to every board's `member.photo`. `GET /photos/<user id>/<photo id>` serves it without a token: the id is long and random, and the address changes with each new photo, so it's cached for a year. `/me/photo/remove` takes it away.

**Connected apps and Elastic:** `/oauth/approve`, `/oauth/token`, `/apps`, `/apps/revoke`, `/elastic/cards`, `/elastic/ops` (section 5).

**CORS**
- `https://kaiserkhan.com` and the dev origins (`http://localhost:5174` for Boardo, `http://localhost:5173` for Elastic) may call the API. Every other origin is refused.
- Boardo and Elastic share the `https://kaiserkhan.com` origin, so the origin can't tell them apart. The tokens do: a session token (Boardo) is refused on `/elastic/*`, and an app token (scope `elastic`) is accepted only on `/elastic/*`.

**Secrets:** `RESEND_API_KEY` and `FILE_SIGNING_KEY` are Worker secrets. Local values go in the git-ignored `worker/.dev.vars`.

## 5. Elastic connection (OAuth 2.0 authorization code with PKCE)

### 5.1 Connecting

1. In Elastic: Settings → Projects → **Connect Boardo**. Elastic creates a PKCE verifier and challenge (S256) and a `state`, keeps them in `sessionStorage`, then opens:
   `https://kaiserkhan.com/boardo/?connect&client_id=elastic&redirect_uri=https://kaiserkhan.com/planner/&code_challenge=…&code_challenge_method=S256&state=…`
2. Boardo signs the person in if needed, then asks "Connect Elastic?", listing what Elastic may and may never see. The options are **Allow** and **Cancel**.
3. **Allow** calls `/oauth/approve`, which:
   - checks `client_id` and `redirect_uri` against the clients registered in the Worker (`worker/src/oauth.ts`: `https://kaiserkhan.com/planner/`, and `http://localhost:5173/planner/` and `:4173` for development);
   - stores a one-time code, hashed, valid for 5 minutes;
   - answers with `redirect_uri?code=…&state=…` for the app to go to. **Cancel** answers with `redirect_uri?error=access_denied&state=…`.
4. Elastic checks `state` and calls `/oauth/token {code, verifier, client_id, redirect_uri}`. It receives `{access_token, token_type: 'Bearer', scope: 'elastic', user: {email, name}}`.
   - The token is stored hashed in `app_tokens`.
   - It's listed in Boardo → Settings → Connected apps, where it can be removed.
   - It works on `/elastic/*` only, and a session token never works there.
5. Until 23 October 2026 Elastic kept this token on the device (IndexedDB `meta['boardo']`) and called `/elastic/*` with it. Those routes and tokens still work for app versions from before, and a device that has one hands it to its account (section 5.4).

### 5.4 One link per Elastic account (since 23 October 2026)

The link belongs to the Elastic account, so every device signed in to it has Projects (R8.5). Elastic's Worker (`elastic-day-push`) holds it and talks to Boardo's over **service bindings**, which only Workers on the same Cloudflare account can call:

- Elastic binds `BOARDO` to this Worker's `ElasticLink` entrypoint (`worker/src/link.ts`); this Worker binds `ELASTIC` to Elastic's `BoardoHooks` entrypoint.
- Link tokens have scope **`elastic-link`** and carry `ext`, the Elastic account they belong to (`app_tokens.ext`, migration 0004). They work over the binding only; `/elastic/*` takes only `elastic` tokens. One link per Elastic account: making one deletes any other with the same `ext`. They're listed in Connected apps as Elastic and can be revoked there.
- `ElasticLink` methods:
  - `lookup(email)` → `{boards}` or null: whether a Boardo account has that email. Elastic calls it with its account's verified email, to offer the link (R8.1); nothing outside the binding can ask;
  - `linkByEmail(email, ext)`: the link for the Boardo account with that email;
  - `exchange({code, verifier, redirect_uri}, ext)`: the connect page's code (section 5.1), swapped by Elastic's Worker rather than the app. Errors come back as `{error}`;
  - `adopt(token, ext)`: a device's `elastic` token becomes the account's link, and is revoked;
  - `cards(token)` and `ops(token, ops)`: the same as `/elastic/cards` and `/elastic/ops` (sections 5.2 and 5.3), or null once the link is revoked;
  - `revoke(token)`.
- **Live changes.** Whenever a board broadcasts a change to a card, field, member or the board itself, `Board.tellElastic()` collects everyone in the board (and anyone just taken out) and `notifyElastic()` (`worker/src/notify.ts`) calls `ELASTIC.cardsChanged(exts)` with the Elastic accounts linked to them. Elastic's account sends `{t: 'boardo'}` over its devices' sync sockets, and they fetch the cards again (R8.5a).

### 5.2 Reading cards

`POST /elastic/cards` returns `{boards, cards}`: the number of boards the person is in, and their cards that have at least one date and aren't archived, from every board they're in. For each card it returns only:
- `id`, `title`, `start`, `end` (`YYYY-MM-DD`, or ISO 8601 with offset), `hasTime`;
- `board {id, name, hue}`;
- `status {label, role}` (`role` is `in_progress`, `completed` or null);
- `myDone` (when the person's part was done, ms, or null), `completed`, `completedAt` (ms, from the log);
- `url`, the card's own link in Boardo: `https://kaiserkhan.com/boardo/?card=<board>/<card>`.

Elastic uses `boards` to decide whether to show the Projects section at all (R8.7).

Comments, files, custom fields and other people's cards are never returned (R8.3).

### 5.3 Writing time and done marks

`POST /elastic/ops {ops: [{id, type, board, cardId, sessionId, at}]}`, where `type` is one of `start`, `stop`, `done` or `undone`. It answers `{results: [{id, ok, error?}]}`; every op gets an answer, and Elastic drops answered ones, refused ones too (`not-member`, `not-assigned`, `bad`).

- The Worker checks that the person is a member of the board; the board's DO checks that they're assigned to the card.
- Ops are idempotent by `id` (the DO keeps the ids it has applied), so retries and late offline deliveries never count twice.
- `start` opens a `session` record (`sessionId`) and sets Status to the `in_progress` option (R5.6), logged as "started work in Elastic".
- `stop` closes the session and logs the time worked.
- `done` and `undone` set or clear the person's part, which triggers the completion rule.
- Log entries and sessions use the op's `at`, so time worked offline is recorded when it really happened (R8.27). An `at` more than 60 days old, or in the future, is refused.

## 6. Changes in Elastic

All of these are in Elastic's repository.

- **`worker/src/boardo.ts`** (Elastic's Worker, since 23 October 2026) holds the account's link in D1 `boardo_links (user_id, token, email, name, declined)` and answers the app, as the signed-in account (set up with a name and an email): `/boardo` (linked as whom, or `match {email, boards}`, and `declined`), `/boardo/link`, `/boardo/connect`, `/boardo/adopt`, `/boardo/cards`, `/boardo/ops`, `/boardo/disconnect`, `/boardo/decline`. Linking, connecting, adopting and disconnecting tell the account's other devices at once. Deleting the Elastic account revokes the link. `BoardoHooks.cardsChanged(accounts)` passes Boardo's changes to each account's devices.
- **`src/lib/boardo.svelte.ts`** holds the `Boardo` class the store keeps as `P.boardo`:
  - `load()` shows the cards kept in IndexedDB as soon as a signed-in device opens (it works offline); `online()` runs once the account's sync connection is up: it hands an old device token to the account, finishes a connect-page return (`?code&state`, PKCE through WebCrypto), asks `/boardo` and fetches the cards;
  - `nudge()` fetches again when the sync connection says `{t: 'boardo'}` or reconnects, plus a fallback every 15 minutes while visible;
  - the offer: `match` shows a card on Today ("See your Boardo cards here?", Show my cards / No thanks) and a button in Settings; `link()`, `decline()`, `connect()` (another email), `disconnect()`;
  - an ops outbox (`meta['boardoOps']`), flushed through Elastic's Worker when online;
  - signing out hides it all; another account signing in on the device wipes what was kept.

  The connect page comes from `VITE_BOARDO_APP`; without it, or without Elastic accounts, Projects stays off.
- **`cardsFor(dayKey, cards, today, clock24)`** is a pure function that applies R8.12 to R8.18 and builds the deadline labels, read from the day being looked at: Overdue, Due today (with the time if there is one), Due tomorrow, a weekday within the next 6 days, otherwise a short date. An overdue In progress card shows on every day after its end up to today.
- **`src/components/Projects.svelte` (new):**
  - built on Elastic's `Collapsible` component (R8.8);
  - placed in the plan after the Checklist and before the timeline (and above the empty-day message);
  - shown only when the person is connected and in at least one board;
  - each row has the title, the project in its colour, a status chip, the deadline and a Start button (Resume or Running when the card's timer is going);
  - tapping a row opens a read-only card sheet (`ProjectCard.svelte`) with **Open in Boardo**.
- **`Item.card?: { id: string; board: string; session?: string | null }`** links a day item to a card, and Elastic's backup import validates it.
  - Starting a card creates a task item with `min: 0`, the card's title and the project's colour. Elastic's existing `startItem` then places it at the current point.
  - Elastic's scheduler already ends a running item at `max(now, start + min + pausedFor)`, so a `min: 0` item counts up and pushes the plan later (R8.20, R8.21).
  - Cards still to work on today count as something to start the day for, so Start my day shows even on a day with no tasks.
- **Ops come from comparing days.** `Planner.put()` compares each changed day with the one it replaces: a card item that starts running sends `start` (a new session id, kept on `Item.card.session` while it runs), one that stops running for any reason sends `stop`, one that becomes done sends `done`, and one reopened from done sends `undone`. Days synced in from another device don't pass through `put()`, so nothing is sent twice.
- **The running card's row** shows elapsed time counting up ("so far"), not a countdown, and books no time's-up alert or push. Its controls:
  - **Pause** sends `stop`, and resuming sends `start` with a new session;
  - **Postpone** sets it aside (`stop`), without asking where to;
  - **Done** sends `stop` and then `done`.
- **Starting another task, or ending the day, while a card runs** sets the card item aside as partly done (`postponed`, "worked … · set aside"): the time worked is kept and the session stops. The card is **not** marked done and stays in Projects (R8.24).
- **Settings → Projects:** connected, the Boardo account, Check for new cards and Disconnect; otherwise Show my Boardo cards (when the email matches) and Use another Boardo account, or Connect Boardo.

## 7. App structure (Boardo)

**Screens**
- **Sign in:** email, then a 6-digit code, then a name the first time.
- **Home:** the person's boards as tiles, as in Trello (the board's background or colour across the top, then its name and their open cards), pending invites, and a New board tile.
- **Board:**
  - columns side by side, scrolling sideways on a phone;
  - cards show title, assignees, status, dates and comment and attachment counts;
  - drag within and between columns;
  - filters by person and status.
- **Card window** (`CardSheet.svelte`: a large window in the middle of the screen on a computer, as in Trello; a tall sheet from the bottom on a phone), with two tabs, Details and History.
  - **Header:** tinted in the status's colour, with the title (text until tapped), the board and column (the column is a balloon), and "1 of 2 done" when several people share it.
  - **Details, side column:** Starts, Due, People, Time, Status, then the custom fields. Values read as text and become editable when tapped; status, column and people open in a `Balloon` (a small popover over the page, so nothing shifts). Time shows Elastic's mark, which opens a balloon on what Elastic is, with a link to it. Then "Mark done" (green, full width) for assignees, or "Mark not done" (soft rose) once their part is done, and Archive.
  - **Details, main column:** Description, Attachments, Dependencies (`Dependencies.svelte`: the cards it waits on along a rail, "This card", then the ones it holds up; picked from a balloon with a search, never offering a card that already waits on this one), Comments (the emoji picker is a balloon).
  - **History** (`CardHistory.svelte`): the card's log as a timeline grouped by day, a coloured point for each kind of change.
  - **Drafts.** Every edit is a draft until Save changes. A bar shows Unsaved changes with Discard and Save changes, and closing (or opening a linked card) with unsaved changes asks first. Mark done, Archive, comments and files act at once; Mark done shows a toast with Undo for 6 seconds.
- **Activity:** the project log, filterable by person and card, in a panel that slides in from the right over the board (a tap outside closes it). A card opened from it stacks on top.
- **Board settings** (admin):
  - Board: name, colour and background (none, a colour, or an image with Remove image), all saved together with one Save;
  - members and roles;
  - invites;
  - the fields editor;
  - the upload limit;
  - archived cards, restored or deleted for good;
  - leave or delete board.
- **My cards:** grouped by deadline or by project.
- **Account** (the person icon; far right on a computer, a tab on a phone): name, photo, email (changed with a code sent to the new address), passkeys, theme, connected apps, sign out, delete account.

**Interaction**
- Drag uses press-and-hold on touch and a short move threshold with a mouse, with other cards sliding aside, as in Elastic.
- Sheets slide up on a phone. On a computer the card opens in the middle and Activity slides in from the right.
- Installed copies pick up a new build at quiet moments (on coming back to the app or leaving it, never while something is open), and pull down to refresh, as in Elastic (`freshness.svelte.ts`).
- Nothing a person changes is saved until they press Save, Add, Update or Comment, as in Elastic (PRD R11.13).
- Everything respects reduced motion.

## 8. Phases

**Phase 0: setup**
- Repository `qkonline/boardo` (public, MIT).
- The app is served from kaiserkhan.com/boardo (Hostinger, beside Elastic); the Worker from `boardo-api.qaisarkhans.workers.dev`.
- Resend sends from `boardo@kaiserkhan.com`. Its SPF and DKIM records go in kaiserkhan.com's DNS at Hostinger, on Resend's own names (`send.kaiserkhan.com`, `resend._domainkey`), so they don't touch the domain's existing mail.
- Create D1 `boardo`, R2 `boardo-files` and the Worker `boardo-api`. Set the secrets.
- Scaffold the app with Svelte, Vite, Vitest, Prettier and svelte-check. `npm run deploy` runs the tests and checks, builds and uploads to Hostinger.
- Confirm the free tiers still cover the plan: SQLite-backed Durable Objects, D1, R2 (10 GB) and Resend (3,000 emails a month, 100 a day).

**Phase 1: accounts and boards**
- Email sign-in, sessions and profile.
- Boards, members, admins and invites.
- The Board DO with columns, cards and the default fields.
- Permission checks, offline storage and live sync for several people.
- Card and project logs.
- Screens: sign in, home, board, card sheet (without comments and files), activity, board settings (members).

**Phase 2: the rest of Boardo**
- Custom fields and the fields editor.
- Comments with emoji.
- Attachments.
- My cards and board filters.
- Connected apps settings.

**Phase 3: time and Elastic**
- Sessions and Time spent.
- Parts done and the completion rule.
- OAuth, `/elastic/cards` and `/elastic/ops`.
- The Elastic changes in section 6.

Each phase is tested, deployed and pushed before the next starts. Phases 0 to 3 shipped on 22 October 2026.

**Since phase 3** (also 22 October 2026)
- Any colour, from a colour wheel, as well as the five.
- Activity as a side panel; status shown as a band across the card, and optional.
- Filters beside the board's name; deleting archived cards.
- Passkeys; quiet updates and pull to refresh; the Account tab.
- Board backgrounds, board tiles, profile photos, changing name and email.
- The card window redesign: drafts until Save, balloons, History as a timeline, Undo after Mark done, Status in the side column, the Elastic balloon.
- Card dependencies.

## 9. Testing

**Boardo unit tests (Vitest)**
- **Permissions:** member and admin puts for every kind; a removed member is refused.
- **Completion:** one of two assignees done, both done, an undo, a new assignee on a Completed card, and a manual status change.
- **Logs:** the right entries come from each kind of change, and a client can't write `log`.
- **OAuth:** PKCE verification, an unregistered redirect refused, a used or expired code refused, a revoked token refused.
- **Files:** types checked by their first bytes, a renamed executable refused, the size limit and an admin raise.
- **Merge:** per-field merges, comments are never lost, and dependencies merge as a set (`merge.test.ts`).
- **Checks:** a card's dependency list is kept once each, and refused if it holds the card itself or isn't ids (`checks.test.ts`).
- **Backgrounds:** an upload alone never changes the board, only an uploaded image can be saved, and unsaved or replaced images are swept (`background.test.ts`).
- **Deleting:** an archived card goes with its comments, files and time, by an admin or whoever made it (`board.test.ts`).
- **Sync:** two people plus a non-member, each with their own fake IndexedDB, against an in-memory board DO over a fake WebSocket. It checks:
  - edits flow both ways;
  - offline edits merge;
  - the non-member never receives the board;
  - removal wipes the local copy.
- **Auth:** code tries, the resend wait, silence on unknown emails, and rate limits.

**Elastic unit tests**
- `cardsFor`:
  - dates in range, one-date cards, no dates;
  - overdue In Progress kept, overdue Blocked dropped;
  - my part done hidden, Completed shown ticked on the day;
  - every deadline label.
- The ops outbox is idempotent and survives a reload.
- Starting a task while a card runs sets the card aside without marking it done.
- A running `min: 0` card counts up and pushes later tasks.

**Browser checks (headless Chrome, phone and desktop sizes, light and dark)**
- **Boardo**, two browser profiles as two people:
  - the admin creates a board and invites the other, who accepts;
  - each sees only their own boards;
  - drag between columns, edit fields, comment with emoji;
  - upload an image and a PDF, and a blocked type is refused;
  - every action appears in the logs.
- **Elastic against a local Boardo:**
  - connect through OAuth, and the Projects section appears;
  - start a card: it counts up and shows In Progress in Boardo;
  - pause and done: Completed once the other assignee is done;
  - Time spent adds up;
  - offline ops flush on reconnect;
  - disconnect hides the section.

**Live:** after each deploy, check with `curl`, sign in with a real email through Resend, and try it as an installed app on iPhone.
