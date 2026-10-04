-- Hardcore mode is gone: every piece lies face up and no room is in that mode any more. The
-- columns stay, unused, so older code and data keep working.
UPDATE pieces SET f = 0 WHERE f <> 0;
UPDATE rooms SET annoying = 0 WHERE annoying <> 0;
