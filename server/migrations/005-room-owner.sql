-- The player who created the jigsaw; only they may delete it. NULL for jigsaws made before this.
ALTER TABLE rooms ADD COLUMN owner TEXT;
