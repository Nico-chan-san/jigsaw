-- When each player was last in each room (ms since epoch), for "last played" in the players list.
-- 0 means not known, for time recorded before this column existed.
ALTER TABLE times ADD COLUMN seen INTEGER NOT NULL DEFAULT 0;
