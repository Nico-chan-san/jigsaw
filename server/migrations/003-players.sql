-- Players: a display name (not unique) and a 4 word passphrase that logs them in anywhere.
-- Only a hash of the passphrase is stored; it is NULL for players carried over from before
-- passphrases, until someone with that name claims it.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret TEXT UNIQUE,
  created INTEGER NOT NULL DEFAULT 0
);

-- Pieces, notes, images and times used to store the player's name. Give every name in use a
-- player, then point everything at that player's id instead.
INSERT INTO players (id, name)
SELECT lower(hex(randomblob(8))), name FROM (
  SELECT "by" AS name FROM pieces WHERE "by" IS NOT NULL AND "by" != ''
  UNION SELECT author FROM notes WHERE author != ''
  UNION SELECT author FROM refs WHERE author != ''
  UNION SELECT user FROM times WHERE user != ''
);

UPDATE pieces SET "by" = (SELECT id FROM players WHERE players.name = pieces."by")
WHERE "by" IS NOT NULL AND "by" != '';
UPDATE notes SET author = (SELECT id FROM players WHERE players.name = notes.author) WHERE author != '';
UPDATE refs SET author = (SELECT id FROM players WHERE players.name = refs.author) WHERE author != '';
UPDATE times SET user = (SELECT id FROM players WHERE players.name = times.user) WHERE user != '';
