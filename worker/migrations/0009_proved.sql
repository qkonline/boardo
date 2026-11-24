-- When this session last showed it's the account's owner (a code sent to the account's email, or a
-- passkey it has had for a while): changing the email and deleting the account ask for it.
ALTER TABLE sessions ADD COLUMN proved INTEGER;
