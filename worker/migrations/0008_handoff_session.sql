-- A handoff ends the session it came from once it's used (the old address's copy moves, and
-- nothing signed in is left behind there).
ALTER TABLE handoffs ADD COLUMN session_hash TEXT;
