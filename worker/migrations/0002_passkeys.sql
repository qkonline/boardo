-- Passkeys: sign in with Face ID, Touch ID or a security key instead of an emailed code. An
-- account is still made with an email code (invites go by email); a passkey is added after.

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT NOT NULL,
  created INTEGER NOT NULL,
  used INTEGER
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- A challenge can be answered once, within a few minutes.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires INTEGER NOT NULL
);
