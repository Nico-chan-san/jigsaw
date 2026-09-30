-- The pieces in each tray, as a JSON list of piece numbers. Trays fit themselves around them.
ALTER TABLE trays ADD COLUMN pieces TEXT NOT NULL DEFAULT '[]';
