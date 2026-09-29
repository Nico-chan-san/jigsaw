-- Players can switch from a passphrase to an email and password. The password is stored as a
-- salted scrypt hash, and the passphrase (players.secret) is cleared when they switch.
ALTER TABLE players ADD COLUMN email TEXT;
ALTER TABLE players ADD COLUMN password TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS players_email ON players (email);
-- Logins from an email and password: a hash of a random token each device keeps, like a passphrase.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created INTEGER NOT NULL DEFAULT 0
);
