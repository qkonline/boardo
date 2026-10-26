-- Each person's own order of their boards on Boards (R2.5a). Null (a new board, one just joined)
-- comes after the ones they've placed, oldest first.
ALTER TABLE members ADD COLUMN position REAL;
