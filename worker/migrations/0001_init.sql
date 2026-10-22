-- The directory: who exists, which boards there are, who is in which, and the tokens that
-- let people and connected apps in. Each board's content lives in its own Durable Object.
-- Sessions, codes, invite tokens, OAuth codes and app tokens are only ever stored hashed.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  hue TEXT NOT NULL DEFAULT 'indigo',
  created INTEGER NOT NULL
);

CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device TEXT,
  created INTEGER NOT NULL,
  used INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hue TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE members (
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX members_user ON members (user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX invites_email ON invites (email);
CREATE INDEX invites_board ON invites (board_id);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE app_tokens (
  hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  label TEXT NOT NULL,
  created INTEGER NOT NULL,
  used INTEGER NOT NULL
);
CREATE INDEX app_tokens_user ON app_tokens (user_id);

-- Rate limits: a count per key (an email or a network) inside a window that starts at `start`.
CREATE TABLE limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  start INTEGER NOT NULL
);
