-- Whether a section's line reads its reference range backwards.
--
-- Detection turns a line to face the way most of its passes ride, so the line
-- can be its representative's slice read end to start. The range keeps
-- start below end, and this flag says which way the line runs over it, on the
-- live row and on each stored version. Every existing row was cut forwards.

ALTER TABLE sections ADD COLUMN rep_reversed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE section_geometry ADD COLUMN rep_reversed INTEGER NOT NULL DEFAULT 0;
