# Boardo

Shared project boards. Each project gets a board with columns of cards; the people working on it
are invited as admins or members, and each person only sees the boards they're in.

Live at **[kaiserkhan.com/boardo](https://kaiserkhan.com/boardo/)**.

- **Cards** have a title, description, start and end dates, a status, assignees and the time
  spent on them, plus any fields an admin adds (text, numbers, dates, dropdowns, checkboxes,
  people).
- **Shared work:** each assignee finishes their own part, and a card completes when everyone's
  part is done.
- **Comments** with emoji, and **attachments** (images, PDFs and Office files).
- **A log** of everything that happens, per card and for the whole board, written by the server
  so it can be trusted.
- **My cards:** everything assigned to you, across all your boards, by deadline or by project.
- **Offline first:** every board you're in is kept on your device, works without a connection
  and syncs live with everyone else.
- **Elastic:** connect [Elastic](https://kaiserkhan.com/planner/), a day planner, to see the
  cards assigned to you in your day and time your work on them.

## How it's built

- The app is Svelte 5, TypeScript and Vite, served as a static installable web app. It keeps
  each board in IndexedDB and syncs over a WebSocket per board.
- The API is one Cloudflare Worker (`worker/`): D1 holds people, boards, members and invites;
  each board's content lives in its own Durable Object, which checks every change, applies the
  completion rule and writes the log; attachments go to R2.
- Sign-in is by a 6-digit code sent by email (Resend).
- `shared/` holds the data model and the rules both sides use.

See [docs/PRD.md](docs/PRD.md) for the requirements and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the design.

## Development

```bash
npm install
npm run dev            # http://localhost:5174/boardo/ (expects the API at :8788)
npm run worker:dev     # the API at http://localhost:8788 (Wrangler)
npm test               # Vitest, including multi-person sync against the real board logic
npm run check          # svelte-check and the Worker's types
npm run build
```

For local development, put `DEV_MAIL=1` and a `FILE_SIGNING_KEY` in `worker/.dev.vars`; sign-in
codes are then kept in memory and readable at `POST /dev/mail` instead of being emailed. Apply
the database schema with `npx wrangler d1 migrations apply boardo --local` from `worker/`.

## Licence

MIT
