-- Pages opened before 003 kept saving player names until they reloaded. Move anything saved
-- under a name onto that name's player, when exactly one player has it.
INSERT INTO times (room_id, user, seconds)
SELECT t.room_id, (SELECT id FROM players WHERE name = t.user), t.seconds FROM times t
WHERE t.user NOT IN (SELECT id FROM players) AND (SELECT COUNT(*) FROM players WHERE name = t.user) = 1
ON CONFLICT (room_id, user) DO UPDATE SET seconds = seconds + excluded.seconds;
DELETE FROM times
WHERE user NOT IN (SELECT id FROM players) AND (SELECT COUNT(*) FROM players WHERE name = times.user) = 1;

UPDATE pieces SET "by" = (SELECT id FROM players WHERE players.name = pieces."by")
WHERE "by" IS NOT NULL AND "by" NOT IN (SELECT id FROM players)
  AND (SELECT COUNT(*) FROM players WHERE name = pieces."by") = 1;
UPDATE notes SET author = (SELECT id FROM players WHERE players.name = notes.author)
WHERE author != '' AND author NOT IN (SELECT id FROM players)
  AND (SELECT COUNT(*) FROM players WHERE name = notes.author) = 1;
UPDATE refs SET author = (SELECT id FROM players WHERE players.name = refs.author)
WHERE author != '' AND author NOT IN (SELECT id FROM players)
  AND (SELECT COUNT(*) FROM players WHERE name = refs.author) = 1;
