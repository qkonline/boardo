-- Moving the app to a new address (kaiserkhan.com/boardo/ → boardo.kaiserkhan.com, October 2026):
-- a one-time code carries a sign-in from the old address to the new one, which has none of the
-- old one's storage. Stored as a hash, good for two minutes.
CREATE TABLE handoffs (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL
);
