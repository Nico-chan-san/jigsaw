-- Annoying mode: pieces start in one overlapping pile and can lie face down.
ALTER TABLE rooms ADD COLUMN annoying INTEGER NOT NULL DEFAULT 0;
-- 1 when the piece is face down.
ALTER TABLE pieces ADD COLUMN f INTEGER NOT NULL DEFAULT 0;
