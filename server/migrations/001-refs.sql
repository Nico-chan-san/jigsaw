-- Reference images placed on the table, shared by everyone in the room.
CREATE TABLE IF NOT EXISTS refs (
  id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  PRIMARY KEY (room_id, id)
);
