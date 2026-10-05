-- Trays are numbered 1 to 9 in the order they were made (0 means no number, for the ones after the
-- ninth). Pressing a number moves the selected pieces to that tray.
ALTER TABLE trays ADD COLUMN num INTEGER NOT NULL DEFAULT 0;
UPDATE trays SET num = (
  SELECT COUNT(*) FROM trays t2
  WHERE t2.room_id = trays.room_id AND (t2.created < trays.created OR (t2.created = trays.created AND t2.id <= trays.id))
);
UPDATE trays SET num = 0 WHERE num > 9;
