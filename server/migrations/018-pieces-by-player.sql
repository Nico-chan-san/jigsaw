-- Finding the pieces a player connected, across all jigsaws, for the player window.
CREATE INDEX IF NOT EXISTS pieces_by ON pieces ("by");
