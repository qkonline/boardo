-- A profile photo: its id, served at /photos/<user id>/<photo id> (R2 users/<user id>/<photo id>).
ALTER TABLE users ADD COLUMN photo TEXT;
