-- How see-through a reference image is, from 0.1 (faint) to 1 (solid).
ALTER TABLE refs ADD COLUMN opacity REAL NOT NULL DEFAULT 1;
