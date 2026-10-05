-- A tray can sort its pieces by itself: whenever pieces are put in it, everything in it is laid out
-- in a grid. 0 is off, 1 is on.
ALTER TABLE trays ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
