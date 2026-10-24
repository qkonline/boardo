-- The bell: updates for each person (worker/src/notes.ts decides who; inbox.ts keeps and sends).
-- `data` is the rest of the update as JSON, with names as they were at the time.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  card_id TEXT,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  data TEXT NOT NULL,
  read_at INTEGER
);
CREATE INDEX notes_user ON notes (user_id, at);

-- When the person last opened the bell: the red count is what came after.
ALTER TABLE users ADD COLUMN notes_seen INTEGER NOT NULL DEFAULT 0;

-- Phone and computer alerts: each browser that turned them on, for whom.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX push_subs_user ON push_subs (user_id);
