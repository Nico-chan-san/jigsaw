-- Private jigsaws: left out of the jigsaws list, except for players who have opened the link.
ALTER TABLE rooms ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
-- Players who have opened a private jigsaw (or made it), so it shows in their list.
CREATE TABLE IF NOT EXISTS room_players (
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  joined INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, player_id)
);
