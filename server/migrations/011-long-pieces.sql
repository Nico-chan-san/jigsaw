-- Big pieces: some pieces are two to five grid cells in one, in any shape (see unitsFor in src/lib/geometry.js).
ALTER TABLE rooms ADD COLUMN long_pieces INTEGER NOT NULL DEFAULT 0;
-- How many pieces the jigsaw has, when that isn't one per cell (with big pieces). 0 means one per cell.
ALTER TABLE rooms ADD COLUMN units INTEGER NOT NULL DEFAULT 0;
