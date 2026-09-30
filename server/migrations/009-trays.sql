-- Trays on the table for sorting pieces into, shared by everyone in the room. x and y are the top
-- left corner, in world units like the pieces.
CREATE TABLE IF NOT EXISTS trays (
  id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  PRIMARY KEY (room_id, id)
);
